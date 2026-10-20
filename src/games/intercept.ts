// 37 · INTERCEPT — press at the instant the object crosses the target line. The target sits behind a frosted
// screen, so you cannot react to the crossing: you must predict it from the motion you saw.
// Motion is analytic: x(t) = v₀t + ½at² (constant speed, accelerating, decelerating), or a throw
// y(t) = v_y t − ½gt² whose fall through a line inside a cloud must be timed (Hard). The crossing time is
// solved exactly from the model, the position on screen is the same model evaluated at the frame time, and
// your press is timed with the event's own timestamp on the same clock. Score: mean |press − crossing| (ms).
import { clamp, circle, font, line, pal, text } from '../core/draw';
import { alpha, glow, plate, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { Bench, mean, roundStrip, shuffle } from './kit';

export type MotionKind = 'const' | 'accel' | 'decel' | 'throw';
export interface Trial {
  kind: MotionKind;
  v0: number; // u/s (throw: vertical launch speed)
  a: number; // u/s² (throw: −g)
  target: number; // u along the motion axis
  screen: number; // where the frosted screen begins (u)
  tCross: number; // s
}

/** Position along the motion axis at time t. */
export const pos = (tr: Trial, t: number) => tr.v0 * t + 0.5 * tr.a * t * t;

/**
 * First time the motion reaches `x` (for the throw: the time it falls back through x, the later root).
 * Returns NaN if it never gets there.
 */
export function crossTime(v0: number, a: number, x: number, falling = false) {
  if (Math.abs(a) < 1e-12) return x / v0;
  const disc = v0 * v0 + 2 * a * x;
  if (disc < 0) return NaN;
  const r1 = (-v0 + Math.sqrt(disc)) / a;
  const r2 = (-v0 - Math.sqrt(disc)) / a;
  const roots = [r1, r2].filter((t) => t > 0).sort((p, q) => p - q);
  if (!roots.length) return NaN;
  return falling ? roots[roots.length - 1] : roots[0];
}

const MIX: Record<Level, MotionKind[]> = {
  easy: ['const', 'const', 'const', 'const', 'const', 'const', 'const', 'const'],
  medium: ['const', 'const', 'accel', 'accel', 'accel', 'decel', 'decel', 'decel'],
  hard: ['const', 'accel', 'accel', 'decel', 'decel', 'throw', 'throw', 'throw'],
};
const HORIZON: Record<Level, [number, number]> = { easy: [0.45, 0.8], medium: [0.6, 1.1], hard: [0.8, 1.4] };

export function makeIntercept(seed: number, level: Level): Trial[] {
  const r = rng(seed);
  const kinds = shuffle([...MIX[level]], r.next);
  return kinds.map((kind) => {
    for (let t = 0; t < 500; t++) {
      let v0: number;
      let a: number;
      let target: number;
      if (kind === 'throw') {
        const g = r.range(55, 75);
        const apex = r.range(72, 90);
        v0 = Math.sqrt(2 * g * apex);
        a = -g;
        target = r.range(46, apex - 10);
        const tCross = crossTime(v0, a, target, true);
        // The cloud starts below the target; you see the rise until the ball enters it.
        const screen = r.range(34, target - 6);
        const tIn = crossTime(v0, a, screen);
        if (tCross - tIn < HORIZON[level][0] + 0.4) continue;
        return { kind, v0, a, target, screen, tCross };
      }
      if (kind === 'const') {
        v0 = r.range(26, 46);
        a = 0;
      } else if (kind === 'accel') {
        v0 = r.range(10, 20);
        a = r.range(10, 22);
      } else {
        v0 = r.range(44, 58);
        a = -r.range(5, 11);
      }
      target = r.range(78, 92);
      const tCross = crossTime(v0, a, target);
      if (!Number.isFinite(tCross)) continue;
      if (kind === 'decel' && v0 + a * tCross < 6) continue;
      const H = r.range(HORIZON[level][0], HORIZON[level][1]);
      const tScreen = tCross - H;
      const screen = pos({ kind, v0, a, target, screen: 0, tCross }, tScreen);
      if (tScreen < 0.9 || screen < 30 || screen > target - 6) continue;
      return { kind, v0, a, target, screen, tCross };
    }
    throw new Error('makeIntercept: no trial');
  });
}

export const MISS_MS = 800;
/** Signed error in ms (positive = late); a missing press costs MISS_MS. */
export const interceptError = (tr: Trial, tPress: number | null) => (tPress == null ? MISS_MS : Math.max(-MISS_MS, Math.min(MISS_MS, (tPress - tr.tCross) * 1000)));

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let trials: Trial[] = [];
  let i = 0;
  let phase: 'ready' | 'arming' | 'run' | 'after' | 'done' = 'ready';
  let t0 = 0;
  let press: number | null = null;
  let errs: { err: number; missed: boolean }[] = [];

  const label: Record<MotionKind, string> = { const: 'steady speed', accel: 'speeding up', decel: 'slowing down', throw: 'thrown upward — time its fall' };

  function reset(seed: number) {
    bench.clear();
    trials = makeIntercept(seed, api.level);
    i = 0;
    errs = [];
    ready();
  }
  function ready() {
    phase = 'ready';
    press = null;
    api.progress(`${i + 1} / ${trials.length}`);
    api.prompt(`Press the instant it crosses the line behind the screen (${label[trials[i].kind]}).`, 'Press to launch · then Space or tap at the crossing');
    stage.request();
  }
  function launch() {
    phase = 'arming';
    api.sfx.press();
    bench.later(() => {
      phase = 'run';
      t0 = performance.now();
      api.prompt('…', '');
      // A missed crossing ends the trial on its own.
      bench.later(() => phase === 'run' && commit(null), (trials[i].tCross * 1000 + MISS_MS) | 0);
      stage.request();
    }, 650);
    stage.request();
  }
  function commit(at: number | null) {
    if (phase !== 'run') return;
    const tr = trials[i];
    press = at == null ? null : (at - t0) / 1000;
    const err = interceptError(tr, press);
    errs.push({ err, missed: at == null });
    phase = 'after';
    api.judge(Math.abs(err));
    if (at != null) api.sfx.release();
    api.prompt(at == null ? 'Missed — no press.' : `${Math.abs(err).toFixed(0)} ms ${err < 0 ? 'early' : 'late'}.`, `Crossing at ${tr.tCross.toFixed(3)} s after launch${i < trials.length - 1 ? ' · press for the next' : ''}`);
    if (i === trials.length - 1) finish();
    stage.request();
  }
  function finish() {
    phase = 'done';
    const abs = errs.map((e) => Math.abs(e.err));
    const m = mean(abs);
    const early = errs.filter((e) => !e.missed && e.err < 0).length;
    const late = errs.filter((e) => !e.missed && e.err >= 0).length;
    const rows: [string, string][] = trials.map((tr, j) => [`${j + 1} · ${tr.kind}`, errs[j].missed ? 'missed' : `${errs[j].err >= 0 ? '+' : '−'}${Math.abs(errs[j].err).toFixed(0)} ms (crossing ${tr.tCross.toFixed(2)} s)`]);
    rows.push(['Early / late', `${early} early · ${late} late · ${errs.filter((e) => e.missed).length} missed`]);
    rows.push(['Mean signed error', `${mean(errs.filter((e) => !e.missed).map((e) => e.err)).toFixed(0)} ms`]);
    for (const k of ['const', 'accel', 'decel', 'throw'] as MotionKind[]) {
      const js = trials.map((t, j) => (t.kind === k ? j : -1)).filter((j) => j >= 0);
      if (js.length) rows.push([`${k}`, `${mean(js.map((j) => abs[j])).toFixed(0)} ms mean`]);
    }
    bench.finish({
      score: m,
      value: m.toFixed(0),
      unit: 'ms',
      label: 'mean timing error',
      headline: `${m.toFixed(0)} ms from the true crossing on average${early > late + 2 ? ' — mostly early' : late > early + 2 ? ' — mostly late' : ''}.`,
      rows,
      perfect: m < 0.5,
      near: m < 25,
      share: [`INTERCEPT · ${api.level}`, `${m.toFixed(0)} ms`],
    });
  }
  function next() {
    if (phase !== 'after' || i >= trials.length - 1) return;
    i++;
    ready();
  }

  bench.onTap = (_p, e) => {
    if (phase === 'ready') launch();
    else if (phase === 'run') commit(e.timeStamp);
    else if (phase === 'after') next();
  };
  bench.onKey = (e) => {
    if (e.repeat || !(e.code === 'Space' || e.key === 'Enter')) return;
    e.preventDefault();
    if (phase === 'ready') launch();
    else if (phase === 'run') commit(e.timeStamp);
    else if (phase === 'after') next();
  };
  bench.onAway = () => {
    if (phase === 'run' || phase === 'arming') api.voidRun('Attempt voided — the page lost focus during a trial.');
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const tr = trials[i];
    if (!tr) return false;
    const W = stage.w;
    const H = stage.h;
    const t = phase === 'run' || phase === 'after' || phase === 'done' ? (now - t0) / 1000 : 0;
    const shownT = phase === 'after' || phase === 'done' ? Math.min(t, Math.max(tr.tCross, press ?? 0) + 0.5) : t;
    const p = pos(tr, Math.max(0, shownT));
    const revealed = phase === 'after' || phase === 'done';
    const more = phase === 'run' || (revealed && t < Math.max(tr.tCross, press ?? 0) + 0.5) || phase === 'arming';
    if (tr.kind !== 'throw') {
      const L = 40;
      const R = W - 40;
      const y = Math.max(160, H * 0.45);
      const X = (u: number) => L + ((R - L) * u) / 100;
      plate(c, L - 20, y - 70, R - L + 40, 140, 12);
      line(c, L, y + 18, R, y + 18, pal.line, 2);
      for (let u = 0; u <= 100; u += 10) line(c, X(u), y + 14, X(u), y + 22, pal.ink3, 1);
      const ox = X(clamp(p, -5, 105));
      softShadow(c, ox, y + 16, 12, 3, 1);
      sphere(c, ox, y, 11, pal.ink);
      // Frosted screen over the target zone (transparent after the trial).
      const fa = revealed ? 0.25 : 0.96;
      c.fillStyle = alpha(pal.paper2, fa);
      c.fillRect(X(tr.screen), y - 60, R - X(tr.screen) + 10, 120);
      line(c, X(tr.screen), y - 60, X(tr.screen), y + 60, alpha(pal.ink, 0.25), 1);
      line(c, X(tr.target), y - 50, X(tr.target), y + 50, pal.accent, 2);
      text(c, 'target', X(tr.target), y - 56, font.mono(10, 600), pal.accent, 'center');
      if (revealed && press != null) {
        const px = X(pos(tr, press));
        circle(c, px, y, 11, Math.abs((press - tr.tCross) * 1000) < 40 ? pal.accent : pal.signal, undefined, 2, [3, 3]);
        text(c, 'you', px, y + 40, font.mono(10, 600), pal.ink2, 'center');
      }
    } else {
      // Vertical scene: the ball rises into a cloud and falls back through the line inside it.
      const B = H - 60;
      const T = 90;
      const cx = W / 2;
      const Y = (u: number) => B - ((B - T) * u) / 100;
      plate(c, cx - 110, T - 10, 220, B - T + 30, 12);
      line(c, cx - 90, B + 6, cx + 90, B + 6, pal.line, 2);
      const oy = Y(clamp(p, -5, 105));
      const ox = cx + (shownT - tr.tCross / 2) * 18;
      glow(c, ox, oy, 26, pal.ink, 0.3);
      sphere(c, ox, oy, 10, pal.ink);
      c.fillStyle = alpha(pal.paper2, revealed ? 0.25 : 0.96);
      c.fillRect(cx - 100, T - 4, 200, Y(tr.screen) - T + 4);
      line(c, cx - 100, Y(tr.screen), cx + 100, Y(tr.screen), alpha(pal.ink, 0.25), 1);
      line(c, cx - 90, Y(tr.target), cx + 90, Y(tr.target), pal.accent, 2);
      text(c, 'target ↓ (on the way down)', cx, Y(tr.target) - 8, font.mono(10, 600), pal.accent, 'center');
      if (revealed && press != null) {
        const py = Y(pos(tr, press));
        circle(c, cx + (press - tr.tCross / 2) * 18, py, 10, Math.abs((press - tr.tCross) * 1000) < 40 ? pal.accent : pal.signal, undefined, 2, [3, 3]);
      }
    }
    if (phase === 'ready') text(c, 'press to launch', W / 2, H - 30, font.mono(12, 500), pal.ink2, 'center');
    roundStrip(c, W, H - 8, errs.map((e) => (e.missed ? '—' : Math.abs(e.err).toFixed(0))), trials.length, i);
    return more;
  };

  return { reset, destroy: () => bench.destroy() };
};

export default factory;
