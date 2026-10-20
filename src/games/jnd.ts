// 49 · JND — the just-noticeable difference, measured with adaptive staircases.
// Each run interleaves three stimulus types chosen by the variation scheduler (length, size, tilt, gap,
// speed, contrast). Every type has its own 2-down / 1-up staircase on a log scale, which settles near the
// difference you get right about 71% of the time: two right answers in a row make the next comparison
// harder, one error makes it easier. Steps are ×1.5 until the second reversal, ×1.22 after. The estimate is
// the geometric mean of the reversal points after the first (or of the last four trials if there were too
// few reversals). Types are never pooled into one threshold: each is reported in its own unit, and the
// score is the mean of thresholds expressed as a share of each type's starting difference.
// The correct side is counterbalanced per type (equal left and right, never more than three in a row), and
// irrelevant properties — base size, position, base angle, phase — are jittered every trial.
// These are estimates of discrimination within this game on this screen, not clinical measurements.
import { clamp, font, pal, text, TAU } from '../core/draw';
import { alpha, plate } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { Bench, shuffle } from './kit';
import { chooseFamily, famChip, generate, loadHistory, pushHistory, saveHistory, type Band, type Family } from './lab';

export type JndType = 'length' | 'size' | 'tilt' | 'gap' | 'speed' | 'contrast';

export interface JndSpec {
  type: JndType;
  /** Layout variant (orientation, shape, base angle region…). */
  variant: string;
  /** Oblique base angles and stronger jitter at high bands. */
  band: Band;
}

export const START: Record<JndType, number> = { length: 0.25, size: 0.25, tilt: 10, gap: 0.3, speed: 0.4, contrast: 0.5 };
const FLOOR: Record<JndType, number> = { length: 0.006, size: 0.006, tilt: 0.2, gap: 0.01, speed: 0.015, contrast: 0.02 };
export const QUESTION: Record<JndType, string> = {
  length: 'Which line is longer?',
  size: 'Which shape is bigger?',
  tilt: 'Which line is turned further clockwise?',
  gap: 'Which gap is smaller?',
  speed: 'Which dot moves faster?',
  contrast: 'Which patch stands out more from the grey?',
};
const NAMES: Record<JndType, string> = { length: 'Length', size: 'Size', tilt: 'Tilt', gap: 'Gap', speed: 'Speed', contrast: 'Contrast' };
export const fmtDelta = (t: JndType, d: number) => (t === 'tilt' ? `${d.toFixed(2)}°` : `${(d * 100).toFixed(1)}%`);
const UNIT_WORD: Record<JndType, string> = { length: 'longer', size: 'larger', tilt: 'more turned', gap: 'narrower', speed: 'faster', contrast: 'more contrast' };

const variants: Record<JndType, string[]> = {
  length: ['horizontal', 'vertical', 'oblique'],
  size: ['disc', 'square'],
  tilt: ['near vertical', 'near horizontal', 'oblique'],
  gap: ['horizontal', 'vertical'],
  speed: ['horizontal', 'vertical'],
  contrast: ['lighter', 'darker'],
};

export const FAMILIES: Family<JndSpec>[] = (Object.keys(START) as JndType[]).map((type) => ({
  id: type,
  name: NAMES[type],
  teach: QUESTION[type],
  bands: [0, 3] as [Band, Band],
  intro: type === 'length',
  gen: (r: Rng, band: Band) => {
    const vs = variants[type];
    // Oblique layouts (harder: the "oblique effect") only from band 2.
    const ok = band >= 2 ? vs : vs.filter((v) => v !== 'oblique');
    return { type, variant: r.pick(ok), band };
  },
  sig: (s: JndSpec) => `${s.type}|${s.variant}`,
}));

// ── Staircase ───────────────────────────────────────────────────────────────────

export interface Stair {
  type: JndType;
  delta: number;
  streak: number;
  /** Last step direction: −1 harder, +1 easier, 0 none yet. */
  dir: -1 | 0 | 1;
  reversals: number[];
  trials: { d: number; ok: boolean }[];
}

export const newStair = (type: JndType): Stair => ({ type, delta: START[type], streak: 0, dir: 0, reversals: [], trials: [] });

/** 2-down / 1-up on a log scale (converges near 70.7% correct). Pure. */
export function stairStep(s: Stair, ok: boolean): Stair {
  const n: Stair = { ...s, reversals: [...s.reversals], trials: [...s.trials, { d: s.delta, ok }] };
  const f = s.reversals.length < 2 ? 1.5 : 1.22;
  if (ok) {
    n.streak = s.streak + 1;
    if (n.streak >= 2) {
      n.streak = 0;
      if (s.dir === 1) n.reversals.push(s.delta);
      n.dir = -1;
      n.delta = Math.max(FLOOR[s.type], s.delta / f);
    }
  } else {
    n.streak = 0;
    if (s.dir === -1) n.reversals.push(s.delta);
    n.dir = 1;
    n.delta = Math.min(START[s.type] * 2, s.delta * f);
  }
  return n;
}

const gmean = (xs: number[]) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);

/** Threshold estimate in the type's own unit. */
export function threshold(s: Stair) {
  if (s.reversals.length >= 3) return gmean(s.reversals.slice(1));
  const last = s.trials.slice(-4).map((t) => t.d);
  return last.length ? gmean(last) : s.delta;
}

/** Equal numbers of left and right answers in random order, never more than three in a row. */
export function balancedSides(r: Rng, n: number): (0 | 1)[] {
  for (let tries = 0; tries < 200; tries++) {
    const a = shuffle(
      Array.from({ length: n }, (_, i) => (i < Math.ceil(n / 2) ? 0 : 1) as 0 | 1),
      r.next,
    );
    if (!a.some((_, i) => i >= 3 && a[i] === a[i - 1] && a[i] === a[i - 2] && a[i] === a[i - 3])) return a;
  }
  return Array.from({ length: n }, (_, i) => (i % 2) as 0 | 1);
}

const CFG: Record<Level, { types: number; trials: number; expose: number }> = {
  easy: { types: 2, trials: 10, expose: 0 },
  medium: { types: 3, trials: 12, expose: 1200 },
  hard: { types: 3, trials: 14, expose: 600 },
};

export interface JndPlan {
  specs: JndSpec[];
  /** Interleaved order of type indices. */
  order: number[];
  sides: (0 | 1)[][];
}

/** The run's plan from its seed and the variation history (pure; the history makes types rotate). */
export function makePlan(seed: number, level: Level, hist = { v: [] as string[], s: [] as string[] }, first = false): { plan: JndPlan; hist: typeof hist } {
  const r = rng(seed);
  const cfg = CFG[level];
  const specs: JndSpec[] = [];
  let h = hist;
  // Oblique layouts and stronger jitter from Medium.
  const band: Band = level === 'easy' ? 1 : level === 'medium' ? 2 : 3;
  for (let i = 0; i < cfg.types; i++) {
    const pool = FAMILIES.filter((f) => !specs.some((s) => s.type === f.id));
    const fam = i === 0 && first ? pool.find((f) => f.intro)! : chooseFamily(pool, band, h, r);
    const g = generate(fam, band, h, r);
    specs.push(g.rd);
    h = pushHistory(h, fam.id, g.sig);
  }
  // Interleave: shuffle a deck holding `trials` cards of each type, with no type more than 3 in a row.
  let order: number[] = [];
  for (let tries = 0; tries < 200; tries++) {
    order = shuffle(
      specs.flatMap((_, i) => Array.from({ length: cfg.trials }, () => i)),
      r.next,
    );
    if (!order.some((_, i) => i >= 3 && order[i] === order[i - 1] && order[i] === order[i - 2] && order[i] === order[i - 3])) break;
  }
  return { plan: { specs, order, sides: specs.map(() => balancedSides(r, cfg.trials)) }, hist: h };
}

/** Per-trial irrelevant variation, from the trial's own stream. */
interface Jit {
  base: number;
  dy: [number, number];
  ang: number;
  ph: [number, number];
}

function readBests(): Partial<Record<JndType, number>> {
  try {
    return JSON.parse(localStorage.getItem('eps:jnd:best') || '{}') ?? {};
  } catch {
    return {};
  }
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  stage.setMinWidth?.(440);
  let plan: JndPlan;
  let stairs: Stair[] = [];
  let k = 0;
  let count: number[] = [];
  let phase: 'trial' | 'fb' | 'done' = 'trial';
  let jit: Jit = { base: 1, dy: [0, 0], ang: 0, ph: [0, 0] };
  let correctSide: 0 | 1 = 0;
  let t0 = 0;
  let fb: { ok: boolean; side: 0 | 1 } | null = null;
  let r: Rng = rng(1);
  let finished = false;

  function reset(seed: number) {
    bench.clear();
    const out = makePlan(seed, api.level, loadHistory('jnd'), api.firstTime);
    saveHistory('jnd', out.hist);
    plan = out.plan;
    stairs = plan.specs.map((s) => newStair(s.type));
    count = plan.specs.map(() => 0);
    k = 0;
    finished = false;
    r = rng(seed ^ 0x5bd1e995);
    api.ownKeys(true);
    trial();
  }

  const spec = () => plan.specs[plan.order[k]];

  function trial() {
    phase = 'trial';
    fb = null;
    const ti = plan.order[k];
    correctSide = plan.sides[ti][count[ti]];
    const sp = spec();
    const strong = sp.band >= 2 ? 1.6 : 1;
    jit = {
      base: 1 + r.range(-0.12, 0.12) * strong,
      dy: [r.range(-1, 1) * 0.08 * strong, r.range(-1, 1) * 0.08 * strong],
      ang: sp.variant === 'near horizontal' ? 90 + r.range(-20, 20) : sp.variant === 'oblique' ? r.sign() * r.range(35, 55) : r.range(-20, 20),
      ph: [r.range(0, TAU), r.range(0, TAU)],
    };
    t0 = performance.now();
    api.progress(`${k + 1} / ${plan.order.length}`);
    api.prompt(QUESTION[sp.type], `← or → · tap a side${CFG[api.level].expose ? ' · it is shown briefly' : ''}${k === 0 ? ' · the differences shrink as you get them right' : ''}`);
    stage.request();
  }

  function answer(side: 0 | 1) {
    if (phase !== 'trial') return;
    const ti = plan.order[k];
    const ok = side === correctSide;
    stairs[ti] = stairStep(stairs[ti], ok);
    count[ti]++;
    fb = { ok, side: correctSide };
    phase = 'fb';
    api.sfx[ok ? 'soft' : 'release']();
    stage.request();
    bench.later(() => {
      k++;
      if (k >= plan.order.length) finish();
      else trial();
    }, ok ? 320 : 650);
  }

  function finish() {
    if (finished) return;
    finished = true;
    phase = 'done';
    api.ownKeys(false);
    const bests = readBests();
    const rows: [string, string][] = [];
    const pcts: number[] = [];
    plan.specs.forEach((sp, i) => {
      const s = stairs[i];
      const th = threshold(s);
      const pct = (th / START[sp.type]) * 100;
      pcts.push(pct);
      const right = s.trials.filter((t) => t.ok).length;
      const prev = bests[sp.type];
      if (!api.practice && (prev === undefined || th < prev)) bests[sp.type] = th;
      rows.push([`${NAMES[sp.type]} (${sp.variant})`, `${fmtDelta(sp.type, th)} ${UNIT_WORD[sp.type]} · ${right}/${s.trials.length} right · ${s.reversals.length} reversals${prev !== undefined ? ` · best ${fmtDelta(sp.type, Math.min(prev, th))}` : ''}`]);
    });
    try {
      localStorage.setItem('eps:jnd:best', JSON.stringify(bests));
    } catch {
      /* ignore */
    }
    rows.push(['Method', '2-down / 1-up staircases, interleaved; threshold ≈ 71% correct']);
    rows.push(['Note', 'A game estimate on this screen — not a clinical measurement']);
    const score = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    const bestType = plan.specs[pcts.indexOf(Math.min(...pcts))];
    bench.finish({
      score,
      value: score.toFixed(1),
      unit: '%',
      label: 'mean threshold, as a share of the starting difference',
      headline: `Finest: ${NAMES[bestType.type].toLowerCase()}, ${fmtDelta(bestType.type, threshold(stairs[plan.specs.indexOf(bestType)]))} ${UNIT_WORD[bestType.type]}.`,
      rows,
      accuracy: clamp(1 - score / 100, 0, 1),
      near: score < 22,
      share: [`JND · ${api.level}`, ...plan.specs.map((sp, i) => `${NAMES[sp.type]} ${fmtDelta(sp.type, threshold(stairs[i]))}`)],
    });
  }

  bench.onTap = (p) => {
    if (phase !== 'trial') return;
    answer(p.x < stage.w / 2 ? 0 : 1);
  };
  bench.onKey = (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft') answer(0);
    else if (e.key === 'ArrowRight') answer(1);
    else return;
    e.preventDefault();
  };

  /** Draw one stimulus at (cx, cy) with half-width S. `big` = this side carries the difference. */
  function stim(c: CanvasRenderingContext2D, side: 0 | 1, cx: number, cy: number, S: number, now: number) {
    const sp = spec();
    const s = stairs[plan.order[k]];
    const d = s.delta;
    const diff = side === correctSide;
    const y = cy + jit.dy[side] * S * 2;
    c.save();
    c.lineCap = 'round';
    switch (sp.type) {
      case 'length': {
        const L = S * 0.7 * jit.base * (diff ? 1 + d : 1);
        const a = sp.variant === 'vertical' ? Math.PI / 2 : sp.variant === 'oblique' ? Math.PI / 4 : 0;
        c.strokeStyle = pal.ink;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(cx - (Math.cos(a) * L) / 2, y - (Math.sin(a) * L) / 2);
        c.lineTo(cx + (Math.cos(a) * L) / 2, y + (Math.sin(a) * L) / 2);
        c.stroke();
        break;
      }
      case 'size': {
        // Equal-area comparison is not intended: the difference is in diameter / side length.
        const D = S * 0.5 * jit.base * (diff ? 1 + d : 1);
        c.fillStyle = pal.ink;
        if (sp.variant === 'square') c.fillRect(cx - D / 2, y - D / 2, D, D);
        else {
          c.beginPath();
          c.arc(cx, y, D / 2, 0, TAU);
          c.fill();
        }
        break;
      }
      case 'tilt': {
        const a = ((jit.ang + (diff ? d : 0)) * Math.PI) / 180;
        const L = S * 0.8;
        c.strokeStyle = pal.ink;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(cx - (Math.sin(a) * L) / 2, y + (Math.cos(a) * L) / 2);
        c.lineTo(cx + (Math.sin(a) * L) / 2, y - (Math.cos(a) * L) / 2);
        c.stroke();
        break;
      }
      case 'gap': {
        const g = S * 0.34 * jit.base * (diff ? 1 / (1 + d) : 1);
        const v = sp.variant === 'vertical';
        c.fillStyle = pal.ink;
        for (const sg of [-1, 1]) {
          c.beginPath();
          c.arc(cx + (v ? 0 : (sg * g) / 2), y + (v ? (sg * g) / 2 : 0), 5, 0, TAU);
          c.fill();
        }
        break;
      }
      case 'speed': {
        const f = 0.75 * (diff ? 1 + d : 1) * jit.base;
        const A = S * 0.55;
        const u = Math.sin(TAU * f * ((now - t0) / 1000) + jit.ph[side]) * A;
        const v = sp.variant === 'vertical';
        c.strokeStyle = pal.line;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(cx - (v ? 0 : A), y - (v ? A : 0));
        c.lineTo(cx + (v ? 0 : A), y + (v ? A : 0));
        c.stroke();
        c.fillStyle = pal.ink;
        c.beginPath();
        c.arc(cx + (v ? 0 : u), y + (v ? u : 0), 7, 0, TAU);
        c.fill();
        break;
      }
      case 'contrast': {
        // A grey surround and a patch whose contrast with it differs (screen-relative, internally consistent).
        const bg = 0.36;
        const cst = 0.3 * jit.base * (diff ? 1 + d : 1) * (sp.variant === 'darker' ? -1 : 1);
        const g = (v: number) => {
          const q = Math.round(clamp(v, 0, 1) * 255);
          return `rgb(${q},${q},${q})`;
        };
        c.fillStyle = g(bg);
        c.fillRect(cx - S * 0.62, cy - S * 0.62, S * 1.24, S * 1.24);
        c.fillStyle = g(bg * (1 + cst));
        c.fillRect(cx - S * 0.25, y - S * 0.25, S * 0.5, S * 0.5);
        break;
      }
    }
    c.restore();
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    if (!plan) return false;
    const W = stage.w;
    const H = stage.h;
    const sp = spec();
    famChip(c, 16, 80, `${NAMES[sp.type]} · ${sp.variant}`, sp.band);
    const top = 112;
    const S = Math.min((W - 64) / 4.4, (H - top - 110) / 2.2, 170);
    const cy = top + S * 1.15;
    const cxs = [W / 2 - S * 1.3, W / 2 + S * 1.3];
    const expose = CFG[api.level].expose;
    const masked = phase === 'trial' && expose > 0 && now - t0 > expose;
    cxs.forEach((cx, side) => {
      plate(c, cx - S * 1.05, cy - S * 1.05, S * 2.1, S * 2.1, 8);
      if (phase === 'done') return;
      if (!masked) stim(c, side as 0 | 1, cx, cy, S, now);
      else {
        // A neutral mask after the brief exposure.
        c.fillStyle = alpha(pal.ink, 0.05);
        for (let i = 0; i < 9; i++) c.fillRect(cx - S * 0.7 + ((i * 37) % 100) * S * 0.014, cy - S * 0.7 + ((i * 53) % 100) * S * 0.014, S * 0.3, S * 0.3);
      }
      if (fb) {
        const isAns = side === fb.side;
        if (isAns) {
          c.strokeStyle = fb.ok ? pal.accent : pal.signal;
          c.lineWidth = 2;
          c.strokeRect(cx - S * 1.05 + 3, cy - S * 1.05 + 3, S * 2.1 - 6, S * 2.1 - 6);
          text(c, fb.ok ? '✓' : 'this one', cx, cy + S * 1.05 + 20, font.mono(12, 600), fb.ok ? pal.accent : pal.signal, 'center');
        }
      }
      text(c, side ? '→' : '←', cx, cy - S * 1.05 - 10, font.mono(12, 600), pal.ink3, 'center');
    });
    // Staircase traces: one sparkline per type.
    const sy = H - 30;
    plan.specs.forEach((sp2, i) => {
      const s = stairs[i];
      const x0 = W / 2 - 330 + i * 230;
      const w = 190;
      if (x0 < 8 || x0 + w > W - 8) return;
      text(c, NAMES[sp2.type], x0, sy - 30, font.mono(9, 600), i === plan.order[k] && phase !== 'done' ? pal.accent : pal.ink3);
      const n = CFG[api.level].trials;
      const ly = (d: number) => sy - 4 - (Math.log(d / FLOOR[sp2.type]) / Math.log((START[sp2.type] * 2) / FLOOR[sp2.type])) * 22;
      c.strokeStyle = pal.line;
      c.beginPath();
      s.trials.forEach((t, j) => {
        const x = x0 + (j / Math.max(1, n - 1)) * w;
        j ? c.lineTo(x, ly(t.d)) : c.moveTo(x, ly(t.d));
      });
      c.stroke();
      s.trials.forEach((t, j) => {
        c.beginPath();
        c.arc(x0 + (j / Math.max(1, n - 1)) * w, ly(t.d), 2.2, 0, TAU);
        c.fillStyle = t.ok ? pal.accent : pal.signal;
        c.fill();
      });
    });
    return phase === 'trial' && (sp.type === 'speed' || (expose > 0 && now - t0 < expose + 50));
  };

  return {
    reset,
    destroy: () => {
      api.ownKeys(false);
      bench.destroy();
    },
  };
};

export default factory;
