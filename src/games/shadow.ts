// 17 · SHADOW — stay on a moving target. Continuous pursuit tracking.
// The target drifts along a hidden smooth path p(t) = Σ a·sin(ω·t + φ) in x and in y. Press on it to start,
// then keep your pointer on it until the time is up. The error is sampled on a fixed 1/120 s grid from your
// pointer's actual positions (held between events), so frame rate and event rate don't matter.
// Hard hides the target for three stretches: you must keep predicting where it is.
import { circle, clamp, cross, easeOut, font, hair, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { alpha, bar, glow, plate, slot, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import { trackingRms, type V } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

const START_R = 9; // u: press within this of the target to start
const NEAR = 3; // u: "on target" band reported in the details

export interface ShadowPath {
  x: { a: number; w: number; p: number }[];
  y: { a: number; w: number; p: number }[];
  duration: number;
  /** Hard: [from, to] seconds during which the target is hidden. Still scored. */
  hidden: [number, number][];
}

export function makeShadow(seed: number, level: Level): ShadowPath {
  const r = rng(seed);
  const [wl, wh] = level === 'easy' ? [0.35, 0.9] : level === 'medium' ? [0.5, 1.35] : [0.6, 1.55];
  const comp = () => {
    const amps = [r.range(14, 20), r.range(7, 11), r.range(3, 6)];
    return amps.map((a, i) => ({ a, w: r.range(wl, wh) * (1 + i * 0.6), p: r.range(0, Math.PI * 2) }));
  };
  const duration = level === 'easy' ? 15 : level === 'medium' ? 18 : 20;
  const hidden: [number, number][] = [];
  if (level === 'hard') {
    for (const c of [5, 10.5, 16]) {
      const s = c + r.range(-1, 1);
      hidden.push([s, s + r.range(0.9, 1.3)]);
    }
  }
  return { x: comp(), y: comp(), duration, hidden };
}

/** Target position at t seconds (field units, inside ±38). */
export const targetAt = (s: ShadowPath, t: number): V => ({
  x: s.x.reduce((a, c) => a + c.a * Math.sin(c.w * t + c.p), 0),
  y: s.y.reduce((a, c) => a + c.a * Math.sin(c.w * t + c.p), 0),
});

/** Twins mode: the decoy is the target's mirror image across the vertical axis — it crosses the target every time x = 0. */
export const twinAt = (s: ShadowPath, t: number): V => {
  const p = targetAt(s, t);
  return { x: -p.x, y: p.y };
};

const factory: GameFactory = (api) => {
  const { stage } = api;
  let path: ShadowPath = makeShadow(1, 'medium');
  const twins = () => api.mode === 'twins';
  let phase: 'ready' | 'run' | 'done' = 'ready';
  let t0 = 0;
  let samples: { t: number; x: number; y: number }[] = [];
  let cursor: V | null = null;
  let doneAt = 0;
  let finTimer = 0;
  let series: number[] = [];
  const keys = new Set<string>();
  let fine = false;
  let lastK = 0;
  let kb = false;

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const strip = H > 560 ? 70 : 0;
    const F = Math.max(150, Math.min(W - 32, H - 90 - strip, 640));
    return { k: F / 100, F, cx: W / 2, cy: 64 + F / 2, strip };
  };
  const toField = (x: number, y: number): V => {
    const { k, cx, cy } = layout();
    return { x: (x - cx) / k, y: (y - cy) / k };
  };
  const hiddenAt = (t: number) => path.hidden.some(([a, b]) => t >= a && t < b);

  function reset(seed: number) {
    clearTimeout(finTimer);
    path = makeShadow(seed, api.level);
    phase = 'ready';
    samples = [];
    series = [];
    cursor = null;
    kb = false;
    keys.clear();
    api.progress('');
    api.prompt(
      twins()
        ? 'Press on the ringed ● and stay on it. Its mirror twin will cross it again and again — don’t switch.'
        : api.level === 'hard'
          ? 'Press on ● and stay on it. It will vanish three times — keep following where it would be.'
          : 'Press on ● and stay on it until the time is up.',
      `${path.duration} s · mouse: just follow it · touch: keep your finger down · keys: arrows, Space to start`,
    );
    stage.request();
  }

  function start(ts: number, p: V) {
    phase = 'run';
    t0 = ts;
    samples = [{ t: 0, ...p }];
    cursor = p;
    api.prompt('');
    api.sfx.tick();
    stage.request();
  }

  function record(ts: number, p: V) {
    const t = (ts - t0) / 1000;
    if (t < 0) return;
    cursor = p;
    // Samples must be time-ordered for the grid integration.
    if (samples.length && t < samples[samples.length - 1].t) return;
    samples.push({ t, ...p });
  }

  function finish() {
    phase = 'done';
    doneAt = performance.now();
    const res = trackingRms(samples, (t) => targetAt(path, t), 0, path.duration);
    series = res.series;
    const within = res.series.filter((d) => d <= NEAR).length / res.series.length;
    const dt = 1 / 120;
    let hidE = 0;
    let hidN = 0;
    res.series.forEach((d, i) => {
      if (hiddenAt(i * dt)) {
        hidE += d * d;
        hidN++;
      }
    });
    const visE = Math.sqrt((res.series.reduce((a, d) => a + d * d, 0) - hidE) / Math.max(1, res.series.length - hidN));
    const disp = res.rms.toFixed(2);
    let worst = 0;
    let worstAt = 0;
    for (let s = 0; s + 120 <= res.series.length; s += 30) {
      const m = res.series.slice(s, s + 120).reduce((a, b) => a + b, 0) / 120;
      if (m > worst) {
        worst = m;
        worstAt = s * dt;
      }
    }
    api.sfx.release();
    const rows: [string, string][] = [
      ['Mean distance', res.mean.toFixed(2) + ' u'],
      [`Time within ${NEAR} u`, Math.round(within * 100) + '%'],
      ['Worst second', `${worst.toFixed(1)} u at ${worstAt.toFixed(1)} s`],
    ];
    if (hidN) rows.push(['RMS while visible / hidden', `${visE.toFixed(2)} / ${Math.sqrt(hidE / hidN).toFixed(2)} u`]);
    rows.push(['Sampling', '120 per second on a fixed grid, from your actual pointer positions']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: res.rms,
          value: disp,
          unit: 'u',
          label: 'RMS tracking distance',
          headline:
            disp === '0.00'
              ? 'A perfect shadow.'
              : `You stayed ${disp} u from it (RMS), on target ${Math.round(within * 100)}% of the time${hidN ? `; ${Math.sqrt(hidE / hidN) > visE * 1.5 ? 'prediction in the dark cost you most' : 'and you predicted well in the dark'}` : ''}.`,
          rows,
          perfect: disp === '0.00',
          near: res.rms < 1.2,
          share: [`SHADOW · ${api.level} — stay on a moving target for ${path.duration} s`, `RMS ${disp} u`],
        }),
      api.motion() ? 900 : 0,
    );
    stage.request();
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    const p0 = stage.pt(e);
    const p = toField(p0.x, p0.y);
    if (phase === 'ready') {
      const tgt = targetAt(path, 0);
      if (Math.hypot(p.x - tgt.x, p.y - tgt.y) > START_R) {
        api.prompt('Press on ● to start.', 'Right on it');
        return;
      }
      kb = false;
      start(e.timeStamp, p);
    } else if (phase === 'run' && !kb) record(e.timeStamp, p);
  };
  const onMove = (e: PointerEvent) => {
    if (phase !== 'run' || kb || !e.isPrimary) return;
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) {
      const p = stage.pt(ev);
      record(ev.timeStamp, toField(p.x, p.y));
    }
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  const onVis = () => {
    if (document.hidden && phase === 'run') api.voidRun('Run voided — the tab was hidden while you were tracking.');
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e)) return;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (phase === 'ready') return;
        if (!kb && phase === 'run') return; // a pointer run stays a pointer run
        keys.add(e.key);
        lastK = performance.now();
        stage.request();
      } else if (e.code === 'Space' && phase === 'ready' && !e.repeat) {
        e.preventDefault();
        // Keyboard run: a cursor that starts on the target. Recorded as its own category.
        kb = true;
        api.setInput('keyboard');
        start(e.timeStamp, targetAt(path, 0));
      }
    }),
    listen('keyup', (e) => {
      fine = e.shiftKey;
      keys.delete(e.key);
    }),
    listen('blur', () => keys.clear()),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const { k, F, cx, cy, strip } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = false;
    plate(c, cx - F / 2, cy - F / 2, F, F, 14);
    // The target: a shaded ball with a soft glow (no trail — that would give its velocity away).
    const ball = (x: number, y: number) => {
      glow(c, x, y, 24, pal.ink, 0.6);
      softShadow(c, x, y + 6, 8, 2.5, 1.1);
      sphere(c, x, y, 7, pal.ink);
    };

    if (phase === 'ready') {
      const p = targetAt(path, 0);
      if (twins()) {
        const q = twinAt(path, 0);
        ball(X(q.x), Y(q.y));
        glow(c, X(p.x), Y(p.y), 40, pal.accent, 0.8);
        circle(c, X(p.x), Y(p.y), 14, pal.accent, undefined, 2);
        tag(c, 'YOURS', X(p.x), Y(p.y) - 26, pal.accent, 10);
      }
      ball(X(p.x), Y(p.y));
      const pulse = api.motion() ? 0.5 + 0.5 * Math.sin(now / 250) : 1;
      circle(c, X(p.x), Y(p.y), START_R * k * (0.8 + 0.2 * pulse), pal.ink3, undefined, 1, [3, 3]);
      if (api.motion()) more = true;
      return more;
    }
    if (phase === 'run') {
      const t = (now - t0) / 1000;
      if (kb && keys.size) {
        const dt = Math.min(0.05, (now - lastK) / 1000);
        lastK = now;
        const sp = fine ? 12 : 45;
        const p = cursor ?? { x: 0, y: 0 };
        const np = {
          x: clamp(p.x + ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * sp * dt, -50, 50),
          y: clamp(p.y + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * sp * dt, -50, 50),
        };
        record(now, np);
      }
      if (t >= path.duration) {
        finish();
        return true;
      }
      const p = targetAt(path, t);
      const hid = hiddenAt(t);
      // Lock-on: within a few units the reticle closes round the target and both glow cyan.
      const d = cursor ? Math.hypot(cursor.x - p.x, cursor.y - p.y) : Infinity;
      // Twins: no lock-on light — it would tell you which ball is yours.
      const lock = !twins() && d < 4;
      if (!hid && twins()) {
        const q = twinAt(path, t);
        ball(X(q.x), Y(q.y));
      }
      if (!hid) {
        if (lock) {
          glow(c, X(p.x), Y(p.y), 46, pal.accent, 0.8);
          circle(c, X(p.x), Y(p.y), 16, alpha(pal.accent, 0.8), undefined, 1.5);
        }
        ball(X(p.x), Y(p.y));
      }
      else text(c, 'hidden — keep following', cx, cy - F / 2 + 16, font.mono(10, 500), pal.ink3, 'center');
      if (cursor) {
        const col = hid || twins() ? pal.ink2 : lock ? pal.accent : pal.signal;
        glow(c, X(cursor.x), Y(cursor.y), 22, col, 0.6);
        cross(c, X(cursor.x), Y(cursor.y), 9, col, 1.5, 3);
      }
      // Time bar
      slot(c, cx - F / 2, cy + F / 2 + 12, cx + F / 2, cy + F / 2 + 12, 6);
      bar(c, cx - F / 2, cy + F / 2 + 9.5, F * (1 - t / path.duration), 5, pal.accent, 2.5);
      api.progress(`${Math.max(0, path.duration - t).toFixed(0)} s`);
      return true;
    }
    // Done: both paths, then the error over time.
    const rp = api.motion() ? easeOut((now - doneAt) / 800) : 1;
    if (rp < 1) more = true;
    const T = path.duration * rp;
    c.beginPath();
    for (let t = 0; t <= T; t += 1 / 60) {
      const p = targetAt(path, t);
      if (t) c.lineTo(X(p.x), Y(p.y));
      else c.moveTo(X(p.x), Y(p.y));
    }
    c.strokeStyle = pal.accent;
    c.lineWidth = 1.5;
    c.stroke();
    c.beginPath();
    samples.filter((s) => s.t <= T).forEach((s, i) => (i ? c.lineTo(X(s.x), Y(s.y)) : c.moveTo(X(s.x), Y(s.y))));
    c.strokeStyle = pal.signal;
    c.lineWidth = 1.25;
    c.stroke();
    tag(c, 'target', X(targetAt(path, 0).x), Y(targetAt(path, 0).y) - 14, pal.ink3, 10);
    if (strip && series.length) {
      const sy = stage.h - strip / 2 - 6;
      const L = cx - F / 2;
      const R = cx + F / 2;
      const maxE = Math.max(3, ...series);
      plate(c, L - 12, sy - strip / 2 - 14, R - L + 24, strip + 10, 12);
      hair(c, L, sy + strip / 2 - 12, R, sy + strip / 2 - 12, pal.ink3);
      // The error over time, as a shaded area.
      if (series.length > 1) {
        c.beginPath();
        c.moveTo(L, sy + strip / 2 - 12);
        series.forEach((d, i) => c.lineTo(L + (i / (series.length - 1)) * (R - L), sy + strip / 2 - 12 - (d / maxE) * (strip - 20)));
        c.lineTo(R, sy + strip / 2 - 12);
        c.closePath();
        c.fillStyle = pal.signalSoft;
        c.fill();
      }
      for (const [a, b] of path.hidden) {
        c.fillStyle = pal.line2;
        c.fillRect(L + (a / path.duration) * (R - L), sy - strip / 2 + 4, ((b - a) / path.duration) * (R - L), strip - 16);
      }
      c.beginPath();
      series.forEach((d, i) => {
        const x = L + (i / (series.length - 1)) * (R - L);
        const y = sy + strip / 2 - 12 - (d / maxE) * (strip - 20);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.strokeStyle = pal.signal;
      c.lineWidth = 1.25;
      c.stroke();
      text(c, 'DISTANCE OVER TIME' + (path.hidden.length ? ' · shaded: target hidden' : ''), L, sy - strip / 2, font.mono(9, 500), pal.ink3, 'left');
      text(c, `max ${maxE.toFixed(1)} u`, R, sy - strip / 2, font.mono(9, 500), pal.ink3, 'right');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
    },
  };
};

export default factory;
