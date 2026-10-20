// 07 · DRIFT — control a noisy system. Hidden, changing forces push a dot; you push back with acceleration.
// Two scorings: |∫| Magnitude = ∫|x| dt / T (every excursion counts),
//               ∫ Net       = |∫x dt| / T (left cancels right — the signed area must balance).
import { arrow, circle, clamp, easeOut, font, hair, hatch, line, pal, tag, text } from '../core/draw';
import { capture, gameKey, listen, primary } from '../core/input';
import { alpha, glow, knob, slot } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

const STEP = 1 / 120;
const K = 42; // thrust, u/s² at full deflection
const DAMP = 0.55;
const EDGE = 50;

export interface Drift {
  a: number[];
  w: number[];
  p: number[];
  steps: { t: number; v: number }[];
  bias: number;
}

const CFG: Record<Level, { dur: number; band: number; amp: number; steps: number; delay: number }> = {
  easy: { dur: 15, band: 3, amp: 0.55, steps: 0, delay: 0 },
  medium: { dur: 20, band: 2, amp: 1, steps: 2, delay: 0 },
  // Hard: longer, stronger, four ambushes, a narrow band — and your hand acts 180 ms late.
  hard: { dur: 25, band: 1.5, amp: 1.35, steps: 4, delay: 0.18 },
};

export function makeDrift(seed: number, level: Level): Drift {
  const r = rng(seed);
  const cfg = CFG[level];
  const steps = Array.from({ length: cfg.steps }, (_, i) => {
    const slot = cfg.dur / (cfg.steps + 1);
    return { t: slot * (i + 1) + r.range(-slot * 0.3, slot * 0.3), v: r.range(6, 11) * cfg.amp * r.sign() };
  });
  const amp = cfg.amp;
  return {
    a: [r.range(5, 9) * amp, r.range(3, 6) * amp, r.range(1.5, 3) * amp],
    w: [r.range(0.35, 0.6), r.range(1.0, 1.6), r.range(2.6, 3.6)],
    p: [r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)],
    steps,
    bias: r.range(3, 7) * amp * r.sign(),
  };
}

export function force(d: Drift, t: number) {
  let f = d.bias;
  for (let i = 0; i < 3; i++) f += d.a[i] * Math.sin(d.w[i] * t + d.p[i]);
  for (const s of d.steps) if (t >= s.t) f += s.v;
  return f;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let drift: Drift = makeDrift(1, 'medium');
  let DURATION = 20;
  let BAND = 2;
  let lag: number[] = []; // Hard: queued commands, applied after the delay
  let lagSteps = 0;
  let phase: 'ready' | 'run' | 'done' = 'ready';
  let x = 0;
  let v = 0;
  let simT = 0;
  let acc = 0; // sub-step accumulator
  let thrust = 0;
  let lastFrame = 0;
  let hist: { t: number; x: number; u: number }[] = [];
  let sumSq = 0;
  let sumAbs = 0; // ∫|x| dt
  let sumNet = 0; // ∫x dt
  const net = () => api.mode === 'net';
  let inBand = 0;
  let samples = 0;
  let crossings = 0;
  let maxAbs = 0;
  let effort = 0;
  let doneAt = 0;
  let finTimer = 0;
  // pointer joystick
  let pid: number | null = null;
  let origin = 0;
  let px = 0;
  const keys = new Set<string>();
  let fine = false;
  let inSince = 0;
  let heldPulses = 0;

  function reset(seed: number) {
    clearTimeout(finTimer);
    const cfg = CFG[api.level];
    drift = makeDrift(seed, api.level);
    DURATION = cfg.dur;
    BAND = cfg.band;
    lagSteps = Math.round(cfg.delay / STEP);
    lag = [];
    phase = 'ready';
    x = 0;
    v = 0;
    simT = 0;
    acc = 0;
    thrust = 0;
    hist = [];
    inSince = 0;
    heldPulses = 0;
    api.fx.streak(0);
    sumSq = sumAbs = sumNet = inBand = samples = crossings = maxAbs = effort = 0;
    pid = null;
    keys.clear();
    api.progress(`${DURATION.toFixed(1)} s`);
    api.prompt(
      api.level === 'hard'
        ? 'Press to start. Your push arrives 180 ms after you make it.'
        : api.firstTime
          ? 'Press and hold to start. Drag left or right to push the dot.'
          : 'Press to start.',
      net()
        ? `∫ Net · left cancels right — finish with the signed area at zero${api.level === 'hard' ? ' · the tally is hidden' : ''}`
        : api.level === 'hard'
          ? `${DURATION} s · four hidden ambushes · stay within ±${BAND} u`
          : `You push its speed, not its position · ${DURATION} s`,
    );
    stage.request();
  }

  function start() {
    phase = 'run';
    lastFrame = performance.now();
    api.prompt('');
    api.sfx.tick();
    stage.request();
  }

  function input() {
    if (pid !== null) {
      const span = Math.max(60, stage.w * 0.18);
      return clamp((px - origin) / span, -1, 1);
    }
    const s = fine ? 0.3 : 1;
    return ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * s;
  }

  function step() {
    if (lagSteps) {
      lag.push(input());
      thrust = lag.length > lagSteps ? lag.shift()! : 0;
    } else thrust = input();
    const f = force(drift, simT);
    v += (K * thrust + f - DAMP * v) * STEP;
    const nx = x + v * STEP;
    if (Math.sign(nx) !== Math.sign(x) && x !== 0) crossings++;
    x = nx;
    if (Math.abs(x) > EDGE) {
      x = Math.sign(x) * EDGE;
      v = 0;
    }
    simT += STEP;
    sumSq += x * x;
    sumAbs += Math.abs(x) * STEP;
    sumNet += x * STEP;
    if (Math.abs(x) <= BAND) inBand++;
    samples++;
    maxAbs = Math.max(maxAbs, Math.abs(x));
    effort += Math.abs(thrust);
    if (samples % 4 === 0) hist.push({ t: simT, x, u: thrust });
  }

  function finish() {
    phase = 'done';
    doneAt = performance.now();
    pid = null;
    const rms = Math.sqrt(sumSq / samples);
    const band = inBand / samples;
    const T = samples * STEP;
    const meanAbs = sumAbs / T; // ∫|x| dt / T
    const meanNet = sumNet / T; // ∫x dt / T (signed)
    const score = net() ? Math.abs(meanNet) : meanAbs;
    const disp = score.toFixed(2);
    const side = meanNet > 0 ? 'right' : 'left';
    api.sfx.release();
    api.progress('done');
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score,
          value: disp,
          unit: 'u',
          label: net() ? 'net signed area ÷ time, |∫x dt| / T' : 'mean distance from zero, ∫|x| dt / T',
          headline: net()
            ? disp === '0.00'
              ? `Left and right cancelled exactly — even though you wandered ${meanAbs.toFixed(1)} u on average.`
              : `The signed area ended at ${sumNet >= 0 ? '+' : '−'}${Math.abs(sumNet).toFixed(1)} u·s — you spent more of it on the ${side}.`
            : `Within ±${BAND} u for ${(band * 100).toFixed(0)}% of the run. ${drift.steps.length ? `The hidden push changed ${drift.steps.length} times.` : 'The hidden push only drifted.'}`,
          rows: [
            ['∫x dt (signed area)', `${sumNet >= 0 ? '+' : '−'}${Math.abs(sumNet).toFixed(1)} u·s`],
            ['∫|x| dt (absolute area)', `${sumAbs.toFixed(1)} u·s`],
            [net() ? 'Magnitude score (the other mode)' : 'Net score (the other mode)', `${(net() ? meanAbs : Math.abs(meanNet)).toFixed(2)} u`],
            ['RMS', `${rms.toFixed(2)} u`],
            [`Time within ±${BAND} u`, (band * 100).toFixed(1) + '%'],
            ['Zero crossings', String(crossings)],
            ['Worst excursion', maxAbs.toFixed(1) + ' u'],
            ['Effort (mean push)', ((effort / samples) * 100).toFixed(0) + '%'],
            ['Drift changes at', drift.steps.length ? drift.steps.map((s) => s.t.toFixed(1) + ' s').join(', ') : 'never'],
          ],
          perfect: disp === '0.00',
          near: score < (net() ? 0.3 : 1),
          share: [`DRIFT · ${api.level} · ${net() ? '∫ net' : '|∫| magnitude'} — ${DURATION} s against an invisible push`, `${disp} u · ${(band * 100).toFixed(0)}% in the band`],
        }),
      api.motion() ? 900 : 0,
    );
    stage.request();
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e) || phase === 'done') return;
    capture(stage.canvas, e.pointerId);
    pid = e.pointerId;
    origin = px = stage.pt(e).x;
    if (phase === 'ready') start();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    px = stage.pt(e).x;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === pid) pid = null;
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e) || phase === 'done') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        keys.add(e.key);
        if (phase === 'ready') start();
      } else if (e.code === 'Space' && phase === 'ready') {
        e.preventDefault();
        start();
      }
    }),
    listen('keyup', (e) => {
      fine = e.shiftKey;
      keys.delete(e.key);
    }),
    listen('blur', () => {
      keys.clear();
      pid = null;
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    const cx = W / 2;
    const half = Math.min(W * 0.44, 440);
    const k = half / EDGE;
    const X = (u: number) => cx + u * k;
    let more = false;

    if (phase === 'run') {
      // Advance the simulation by real elapsed time, in fixed steps (deterministic for given inputs).
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      acc += dt;
      while (acc >= STEP && simT < DURATION) {
        step();
        acc -= STEP;
      }
      api.progress(`${Math.max(0, DURATION - simT).toFixed(1)} s`);
      if (simT >= DURATION) finish();
      else more = true;
    }

    const dotY = Math.max(96, H * 0.2);
    const bottom = H - 24;
    const done = phase === 'done';

    // Band & zero line. The band brightens while you are inside it; the walls glow as you near them.
    const live = phase === 'run';
    const inside = Math.abs(x) <= BAND;
    c.fillStyle = live ? alpha(inside ? pal.accent : pal.signal, inside ? 0.08 : 0.05) : pal.line2;
    c.fillRect(X(-BAND), dotY - 24, X(BAND) - X(-BAND), bottom - dotY + 24);
    hair(c, X(-BAND), dotY - 24, X(-BAND), bottom, alpha(pal.accent, live && inside ? 0.5 : 0.25));
    hair(c, X(BAND), dotY - 24, X(BAND), bottom, alpha(pal.accent, live && inside ? 0.5 : 0.25));
    hair(c, cx, dotY - 30, cx, bottom, alpha(pal.accent, 0.7), [3, 3]);
    c.lineCap = 'round';
    line(c, X(-EDGE), dotY, X(EDGE), dotY, pal.line, 3);
    const danger = live ? clamp((Math.abs(x) - EDGE * 0.6) / (EDGE * 0.4), 0, 1) : 0;
    for (const s of [-1, 1]) {
      const hot = Math.sign(x) === s ? danger : 0;
      line(c, X(s * EDGE), dotY - 18, X(s * EDGE), dotY + 18, hot > 0 ? pal.signal : pal.ink, 1 + hot * 2.5);
    }
    c.lineCap = 'butt';
    for (let u = -EDGE; u <= EDGE; u += 10) hair(c, X(u), dotY + 22, X(u), dotY + (u % 50 === 0 ? 32 : 27), pal.ink3);
    text(c, '0', cx, dotY - 36, font.mono(10, 500), pal.ink2, 'center');
    if (live && samples && !net()) text(c, `IN BAND ${Math.round((inBand / samples) * 100)}%`, X(EDGE), dotY - 36, font.mono(10, 500), inside ? pal.ink2 : pal.signal, 'right');

    // Trace: live = last 6 s scrolling down; done = whole run compressed.
    const span = done ? DURATION : 6;
    const tNow = done ? DURATION : simT;
    const T = (t: number) => dotY + ((tNow - t) / span) * (bottom - dotY);
    if (hist.length > 1) {
      const rp = done && api.motion() ? easeOut((now - doneAt) / 700) : 1;
      if (rp < 1) more = true;
      if (net() && (done || api.level !== 'hard')) {
        // Signed area: right of zero solid, left of zero hatched — they cancel.
        for (const sgn of [1, -1]) {
          c.beginPath();
          let open = false;
          let lastY = 0;
          for (const hpt of hist) {
            if (tNow - hpt.t > span) continue;
            const y = dotY + (T(hpt.t) - dotY) * (done ? rp : 1);
            const xv = sgn > 0 ? Math.max(0, hpt.x) : Math.min(0, hpt.x);
            if (!open) {
              c.moveTo(cx, y);
              open = true;
            }
            c.lineTo(X(xv), y);
            lastY = y;
          }
          if (open) {
            c.lineTo(cx, lastY);
            c.closePath();
            c.fillStyle = sgn > 0 ? pal.line : hatch(c, pal.ink3, 4);
            c.fill();
          }
        }
      }
      // The trace. Live: outside the band it turns the signal colour, and older history fades out.
      c.lineWidth = 1.5;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      let prev: { x: number; y: number; out: boolean } | null = null;
      for (const hpt of hist) {
        if (tNow - hpt.t > span) continue;
        const y = dotY + (T(hpt.t) - dotY) * (done ? rp : 1);
        const cur = { x: X(hpt.x), y, out: Math.abs(hpt.x) > BAND };
        if (prev) {
          c.globalAlpha = done ? 1 : 0.15 + 0.85 * (1 - (tNow - hpt.t) / span);
          c.strokeStyle = cur.out || prev.out ? pal.signal : done ? pal.ink : pal.accent;
          c.beginPath();
          c.moveTo(prev.x, prev.y);
          c.lineTo(cur.x, cur.y);
          c.stroke();
        }
        prev = cur;
      }
      c.globalAlpha = 1;
      c.lineCap = 'butt';
      if (done) {
        // The reveal: what was pushing you all along.
        c.globalAlpha = rp;
        c.beginPath();
        for (let i = 0; i <= 200; i++) {
          const t = (i / 200) * DURATION;
          const fx = X(clamp(-force(drift, t) * 1.2, -EDGE, EDGE));
          const y = T(t);
          if (i) c.lineTo(fx, y);
          else c.moveTo(fx, y);
        }
        c.setLineDash([4, 4]);
        c.strokeStyle = pal.signal;
        c.lineWidth = 1.25;
        c.stroke();
        c.setLineDash([]);
        tag(c, 'hidden push (mirrored)', X(clamp(-force(drift, 2) * 1.2, -EDGE + 12, EDGE - 12)), T(2) - 6, pal.signal, 10);
        for (const s of drift.steps) {
          hair(c, X(-EDGE), T(s.t), X(EDGE), T(s.t), pal.ink3, [1, 4]);
          text(c, `${s.t.toFixed(1)} s`, X(EDGE) + 6, T(s.t), font.mono(10), pal.ink3, 'left', 'middle');
        }
        text(c, '0 s', X(EDGE) + 6, T(0), font.mono(10), pal.ink3, 'left', 'middle');
        text(c, `${DURATION} s`, X(EDGE) + 6, dotY, font.mono(10), pal.ink3, 'left', 'middle');
        c.globalAlpha = 1;
      }
    }

    // Dot and your push
    const dx = X(x);
    if (!done) {
      if (Math.abs(thrust) > 0.02) arrow(c, dx, dotY, dx + thrust * 46, dotY, pal.ink2, 2, 8);
      if (Math.abs(x) > BAND) line(c, cx, dotY, dx, dotY, pal.signal, 2);
      // A short motion trail, then the puck (with a halo while it is outside the band).
      if (phase === 'run' && api.motion()) {
        const tail = hist.slice(-9);
        tail.forEach((hp, i) => {
          c.globalAlpha = ((i + 1) / tail.length) * 0.45;
          circle(c, X(hp.x), dotY, 2 + (6 * (i + 1)) / tail.length, undefined, Math.abs(hp.x) > BAND ? pal.signal : pal.ink3);
        });
        c.globalAlpha = 1;
      }
      if (phase === 'run') glow(c, dx, dotY, 34, Math.abs(x) > BAND ? pal.signal : pal.accent, 0.9);
      knob(c, dx, dotY, 9, pal.ink);
      // Holding the band: a pulse every 3 s of unbroken control.
      if (phase === 'run') {
        if (!inside) inSince = simT;
        const held = Math.floor((simT - inSince) / 3);
        if (held > heldPulses) api.fx.ring(dx, dotY, pal.accent, 46, 1.75, 0.55);
        heldPulses = held;
        api.fx.streak(Math.min(held, 8));
      }
      if (phase === 'ready') {
        const p = api.motion() ? 0.5 + 0.5 * Math.sin(now / 260) : 1;
        circle(c, dx, dotY, 14 + p * 6, pal.ink3, undefined, 1);
        if (api.motion()) more = true;
      }
    }

    // Net mode: the running tally ∫x dt as a gauge (hidden on Hard until the end).
    if (net()) {
      const gy = dotY + 46;
      const gw = Math.min(half, 260);
      const full = Math.max(20, DURATION * 4); // u·s at the gauge's end
      slot(c, cx - gw, gy, cx + gw, gy, 6);
      hair(c, cx, gy - 6, cx, gy + 6, pal.ink);
      text(c, '∫x dt', cx - gw, gy - 8, font.mono(9, 500), pal.ink3, 'left');
      if (api.level === 'hard' && !done) {
        text(c, 'tally hidden', cx + gw, gy - 8, font.mono(9, 500), pal.ink3, 'right');
      } else {
        const gx = cx + clamp(sumNet / full, -1, 1) * gw;
        line(c, cx, gy, gx, gy, Math.abs(sumNet) < full * 0.05 ? pal.ink : pal.signal, 4);
        text(c, `${sumNet >= 0 ? '+' : '−'}${Math.abs(sumNet).toFixed(1)} u·s`, cx + gw, gy - 8, font.mono(10, 500), pal.ink2, 'right');
      }
    }

    // Joystick origin
    if (pid !== null && phase === 'run') {
      const jy = H - 60;
      const span = Math.max(60, W * 0.18);
      slot(c, origin - span, jy, origin + span, jy, 8);
      circle(c, origin, jy, 3, undefined, pal.ink3);
      knob(c, clamp(px, origin - span, origin + span), jy, 10, pal.ink, true);
    }
    return more;
  };

  // Fairness: a run must be one continuous 1/120 s simulation. Hiding the tab mid-run voids it
  // (otherwise it could be used as a pause button).
  const onVis = () => {
    keys.clear();
    pid = null;
    if (document.hidden && phase === 'run') api.voidRun('Run voided — the tab was hidden mid-run.');
  };
  document.addEventListener('visibilitychange', onVis);

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;
