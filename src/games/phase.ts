// 11 · PHASESHIFT — synchronise two oscillators. Not "make them overlap once": make them move together.
// Each oscillator is θ(t) = θ0 + ω·t, measured clockwise from its own zero mark. You adjust yours (phase,
// and on Medium/Hard its speed), then lock. Score: the worst phase gap over the 4 s after the lock — a
// frequency error turns into a growing phase error, so a lucky moment of overlap can't score well.
// Hard deceives the eye (turned zero mark, unequal trails, marks that blink out) but never the maths.
import { Controls, selectMarks } from '../core/controls';
import { circle, clamp, font, hair, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { dialFace, glow, plate, rr, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import { angleDiff, oscAngle, relPhase, syncError, type Osc } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

/** Observation window after the lock (s). Synchronisation must hold for all of it. */
export const WINDOW = 4;
const ROUNDS = 3;

export interface PhaseRound {
  a: Osc;
  /** Your oscillator at t = 0 (its starting phase and speed). */
  b: Osc;
  /** Speed knob range (°/s); equal lo = hi means the speed is fixed (Easy). */
  wLo: number;
  wHi: number;
  /** Rotation of your dial's zero mark (°, clockwise from up). Hard only. */
  markB: number;
  /** Trail lengths (°) — unequal on Hard. */
  trailA: number;
  trailB: number;
  /** Hard: the zero marks blink out on a fixed schedule. */
  blink: boolean;
}

export function makePhase(seed: number, level: Level): PhaseRound[] {
  const r = rng(seed);
  return Array.from({ length: ROUNDS }, () => {
    const period = r.range(1.5, 2.6);
    const wA = 360 / period;
    const a: Osc = { theta0: r.range(0, 360), omega: wA };
    const freq = level !== 'easy';
    const wLo = freq ? wA * r.range(0.72, 0.84) : wA;
    const wHi = freq ? wA * r.range(1.16, 1.3) : wA;
    let wB = wA;
    if (freq) {
      // Start clearly off-speed (≥ 7%), on a seeded side.
      do wB = r.range(wLo, wHi);
      while (Math.abs(wB - wA) / wA < 0.07);
    }
    // Phase: a clear initial gap. On Medium/Hard, stage a "brief coincidence" 1.2–2 s in: the markers meet
    // although the speeds differ — the eye says "synced", the maths says otherwise.
    let theta0: number;
    if (freq && r.next() < 0.7) {
      const tc = r.range(1.2, 2);
      theta0 = a.theta0 + (wA - wB) * tc;
    } else {
      theta0 = a.theta0 + r.sign() * r.range(35, 170);
    }
    return {
      a,
      b: { theta0: ((theta0 % 360) + 360) % 360, omega: wB },
      wLo,
      wHi,
      markB: level === 'hard' ? r.sign() * r.range(40, 140) : 0,
      trailA: level === 'hard' ? 95 : 0,
      trailB: level === 'hard' ? 18 : 0,
      blink: level === 'hard',
    };
  });
}

/** Score one locked round from the oscillators' parameters at the lock time tL (s). */
export function scorePhase(a: Osc, b: Osc, tL: number) {
  const d0 = relPhase(a, b, tL);
  const dw = b.omega - a.omega;
  return { d0, dw, sync: syncError(d0, dw, WINDOW), freqPct: (dw / a.omega) * 100 };
}

const BLIND_SHOW: Record<Level, number> = { easy: 6, medium: 5, hard: 4 };

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: PhaseRound[] = [];
  let round = 0;
  let t0 = 0; // round start (ms)
  let lockT = 0; // s, round time of the lock
  let phase: 'adjust' | 'watch' | 'done' = 'adjust';
  /** Your oscillator, kept as an anchor: θ(t) = ref + ω·(t − refT). Changes keep the marker continuous. */
  let B = { ref: 0, refT: 0, omega: 0 };
  let grab = false;
  let lastPhaseKnob = 0;
  let results: ReturnType<typeof scorePhase>[] = [];
  let finTimer = 0;
  const keys = new Set<string>();
  const blind = () => api.mode === 'blind';
  const controls = new Controls(stage, (t) => lock(t));

  const now = () => performance.now();
  const T = (ms: number) => (ms - t0) / 1000;
  const thetaB = (t: number) => B.ref + B.omega * (t - B.refT);
  const oscB = (): Osc => ({ theta0: B.ref - B.omega * B.refT, omega: B.omega });

  const geom = () => {
    const W = stage.w;
    const H = stage.h;
    const rd = rounds[round];
    const ctrlH = rd && rd.wLo !== rd.wHi ? 124 : 70;
    const top = 74;
    const avail = H - top - ctrlH - 70;
    const side = W >= avail * 1.25;
    const R = side ? clamp(Math.min(W / 4.6, avail / 2.3), 46, 170) : clamp(Math.min(W / 2.6, (avail - 30) / 4.6), 40, 150);
    const cy = top + 10 + (side ? avail / 2 : avail / 4 + 4);
    const A = side ? { x: W / 2 - R * 1.35, y: cy } : { x: W / 2, y: cy };
    const Bc = side ? { x: W / 2 + R * 1.35, y: cy } : { x: W / 2, y: cy + avail / 2 + 6 };
    return { R, A, B: Bc, ctrlY: H - ctrlH - 24, cw: Math.min(W - 32, 520) };
  };

  function setRound() {
    const rd = rounds[round];
    t0 = now();
    B = { ref: rd.b.theta0, refT: 0, omega: rd.b.omega };
    grab = false;
    phase = 'adjust';
    lastPhaseKnob = 0;
    const knobs = [
      {
        id: 'phase',
        label: 'phase',
        lo: -180,
        hi: 180,
        value: 0,
        speed: 70,
        onChange: (v: number) => {
          B.ref += v - lastPhaseKnob;
          lastPhaseKnob = v;
        },
      },
      {
        id: 'speed',
        label: 'speed',
        lo: rd.wLo,
        hi: rd.wHi,
        value: rd.b.omega,
        speed: (rd.wHi - rd.wLo) / 4,
        hidden: rd.wLo === rd.wHi,
        onChange: (v: number, ts: number) => {
          const t = T(ts);
          B.ref = thetaB(t);
          B.refT = t;
          B.omega = v;
        },
      },
    ];
    controls.set(knobs);
    controls.enabled = true;
    controls.lockLabel = 'Lock';
    api.progress(`${round + 1} / ${ROUNDS}`);
    const freq = rd.wLo !== rd.wHi;
    const main = blind()
      ? `Watch both. In ${BLIND_SHOW[api.level]} s the reference vanishes — keep yours in step with it.`
      : freq
        ? 'Make ■ move exactly with ●: same position, same speed.'
        : 'Make ■ move exactly with ●. Same speed — only the phase is off.';
    const sub = api.level === 'hard' ? 'Phase is measured from each dial’s own 0 mark — and yours is turned' : round === 0 && api.firstTime ? 'Drag around your dial, or use the sliders · ↑ ↓ choose · ← → adjust · Lock' : freq ? 'A brief overlap is not sync — watch them drift' : 'Drag your dial or the slider · Lock';
    api.prompt(main, sub);
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = makePhase(seed, api.level);
    round = 0;
    results = [];
    keys.clear();
    setRound();
    stage.request();
  }

  function lock(ts: number) {
    if (phase !== 'adjust') return;
    const rd = rounds[round];
    if (grab) {
      // Lock while holding the dial: release it at the lock instant.
      B.refT = T(ts);
      grab = false;
    }
    lockT = T(ts);
    const res = scorePhase(rd.a, oscB(), lockT);
    const g = geom();
    api.judge(res.sync, { x: (g.A.x + g.B.x) / 2, y: Math.min(g.A.y, g.B.y) - g.R * 0.4 });
    results.push(res);
    phase = 'watch';
    controls.enabled = false;
    api.sfx.release();
    api.buzz(10);
    const stable = res.sync - Math.abs(res.d0) < 2;
    api.prompt(
      `${res.sync.toFixed(1)}° worst gap over ${WINDOW} s — ${stable ? 'stable' : `temporary: it drifts ${(res.sync - Math.abs(res.d0)).toFixed(1)}° further`}.`,
      round < ROUNDS - 1 ? 'Watch the window, or tap / Enter for the next' : '',
    );
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'watch' || round >= ROUNDS - 1) return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, r) => a + r.sync, 0) / results.length;
    const disp = mean.toFixed(1);
    const anyFreq = rounds.some((r) => r.wLo !== r.wHi);
    const rows: [string, string][] = results.map((r, i) => [
      `Round ${i + 1}`,
      `gap at lock ${signed(r.d0, 1)}°${anyFreq ? ` · speed ${signed(r.freqPct, 1)}%` : ''} · worst ${r.sync.toFixed(1)}°`,
    ]);
    const meanPhase = results.reduce((a, r) => a + Math.abs(r.d0), 0) / results.length;
    rows.push(['Mean phase error at lock', meanPhase.toFixed(1) + '°']);
    if (anyFreq) rows.push(['Mean speed error', (results.reduce((a, r) => a + Math.abs(r.freqPct), 0) / results.length).toFixed(1) + '%']);
    rows.push(['Window', `${WINDOW} s after each lock`]);
    const drifted = results.filter((r) => r.sync - Math.abs(r.d0) >= 2).length;
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '°',
          label: `worst phase gap over ${WINDOW} s`,
          headline:
            disp === '0.0'
              ? 'Locked in step, three times. Nothing drifted.'
              : drifted
                ? `Averaged ${disp}°. ${drifted} of ${ROUNDS} locks only looked synced — the speeds differed, so the gap kept growing.`
                : `Averaged ${disp}° — and every lock held its speed. The error is all phase.`,
          rows,
          accuracy: 1 - mean / 180,
          perfect: disp === '0.0',
          near: mean < 3,
          share: [`PHASESHIFT · ${api.level}${blind() ? ' · blind' : ''} — two oscillators in step`, `${disp}° worst gap over ${WINDOW} s`],
        }),
      api.motion() ? 1200 : 0,
    );
  }

  // ── Direct manipulation: grab your dial and turn it ─────────────────────────
  const angleAt = (x: number, y: number) => {
    const g = geom();
    const rd = rounds[round];
    return (Math.atan2(x - g.B.x, -(y - g.B.y)) * 180) / Math.PI - rd.markB;
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'watch') return next();
    if (phase !== 'adjust') return;
    const g = geom();
    const p = stage.pt(e);
    if (Math.hypot(p.x - g.B.x, p.y - g.B.y) > g.R + 30) return;
    capture(stage.canvas, e.pointerId);
    grab = true;
    controls.touched = true;
    B.ref = angleAt(p.x, p.y);
    B.refT = T(e.timeStamp);
    api.sfx.tick();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    if (!grab || !primary(e)) return;
    const p = stage.pt(e);
    B.ref = angleAt(p.x, p.y);
    B.refT = T(e.timeStamp);
  };
  const onUp = (e: PointerEvent) => {
    if (!grab || !primary(e)) return;
    // Let go: it carries on from exactly where you released it.
    B.refT = T(e.timeStamp);
    grab = false;
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.repeat || e.defaultPrevented) return;
      if ((e.key === 'Enter' || e.code === 'Space') && phase === 'watch') {
        e.preventDefault();
        next();
      }
    }),
  ];

  // ── Rendering ───────────────────────────────────────────────────────────────
  function dial(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, mark: number, theta: number, trail: number, kind: 'ref' | 'you', showMark: boolean, showMarker: boolean) {
    const rad = (deg: number) => ((deg + mark - 90) * Math.PI) / 180;
    dialFace(c, cx, cy, R + 14);
    circle(c, cx, cy, R, pal.ink3, undefined, 1.25);
    if (showMark) {
      const z = rad(0);
      line(c, cx + Math.cos(z) * (R - 12), cy + Math.sin(z) * (R - 12), cx + Math.cos(z) * (R + 12), cy + Math.sin(z) * (R + 12), pal.accent, 2.5);
      text(c, '0', cx + Math.cos(z) * (R + 24), cy + Math.sin(z) * (R + 24), font.mono(11, 600), pal.accent, 'center', 'middle');
    }
    if (!showMarker) {
      text(c, 'hidden', cx, cy, font.mono(10, 500), pal.ink3, 'center', 'middle');
      return;
    }
    const a = rad(theta);
    if (trail > 0) {
      // A comet tail that fades out behind the marker.
      const tr = (trail * Math.PI) / 180;
      const segs = 12;
      c.strokeStyle = kind === 'ref' ? pal.ink2 : pal.accent;
      c.lineWidth = 7;
      for (let i = 0; i < segs; i++) {
        c.globalAlpha = 0.55 * ((i + 1) / segs) ** 1.4;
        c.beginPath();
        c.arc(cx, cy, R, a - tr + (tr * i) / segs, a - tr + (tr * (i + 1)) / segs);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    line(c, cx, cy, cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10), kind === 'ref' ? pal.ink : pal.ink2, 1.5, kind === 'ref' ? undefined : [4, 3]);
    const mx = cx + Math.cos(a) * R;
    const my = cy + Math.sin(a) * R;
    softShadow(c, mx, my + 7, 11, 3.2, 1.2);
    glow(c, mx, my, 30, kind === 'ref' ? pal.ink : pal.accent, 0.6);
    if (kind === 'ref') sphere(c, mx, my, 9, pal.ink);
    else {
      rr(c, mx - 8, my - 8, 16, 16, 4);
      c.fillStyle = pal.paper;
      c.fill();
      c.strokeStyle = pal.accent;
      c.lineWidth = 2.5;
      c.stroke();
    }
    circle(c, cx, cy, 3.5, undefined, pal.ink);
  }

  stage.draw = (nowT) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    controls.tick(nowT);
    const g = geom();
    const t = T(nowT);
    if (grab) B.refT = t; // held: the marker stays under your finger
    const tA = oscAngle(rd.a, t);
    const tB = thetaB(t);
    // Hard: zero marks blink out for 0.9 s of every 3 s (fixed schedule from the round start).
    const marksOn = !rd.blink || phase !== 'adjust' || t % 3 < 2.1;
    const hideA = blind() && phase === 'adjust' && t > BLIND_SHOW[api.level];
    dial(c, g.A.x, g.A.y, g.R, 0, tA, rd.trailA, 'ref', marksOn, !hideA);
    dial(c, g.B.x, g.B.y, g.R, rd.markB, tB, rd.trailB, 'you', marksOn, true);
    text(c, '● REFERENCE', g.A.x, g.A.y + g.R + 34, font.mono(10, 500), pal.ink3, 'center');
    text(c, '■ YOURS' + (grab ? ' · held' : ''), g.B.x, g.B.y + g.R + 34, font.mono(10, 500), pal.ink3, 'center');
    if (phase === 'adjust' && controls.knobs.length) selectMarks(c, g.B.x, g.B.y, g.R + 18, pal.line);

    // Blind mode: a bar counting down to the reference vanishing.
    if (blind() && phase === 'adjust' && !hideA) {
      const left = 1 - t / BLIND_SHOW[api.level];
      line(c, g.A.x - g.R, g.A.y - g.R - 30, g.A.x - g.R + 2 * g.R * left, g.A.y - g.R - 30, pal.signal, 2);
    }

    if (phase === 'adjust') controls.draw(c, stage.w / 2 - g.cw / 2, g.ctrlY, g.cw);
    else {
      // The observation window: the true relative phase over WINDOW s after the lock, drawn as it unfolds.
      const res = results[round];
      const L = stage.w / 2 - g.cw / 2;
      const Rr = stage.w / 2 + g.cw / 2;
      const y0 = g.ctrlY + 40;
      const hh = 42;
      const span = Math.max(10, Math.min(180, res.sync * 1.15));
      const el = Math.min(WINDOW, t - lockT);
      const p = api.motion() ? el / WINDOW : 1;
      plate(c, L - 14, y0 - hh - 24, Rr - L + 28, hh * 2 + 44, 12);
      hair(c, L, y0, Rr, y0, pal.ink3, [3, 3]);
      text(c, `GAP ■ − ● OVER ${WINDOW} s AFTER LOCK`, L, y0 - hh - 8, font.mono(9, 500), pal.ink3, 'left');
      text(c, `±${span.toFixed(0)}°`, Rr, y0 - hh - 8, font.mono(9, 500), pal.ink3, 'right');
      c.beginPath();
      const N = 80;
      for (let i = 0; i <= N * p; i++) {
        const tau = (i / N) * WINDOW;
        const d = angleDiff(res.d0 + res.dw * tau, 0);
        const x = L + (tau / WINDOW) * (Rr - L);
        const y = y0 - clamp(d / span, -1, 1) * hh;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.strokeStyle = pal.signal;
      c.lineWidth = 2;
      c.stroke();
      if (p >= 1) tag(c, `worst ${res.sync.toFixed(1)}°`, Rr - 40, y0 + hh + 6, pal.signal, 11);
      if (api.motion() && el < WINDOW) return true;
    }
    return true; // oscillators always move
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      controls.destroy();
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;


