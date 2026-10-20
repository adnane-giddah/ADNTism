// 14 · PERCEPTION — match a real geometric property while an illusion bends what you see.
// A small measurement engine: every round is {type, illusion, target, range}. The illusion is drawn from the
// same numbers the scorer uses, but the scorer only ever reads the true geometry (shaft length, disk radius,
// inner gap, ray opening, line offset) — never the decorated shape.
import { addBias, biasOf, fooledOf } from '../core/bias';
import { Controls } from '../core/controls';
import { bracket, circle, clamp, easeOut, font, line, pal, tag, text, beatLamp } from '../core/draw';
import { signed } from '../core/format';
import { gameKey, listen, primary } from '../core/input';
import { latency } from '../core/latency';
import { plate, rr } from '../core/materials';
import { Metronome } from '../core/metronome';
import { rng, type Rng } from '../core/rng';
import { type V } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

export type PType = 'length' | 'size' | 'gap' | 'angle' | 'align';
export type Illusion = 'none' | 'mullerlyer' | 'ponzo' | 'ebbinghaus' | 'oppel' | 'orient' | 'zollner' | 'poggendorff';

export interface PRound {
  type: PType;
  illusion: Illusion;
  /**
   * +1: the context makes the reference look bigger than the adjustable would at equal size (so a fooled
   * player sets the adjustable too big). −1: the reverse. 0: no directional prediction is claimed.
   */
  polarity: number;
  /** The value the adjustable must take (u, or ° for angle). */
  target: number;
  lo: number;
  hi: number;
  start: number;
  /** Denominator of the relative error: the reference magnitude, or the bar width for alignment. */
  norm: number;
  /** Layout and illusion parameters, all in field units. */
  ref: V;
  adj: V;
  /** Illusion strength (fin length, inducer radius, tick count, bar width…). */
  k: number;
  /** Orientation (degrees) for angle rounds; slope for alignment. */
  rot: number;
}

const TYPES: PType[] = ['length', 'size', 'gap', 'angle', 'align'];

export const TYPE_INFO: Record<PType, { name: string; ask: string; knob: string; unit: string }> = {
  length: { name: 'Length', ask: 'Make the lower line exactly as long as the upper one — the line only, not its ends.', knob: 'lower line', unit: 'u' },
  size: { name: 'Size', ask: 'Make the right disk exactly the size of the left one — ignore what surrounds them.', knob: 'right disk', unit: 'u' },
  gap: { name: 'Gap', ask: 'Make the lower empty gap as wide as the upper one, edge to edge.', knob: 'lower gap', unit: 'u' },
  angle: { name: 'Angle', ask: 'Open the lower angle to exactly the opening of the upper one.', knob: 'opening', unit: '°' },
  align: { name: 'Alignment', ask: 'Slide the right segment until it continues the left one on one straight line.', knob: 'right segment', unit: 'u' },
};

export const ILLUSION_INFO: Record<Illusion, string> = {
  none: 'no illusion',
  mullerlyer: 'Müller-Lyer arrowheads',
  ponzo: 'Ponzo converging rails',
  ebbinghaus: 'Ebbinghaus surrounding circles',
  oppel: 'Oppel-Kundt filled space',
  orient: 'different orientation',
  zollner: 'Zöllner hatching + orientation',
  poggendorff: 'Poggendorff occluding bar',
};

/** The rule for each illusion's direction, for the player — only the well-established ones claim one. */
const ILLUSION_WHY: Partial<Record<Illusion, (p: number) => string>> = {
  mullerlyer: (p) => `Ends like >—< make a line look longer; <—> make it look shorter. Here the ${p > 0 ? 'upper' : 'lower'} line had the stretching ends.`,
  ponzo: (p) => `Between converging rails, the line nearer the narrow end looks longer. Here that was the ${p > 0 ? 'upper (reference)' : 'lower (yours)'} one.`,
  ebbinghaus: (p) => `A disk among small circles looks bigger; among big circles, smaller. Here the ${p > 0 ? 'left' : 'right'} disk sat among the small ones.`,
  oppel: (p) => `A gap filled with marks looks wider than an empty one. Here the ${p > 0 ? 'upper' : 'lower'} gap was filled.`,
};

function rangeAround(r: Rng, t: number, loF: [number, number], hiF: [number, number]) {
  const lo = t * r.range(...loF);
  const hi = t * r.range(...hiF);
  let start = r.range(lo, hi);
  // Never start close to the answer, and never at the middle of the slider.
  for (let i = 0; i < 50 && Math.abs(start - t) < 0.12 * t; i++) start = r.range(lo, hi);
  return { lo, hi, start };
}

function makeRound(r: Rng, type: PType, level: Level): PRound {
  const ctx = level !== 'easy';
  const hard = level === 'hard';
  const pol = r.sign();
  switch (type) {
    case 'length': {
      const ponzo = hard && r.next() < 0.5;
      const L = ponzo ? r.range(22, 32) : r.range(28, 42);
      const { lo, hi, start } = rangeAround(r, L, [0.55, 0.7], [1.35, 1.5]);
      if (ponzo) {
        // The reference sits near the apex (looks longer) when pol = +1.
        return { type, illusion: 'ponzo', polarity: pol, target: L, lo, hi, start, norm: L, ref: { x: 0, y: pol > 0 ? -24 : 26 }, adj: { x: 0, y: pol > 0 ? 26 : -24 }, k: 1, rot: 0 };
      }
      return {
        type,
        illusion: ctx ? 'mullerlyer' : 'none',
        polarity: ctx ? pol : 0,
        target: L,
        lo,
        hi,
        start,
        norm: L,
        ref: { x: r.range(-6, 6), y: -16 },
        adj: { x: r.range(-6, 6), y: 16 },
        k: hard ? 9 : 6.5,
        rot: 0,
      };
    }
    case 'size': {
      const R0 = r.range(4.5, 6.5);
      const { lo, hi, start } = rangeAround(r, R0, [0.55, 0.7], [1.35, 1.45]);
      return {
        type,
        illusion: ctx ? 'ebbinghaus' : 'none',
        polarity: ctx ? pol : 0,
        target: R0,
        lo,
        hi,
        start,
        norm: R0,
        ref: { x: -23, y: 0 },
        adj: { x: 23, y: 0 },
        k: hard ? 7.5 : 6,
        rot: 0,
      };
    }
    case 'gap': {
      const g = r.range(18, 30);
      const { lo, hi, start } = rangeAround(r, g, [0.55, 0.7], [1.35, 1.5]);
      return {
        type,
        illusion: ctx ? 'oppel' : 'none',
        polarity: ctx ? pol : 0,
        target: g,
        lo,
        hi,
        start,
        norm: g,
        ref: { x: r.range(-5, 5), y: -16 },
        adj: { x: r.range(-5, 5), y: 18 },
        k: hard ? 11 : 7,
        rot: 0,
      };
    }
    case 'angle': {
      const a = r.range(28, 64);
      const lo = a * r.range(0.55, 0.7);
      const hi = Math.min(115, a * r.range(1.35, 1.5));
      let start = r.range(lo, hi);
      for (let i = 0; i < 50 && Math.abs(start - a) < 0.12 * a; i++) start = r.range(lo, hi);
      return {
        type,
        illusion: hard ? 'zollner' : ctx ? 'orient' : 'none',
        polarity: 0,
        target: a,
        lo,
        hi,
        start,
        norm: a,
        ref: { x: 0, y: -12 },
        adj: { x: 0, y: 40 },
        k: hard ? 5 : 0,
        rot: ctx ? r.sign() * r.range(35, 75) : 0,
      };
    }
    case 'align': {
      const w = hard ? 16 : 11;
      const slope = r.sign() * Math.tan((r.range(...(hard ? ([18, 28] as [number, number]) : ([26, 40] as [number, number]))) * Math.PI) / 180);
      const y0 = r.range(-8, 8);
      const target = y0 + slope * w;
      const lo = target - r.range(8, 12);
      const hi = target + r.range(8, 12);
      let start = r.range(lo, hi);
      for (let i = 0; i < 50 && Math.abs(start - target) < 3; i++) start = r.range(lo, hi);
      return { type, illusion: ctx ? 'poggendorff' : 'none', polarity: 0, target, lo, hi, start, norm: w, ref: { x: -w / 2, y: y0 }, adj: { x: w / 2, y: 0 }, k: w, rot: slope };
    }
  }
}

/** Five rounds, one of each type, in a seeded order. */
export function makePerception(seed: number, level: Level): PRound[] {
  const r = rng(seed);
  const order = [...TYPES];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((t) => makeRound(r, t, level));
}

/** Signed relative error of a setting: (value − target) / norm. Positive = set too big (or too low, for alignment). */
export const perceptionError = (rd: PRound, value: number) => (value - rd.target) / rd.norm;

const BEAT_WINDOW: Record<Level, number> = { easy: 150, medium: 100, hard: 70 };

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: PRound[] = [];
  let round = 0;
  let values: number[] = [];
  let beatErrs: number[] = [];
  let misses = 0;
  let phase: 'adjust' | 'reveal' | 'done' = 'adjust';
  let revealAt = 0;
  let finTimer = 0;
  const metro = new Metronome();
  const beatMode = () => api.mode === 'beat';
  const controls = new Controls(stage, (t) => lock(t));

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 70;
    const ctrlH = 86;
    const F = Math.max(150, Math.min(W - 32, H - top - ctrlH - 20, 640));
    const k = F / 100;
    const cx = W / 2;
    const cy = top + Math.max(0, (H - top - ctrlH - F) / 2) + F / 2;
    return { k, F, cx, cy, cw: Math.min(W - 32, 520), cyCtrl: cy + F / 2 + 6 };
  };

  function setRound() {
    const rd = rounds[round];
    const info = TYPE_INFO[rd.type];
    controls.set([{ id: 'v', label: info.knob, lo: rd.lo, hi: rd.hi, value: rd.start, speed: (rd.hi - rd.lo) / 3.5 }]);
    controls.enabled = true;
    phase = 'adjust';
    api.progress(`${round + 1} / ${rounds.length}`);
    const sub = beatMode()
      ? `Lock on a beat (±${BEAT_WINDOW[api.level]} ms) · ${rd.illusion === 'none' ? 'no illusion' : ILLUSION_INFO[rd.illusion]}`
      : round === 0 && api.firstTime
        ? 'Drag the slider (or ← →, Shift fine) · Lock when it matches'
        : rd.illusion === 'none'
          ? 'No illusion this round'
          : ILLUSION_INFO[rd.illusion];
    api.prompt(info.ask, sub);
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = makePerception(seed, api.level);
    round = 0;
    values = [];
    beatErrs = [];
    misses = 0;
    if (beatMode()) {
      const bpm = rng(seed ^ 0x9e3779b9).range(76, 96);
      metro.run(performance.now() + 600, bpm);
    } else metro.stop();
    setRound();
    stage.request();
  }

  function lock(t: number) {
    if (phase !== 'adjust') return;
    const rd = rounds[round];
    const v = controls.get('v').value;
    if (beatMode()) {
      const off = latency()?.offset ?? 0;
      const { err } = metro.nearest(t - off);
      if (Math.abs(err) > BEAT_WINDOW[api.level]) {
        misses++;
        api.sfx.over();
        api.prompt(`Off the beat by ${signed(err, 0)} ms — lock again, on a beat.`, `The window is ±${BEAT_WINDOW[api.level]} ms · your setting is kept`);
        return;
      }
      beatErrs.push(err);
    }
    values.push(v);
    const e = perceptionError(rd, v);
    {
      const { k, cx, cy } = layout();
      api.judge(Math.abs(e) * 100, { x: cx, y: cy - 50 * k - 24 });
    }
    addBias('perception', rd.type, { e, ctx: rd.illusion !== 'none', fooled: rd.polarity ? rd.polarity * e : undefined });
    phase = 'reveal';
    controls.enabled = false;
    revealAt = performance.now();
    const pctS = signed(e * 100, 1) + '%';
    if (Math.abs(e) < 0.005) api.sfx.near();
    else api.sfx.release();
    api.buzz(10);
    let why = '';
    if (rd.polarity) {
      const fooled = rd.polarity * e;
      why = fooled > 0.015 ? ' — pulled the way the illusion predicts.' : fooled < -0.015 ? ' — you over-corrected against the illusion.' : ' — you saw through it.';
    }
    const last = round === rounds.length - 1;
    api.prompt(`${pctS}${why}`, last ? '' : 'Tap, or press Enter, for the next one');
    if (last) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal') return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    metro.stop();
    const errs = rounds.map((rd, i) => perceptionError(rd, values[i]));
    const mean = (errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length) * 100;
    const disp = mean.toFixed(1);
    const worst = errs.reduce((w, e, i) => (Math.abs(e) > Math.abs(errs[w]) ? i : w), 0);
    const rows: [string, string][] = rounds.map((rd, i) => {
      const u = TYPE_INFO[rd.type].unit;
      const tv = rd.type === 'align' ? 0 : rd.target;
      const yv = rd.type === 'align' ? values[i] - rd.target : values[i];
      const label = `${TYPE_INFO[rd.type].name} · ${rd.illusion === 'none' ? 'plain' : ILLUSION_INFO[rd.illusion]}`;
      const val =
        rd.type === 'align'
          ? `offset ${signed(yv, 1)} u on a ${rd.norm.toFixed(0)} u bar → ${signed(errs[i] * 100, 1)}%`
          : `${tv.toFixed(1)} → ${yv.toFixed(1)} ${u} (${signed(errs[i] * 100, 1)}%)`;
      return [label, val];
    });
    // Personal bias profile, per type (all levels). Only claims a systematic bias with enough evidence.
    for (const t of TYPES) {
      const b = biasOf('perception', t);
      const f = fooledOf('perception', t);
      let s: string;
      if (b.n < 8) s = `not enough data yet (${b.n} of 8 rounds)`;
      else if (b.systematic) s = `${b.mean > 0 ? 'you set it too big' : 'you set it too small'} by ${Math.abs(b.mean * 100).toFixed(1)}% ± ${(b.se * 100).toFixed(1)} — systematic`;
      else s = `no consistent direction (mean ${signed(b.mean * 100, 1)}% ± ${(b.se * 100).toFixed(1)}, n = ${b.n})`;
      if (f.n >= 8) s += f.systematic && f.mean > 0 ? ' · fooled by its illusion' : f.systematic && f.mean < 0 ? ' · over-corrects its illusion' : '';
      rows.push([`Your ${TYPE_INFO[t].name.toLowerCase()} bias`, s]);
    }
    const withCtx = TYPES.map((t) => biasOf('perception', t, (s) => s.ctx));
    const noCtx = TYPES.map((t) => biasOf('perception', t, (s) => !s.ctx));
    const avg = (bs: { abs: number; n: number }[]) => {
      const n = bs.reduce((a, b) => a + b.n, 0);
      return n ? { v: bs.reduce((a, b) => a + (b.n ? b.abs * b.n : 0), 0) / n, n } : null;
    };
    const wc = avg(withCtx);
    const nc = avg(noCtx);
    if (wc && nc && wc.n >= 5 && nc.n >= 5) rows.push(['Mean |error| with / without context', `${(wc.v * 100).toFixed(1)}% / ${(nc.v * 100).toFixed(1)}%`]);
    if (beatMode()) {
      const mb = beatErrs.reduce((a, e) => a + Math.abs(e), 0) / Math.max(1, beatErrs.length);
      const cal = latency();
      rows.push(['Lock timing (mean |error|)', `${mb.toFixed(0)} ms from the beat`]);
      rows.push(['Locks rejected off the beat', String(misses)]);
      rows.push(['Latency correction', cal ? `${signed(-cal.offset, 0)} ms (calibrated in False Beat)` : 'none — calibrate in False Beat']);
    }
    const wr = rounds[worst];
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '%',
          label: 'mean relative error',
          headline:
            disp === '0.0'
              ? 'Five measurements, all exact. The illusions didn’t work on you.'
              : `Off by ${disp}% on average. The hardest was ${TYPE_INFO[wr.type].name.toLowerCase()}${wr.illusion === 'none' ? '' : ` under ${ILLUSION_INFO[wr.illusion]}`} (${signed(errs[worst] * 100, 1)}%).`,
          rows,
          accuracy: 1 - mean / 100,
          perfect: disp === '0.0',
          near: mean < 1.5,
          share: [`PERCEPTION · ${api.level}${beatMode() ? ' · on the beat' : ''} — real geometry under illusions`, `mean error ${disp}%`],
        }),
      api.motion() ? 700 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') next();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const onVis = () => {
    if (document.hidden && beatMode() && phase !== 'done') api.voidRun('Attempt voided — the tab was hidden while the beat was running.');
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      // The lock itself also arrives as Enter (handled, and marked, by the controls): don't skip its reveal.
      if (!gameKey(e) || e.repeat || e.defaultPrevented) return;
      if ((e.key === 'Enter' || e.code === 'Space') && phase === 'reveal') {
        e.preventDefault();
        next();
      }
    }),
  ];

  // ── Rendering: every shape below is drawn from the round's numbers ──────────
  function drawRound(c: CanvasRenderingContext2D, rd: PRound, v: number, X: (u: number) => number, Y: (u: number) => number, k: number, reveal: number) {
    const ink = pal.ink;
    const ctxAlpha = 1 - 0.75 * reveal; // the context fades during the reveal
    switch (rd.type) {
      case 'length': {
        const shaft = (p: V, L: number, fins: number) => {
          line(c, X(p.x - L / 2), Y(p.y), X(p.x + L / 2), Y(p.y), ink, 2.5);
          if (rd.illusion === 'mullerlyer') {
            c.globalAlpha = ctxAlpha;
            const f = rd.k;
            const a = (36 * Math.PI) / 180;
            for (const end of [-1, 1]) {
              const ex = p.x + (end * L) / 2;
              // fins = +1: tails (>—<, looks longer) ; −1: arrowheads (<—>, looks shorter)
              const dir = end * fins;
              line(c, X(ex), Y(p.y), X(ex + dir * f * Math.cos(a)), Y(p.y - f * Math.sin(a)), ink, 2);
              line(c, X(ex), Y(p.y), X(ex + dir * f * Math.cos(a)), Y(p.y + f * Math.sin(a)), ink, 2);
            }
            c.globalAlpha = 1;
          } else {
            line(c, X(p.x - L / 2), Y(p.y) - 6, X(p.x - L / 2), Y(p.y) + 6, ink, 1.5);
            line(c, X(p.x + L / 2), Y(p.y) - 6, X(p.x + L / 2), Y(p.y) + 6, ink, 1.5);
          }
        };
        if (rd.illusion === 'ponzo') {
          c.globalAlpha = ctxAlpha;
          line(c, X(-44), Y(46), X(-9), Y(-46), pal.ink2, 1.5);
          line(c, X(44), Y(46), X(9), Y(-46), pal.ink2, 1.5);
          c.globalAlpha = 1;
        }
        shaft(rd.ref, rd.target, rd.polarity);
        shaft(rd.adj, v, -rd.polarity);
        if (reveal > 0) {
          // The reference shaft, moved onto yours.
          const x0 = rd.adj.x - v / 2;
          c.globalAlpha = reveal;
          line(c, X(x0), Y(rd.adj.y + 7), X(x0 + rd.target), Y(rd.adj.y + 7), pal.ink3, 2, [4, 3]);
          if (Math.abs(v - rd.target) * k > 1.5) bracket(c, X(x0 + rd.target), Y(rd.adj.y + 12), X(x0 + v), Y(rd.adj.y + 12), pal.signal, 4, 1.5);
          tag(c, `${signed(v - rd.target, 1)} u`, X(x0 + (rd.target + v) / 2), Y(rd.adj.y + 18), pal.signal, 11);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'size': {
        const disk = (p: V, R0: number, small: boolean) => {
          if (rd.illusion === 'ebbinghaus') {
            c.globalAlpha = ctxAlpha;
            if (small) {
              const ring = 1.5 * rd.target + 4;
              for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2;
                circle(c, X(p.x + Math.cos(a) * ring), Y(p.y + Math.sin(a) * ring), 1.8 * k, undefined, pal.ink3);
              }
            } else {
              const Rl = rd.k;
              const ring = 1.5 * rd.target + 2 + Rl;
              for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
                circle(c, X(p.x + Math.cos(a) * ring), Y(p.y + Math.sin(a) * ring), Rl * k, undefined, pal.ink3);
              }
            }
            c.globalAlpha = 1;
          }
          circle(c, X(p.x), Y(p.y), R0 * k, undefined, ink);
        };
        disk(rd.ref, rd.target, rd.polarity > 0);
        disk(rd.adj, v, rd.polarity < 0);
        if (reveal > 0) {
          c.globalAlpha = reveal;
          circle(c, X(rd.adj.x), Y(rd.adj.y), rd.target * k, pal.signal, undefined, 2, [4, 3]);
          tag(c, `r ${rd.target.toFixed(1)} → ${v.toFixed(1)} u`, X(rd.adj.x), Y(rd.adj.y + 1.5 * rd.target + 14), pal.signal, 11);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'gap': {
        const H2 = 7;
        const bw = 1.6;
        const pair = (p: V, g: number, filled: boolean) => {
          c.fillStyle = ink;
          c.fillRect(X(p.x - g / 2 - bw), Y(p.y - H2), bw * k, 2 * H2 * k);
          c.fillRect(X(p.x + g / 2), Y(p.y - H2), bw * k, 2 * H2 * k);
          if (rd.illusion === 'oppel' && filled) {
            c.globalAlpha = ctxAlpha;
            const n = rd.k;
            for (let i = 1; i < n; i++) {
              const x = p.x - g / 2 + (g * i) / n;
              line(c, X(x), Y(p.y - H2 * 0.55), X(x), Y(p.y + H2 * 0.55), pal.ink2, 1.25);
            }
            c.globalAlpha = 1;
          }
        };
        pair(rd.ref, rd.target, rd.polarity > 0);
        // The filled gap is fixed in size, so the reference must be the filled one or the empty one —
        // the adjustable one gets the other treatment.
        pair(rd.adj, v, rd.polarity < 0);
        if (reveal > 0) {
          c.globalAlpha = reveal;
          const x0 = rd.adj.x - v / 2;
          line(c, X(x0), Y(rd.adj.y + H2 + 4), X(x0 + rd.target), Y(rd.adj.y + H2 + 4), pal.ink3, 2, [4, 3]);
          if (Math.abs(v - rd.target) * k > 1.5) bracket(c, X(x0 + rd.target), Y(rd.adj.y + H2 + 9), X(x0 + v), Y(rd.adj.y + H2 + 9), pal.signal, 4, 1.5);
          tag(c, `${signed(v - rd.target, 1)} u`, X(x0 + (rd.target + v) / 2), Y(rd.adj.y + H2 + 15), pal.signal, 11);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'angle': {
        const rays = (p: V, open: number, rot: number, len: number, hatchIt: boolean) => {
          const b = ((rot - 90) * Math.PI) / 180; // bisector, 0 = straight up
          for (const s of [-1, 1]) {
            const a = b + (s * open * Math.PI) / 360;
            line(c, X(p.x), Y(p.y), X(p.x + Math.cos(a) * len), Y(p.y + Math.sin(a) * len), ink, 2.5);
            if (hatchIt) {
              c.globalAlpha = ctxAlpha;
              for (let i = 1; i <= 5; i++) {
                const d = (len * i) / 6;
                const qx = p.x + Math.cos(a) * d;
                const qy = p.y + Math.sin(a) * d;
                const ha = a + s * 0.75 + ((i % 2) * Math.PI) / 2;
                line(c, X(qx - (Math.cos(ha) * rd.k) / 2), Y(qy - (Math.sin(ha) * rd.k) / 2), X(qx + (Math.cos(ha) * rd.k) / 2), Y(qy + (Math.sin(ha) * rd.k) / 2), pal.ink2, 1.25);
              }
              c.globalAlpha = 1;
            }
          }
          circle(c, X(p.x), Y(p.y), 3, undefined, ink);
        };
        rays({ x: rd.ref.x, y: rd.ref.y + 12 * Math.cos((rd.rot * Math.PI) / 180) }, rd.target, rd.rot, 24, rd.illusion === 'zollner');
        rays(rd.adj, v, 0, 26, false);
        if (reveal > 0) {
          c.globalAlpha = reveal;
          const b = -Math.PI / 2;
          for (const s of [-1, 1]) {
            const a = b + (s * rd.target * Math.PI) / 360;
            line(c, X(rd.adj.x), Y(rd.adj.y), X(rd.adj.x + Math.cos(a) * 30), Y(rd.adj.y + Math.sin(a) * 30), pal.signal, 1.5, [4, 3]);
          }
          tag(c, `${rd.target.toFixed(1)}° → ${v.toFixed(1)}°`, X(rd.adj.x), Y(rd.adj.y + 6), pal.signal, 11);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'align': {
        const w = rd.norm;
        const m = rd.rot;
        const lx0 = -w / 2 - 34;
        line(c, X(lx0), Y(rd.ref.y - m * 34), X(-w / 2), Y(rd.ref.y), ink, 2.5);
        line(c, X(w / 2), Y(v), X(w / 2 + 34), Y(v + m * 34), ink, 2.5);
        if (rd.illusion === 'poggendorff') {
          c.globalAlpha = 1 - 0.85 * reveal;
          c.fillStyle = pal.paper2;
          c.fillRect(X(-w / 2), Y(-46), w * k, 92 * k);
          c.strokeStyle = pal.ink2;
          c.lineWidth = 1.25;
          c.strokeRect(X(-w / 2), Y(-46), w * k, 92 * k);
          c.globalAlpha = 1;
        } else {
          line(c, X(-w / 2), Y(-40), X(-w / 2), Y(40), pal.line, 1, [2, 4]);
          line(c, X(w / 2), Y(-40), X(w / 2), Y(40), pal.line, 1, [2, 4]);
        }
        if (reveal > 0) {
          c.globalAlpha = reveal;
          line(c, X(-w / 2), Y(rd.ref.y), X(w / 2 + 34), Y(rd.ref.y + m * (w + 34)), pal.signal, 1.5, [4, 3]);
          if (Math.abs(v - rd.target) * k > 1.5) bracket(c, X(w / 2 + 3), Y(rd.target), X(w / 2 + 3), Y(v), pal.signal, 4, 1.5);
          tag(c, `${signed(v - rd.target, 1)} u`, X(w / 2 + 14), Y((rd.target + v) / 2), pal.signal, 11, 'left');
          c.globalAlpha = 1;
        }
        break;
      }
    }
  }

  stage.draw = (now) => {
    const c = stage.ctx;
    const { k, cx, cy, cw, cyCtrl } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = controls.tick(now);
    const rd = rounds[Math.min(round, rounds.length - 1)];
    if (!rd) return false;
    const showing = phase !== 'adjust';
    const v = showing ? values[round] : controls.get('v').value;
    const rp = showing ? (api.motion() ? easeOut((now - revealAt) / 500) : 1) : 0;
    if (showing && rp < 1) more = true;
    // A plain plate behind the figure: uniform, so it frames the illusion without changing it.
    plate(c, X(-50), Y(-50), 100 * k, 100 * k, 18);
    drawRound(c, rd, v, X, Y, k, rp);

    if (beatMode() && phase !== 'done') {
      // Visual beat: a ring that flashes on every beat (the sound is optional).
      const p = metro.pos(now);
      const since = (p - Math.floor(p)) * metro.period;
      const flash = clamp(1 - since / 140, 0, 1);
      const bx = X(46);
      const by = Y(-46);
      beatLamp(c, bx, by, 9, flash);
      text(c, 'BEAT', bx - 16, by, font.mono(9, 500), pal.ink3, 'right', 'middle');
      more = true;
    }
    if (phase === 'adjust') controls.draw(c, cx - cw / 2, cyCtrl, cw);
    else if (phase === 'reveal') text(c, 'tap for the next one ▸', cx, cyCtrl + 30, font.mono(11, 500), pal.ink2, 'center');

    // Round strip
    const sy = stage.h - 16;
    const gap = Math.min(64, stage.w / (rounds.length + 2));
    for (let i = 0; i < rounds.length; i++) {
      const x = stage.w / 2 + (i - (rounds.length - 1) / 2) * gap;
      const done = i < values.length;
      if (done) text(c, (Math.abs(perceptionError(rounds[i], values[i])) * 100).toFixed(1), x, sy, font.mono(10, 500), pal.ink, 'center');
      else {
        rr(c, x - 9, sy - 6, 18, 4, 2);
        c.fillStyle = i === round ? pal.accent : pal.line;
        c.fill();
      }
    }
    if (phase === 'reveal' && rd.polarity) {
      const why = ILLUSION_WHY[rd.illusion]?.(rd.polarity);
      if (why) {
        c.globalAlpha = rp;
        c.font = font.sans(12);
        const ww = c.measureText(why).width + 28;
        rr(c, cx - ww / 2, Y(48) - 9, ww, 24, 12);
        c.fillStyle = pal.paper2;
        c.fill();
        text(c, why, cx, Y(48) + 4, font.sans(12), pal.ink2, 'center');
        c.globalAlpha = 1;
      }
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      metro.stop();
      controls.destroy();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
