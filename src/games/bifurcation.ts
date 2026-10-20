// 51 · BIFURCATION — find where a system changes its kind of behaviour.
// Two well-understood discrete maps, iterated exactly:
//   logistic  x ↦ r·x·(1 − x)        r ∈ [2.4, 4]
//   Ricker    x ↦ x·e^{r(1 − x)}      r ∈ [1.4, 3.1]
// Behaviour is classified numerically, never assumed: iterate past a transient, then look for the
// smallest period p ≤ 32 with |x_{n+p} − x_n| < 10⁻⁶ over a long window. No period → "irregular", and it
// is called chaotic only when the Lyapunov exponent (mean ln|f′(x)|) is clearly positive. Transitions are
// located by bisection on that classification with a long transient (convergence slows near a
// bifurcation), and every tolerance in a task is wider than that numerical uncertainty. Targets are drawn
// from intervals measured this way, with margins from their edges.
import { clamp, font, pal, text, TAU } from '../core/draw';
import { alpha, plate } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, type Pt } from './kit';
import { famChip, Session, Sliders, type Band, type Family } from './lab';

export type Model = 'logistic' | 'ricker';
export const RANGE: Record<Model, [number, number]> = { logistic: [2.4, 4], ricker: [1.4, 3.1] };
export const X0: Record<Model, number> = { logistic: 0.2, ricker: 0.4 };

export const step = (m: Model, r: number, x: number) => (m === 'logistic' ? r * x * (1 - x) : x * Math.exp(r * (1 - x)));
const deriv = (m: Model, r: number, x: number) => (m === 'logistic' ? r * (1 - 2 * x) : Math.exp(r * (1 - x)) * (1 - r * x));

export interface Behaviour {
  /** 1 = fixed point, k = period-k cycle, 0 = no period ≤ 32 found. */
  period: number;
  lyap: number;
  /** The attractor's points (sorted) for periodic behaviour, or a sample of the orbit. */
  pts: number[];
}

export function classify(m: Model, r: number, x0 = X0[m], trans = 4000, win = 600): Behaviour {
  let x = x0;
  for (let i = 0; i < trans; i++) x = step(m, r, x);
  const orbit: number[] = [];
  let ly = 0;
  for (let i = 0; i < win; i++) {
    orbit.push(x);
    ly += Math.log(Math.max(1e-300, Math.abs(deriv(m, r, x))));
    x = step(m, r, x);
  }
  for (let p = 1; p <= 32; p++) {
    let ok = true;
    for (let i = 0; i + p < win && ok; i++) if (Math.abs(orbit[i + p] - orbit[i]) > 1e-6) ok = false;
    if (ok) return { period: p, lyap: ly / win, pts: orbit.slice(0, p).sort((a, b) => a - b) };
  }
  return { period: 0, lyap: ly / win, pts: orbit.slice(0, 64) };
}

export const isChaotic = (b: Behaviour) => b.period === 0 && b.lyap > 0.02;

/** Smallest r in [lo, hi] at which the period stops being `p` (bisection; hi must not be period p). */
export function boundary(m: Model, p: number, lo: number, hi: number) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (classify(m, mid, X0[m], 30000, 400).period === p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Interval {
  p: number;
  lo: number;
  hi: number;
}

const tables = new Map<Model, Interval[]>();
/** Periodic windows of a model, scanned on a 0.0025 grid (cached). */
export function windows(m: Model): Interval[] {
  const hit = tables.get(m);
  if (hit) return hit;
  const [a, b] = RANGE[m];
  const out: Interval[] = [];
  let cur: Interval | null = null;
  for (let r = a; r <= b + 1e-9; r += 0.0025) {
    const p = classify(m, r, X0[m], 2500, 300).period;
    if (cur && cur.p === p) cur.hi = r;
    else {
      if (cur && cur.p > 0) out.push(cur);
      cur = { p, lo: r, hi: r };
    }
  }
  if (cur && cur.p > 0) out.push(cur);
  tables.set(m, out);
  return out;
}

export interface BifRound {
  kind: 'stable' | 'cycle' | 'edge' | 'robust' | 'sensitive';
  model: Model;
  /** Slider range for r. */
  lo: number;
  hi: number;
  /** stable: the target level of the fixed point. */
  level?: number;
  levelTol?: number;
  /** cycle / robust: the period asked for, and the window(s) that have it. */
  period?: number;
  wins?: Interval[];
  delta?: number;
  /** edge: the boundary between `from` and `to` behaviour, and the tolerance. */
  edge?: number;
  from?: number;
  to?: number;
  tol?: number;
  /** sensitive: fixed r and two starts; the answer is one of OUTCOMES. */
  r?: number;
  x0?: [number, number];
  answer?: number;
}

export const OUTCOMES = ['Same fixed point', 'Same cycle, in step', 'Same cycle, out of step', 'They diverge (irregular)'];

const name = (p: number) => (p === 1 ? 'a steady state' : `a ${p}-cycle`);

function genStable(r: Rng, band: Band): BifRound {
  // Logistic fixed point x* = 1 − 1/r, stable for 1 < r < 3.
  const level = Math.round(r.range(0.42, 0.65) * 1000) / 1000;
  return { kind: 'stable', model: 'logistic', lo: 1.2, hi: 3.7, level, levelTol: [0.012, 0.007, 0.004, 0.0025][band] };
}

function genCycle(r: Rng, band: Band): BifRound | null {
  const model: Model = r.next() < 0.5 ? 'logistic' : 'ricker';
  const wanted = band <= 1 ? [2] : band === 2 ? [4, 3] : [3, 8, 4];
  const p = r.pick(wanted);
  const wins = windows(model).filter((w) => w.p === p && w.hi - w.lo >= 0.004);
  if (!wins.length) return null;
  return { kind: 'cycle', model, lo: RANGE[model][0], hi: RANGE[model][1], period: p, wins };
}

function genEdge(r: Rng, band: Band): BifRound | null {
  const model: Model = r.next() < 0.5 ? 'logistic' : 'ricker';
  const from = r.pick(band <= 1 ? [1] : band === 2 ? [1, 2] : [2, 4]);
  // The window's main body: right at a bifurcation, slow convergence can leave one-point artefacts on the grid.
  const w = windows(model).find((x) => x.p === from && x.hi - x.lo > 0.01);
  if (!w) return null;
  const edge = boundary(model, from, w.lo + 0.01, w.hi + 0.02);
  return { kind: 'edge', model, lo: RANGE[model][0], hi: RANGE[model][1], edge, from, to: from * 2, tol: [0.02, 0.01, 0.005, 0.003][band] };
}

function genRobust(r: Rng, band: Band): BifRound | null {
  const model: Model = r.next() < 0.5 ? 'logistic' : 'ricker';
  const p = r.pick(band <= 1 ? [1, 2] : [2, 4]);
  const delta = [0.05, 0.04, 0.03, 0.025][band];
  const wins = windows(model).filter((w) => w.p === p && w.hi - w.lo > 2 * delta + 0.01);
  if (!wins.length) return null;
  return { kind: 'robust', model, lo: RANGE[model][0], hi: RANGE[model][1], period: p, wins, delta };
}

function sensitiveAnswer(m: Model, r0: number, x0: number, x1: number) {
  let a = x0;
  let b = x1;
  let maxGap = 0;
  for (let i = 0; i < 5000; i++) {
    a = step(m, r0, a);
    b = step(m, r0, b);
    if (i > 50) maxGap = Math.max(maxGap, Math.abs(a - b));
  }
  const beh = classify(m, r0, x0);
  if (beh.period === 0) return isChaotic(beh) && maxGap > 0.05 ? 3 : -1;
  if (beh.period === 1) return Math.abs(a - b) < 1e-6 ? 0 : -1;
  if (Math.abs(a - b) < 1e-6) return 1;
  // Out of step: b sits on the same cycle, shifted.
  return beh.pts.some((q) => Math.abs(q - b) < 1e-5) ? 2 : -1;
}

function genSensitive(r: Rng, band: Band): BifRound | null {
  const model: Model = r.next() < 0.5 ? 'logistic' : 'ricker';
  const want = r.int(0, band === 0 ? 2 : 3);
  const ws = windows(model);
  let r0: number;
  if (want === 0) {
    const w = ws.find((x) => x.p === 1);
    if (!w) return null;
    r0 = r.range(w.lo + 0.05, w.hi - 0.05);
  } else if (want === 3) {
    r0 = model === 'logistic' ? r.range(3.65, 3.98) : r.range(2.75, 3.05);
  } else {
    const w = r.pick(ws.filter((x) => (x.p === 2 || x.p === 4) && x.hi - x.lo > 0.03));
    if (!w) return null;
    r0 = r.range(w.lo + 0.01, w.hi - 0.01);
  }
  const top = model === 'logistic' ? 0.95 : 2.2;
  const x0 = r.range(0.1, top * 0.8);
  let x1: number;
  if (want === 2) {
    // One step ahead on the orbit: the same cycle, shifted by one.
    x1 = step(model, r0, x0) + r.range(-1e-3, 1e-3);
  } else x1 = clamp(x0 + r.sign() * r.range(0.01, want === 3 ? 0.02 : 0.15), 0.02, top);
  // The displayed r is the one simulated (rounded to 3 decimals).
  const rr = Math.round(r0 * 1000) / 1000;
  const answer = sensitiveAnswer(model, rr, x0, x1);
  if (answer < 0) return null;
  return { kind: 'sensitive', model, lo: rr, hi: rr, r: rr, x0: [x0, x1], answer };
}

export const FAMILIES: Family<BifRound>[] = [
  { id: 'stable', name: 'Steady state', teach: 'Set the growth rate r and Run. Find the r at which the population settles exactly on the target level.', bands: [0, 3], intro: true, gen: genStable, sig: (rd) => `${Math.round(rd.level! * 50)}` },
  { id: 'cycle', name: 'Find a cycle', teach: 'Above a threshold the population stops settling and alternates. Find an r with the asked cycle.', bands: [0, 3], gen: genCycle, sig: (rd) => `${rd.model}|${rd.period}` },
  { id: 'edge', name: 'Transition', teach: 'Locate the exact r where one behaviour gives way to the next. Run either side and narrow it down.', bands: [1, 3], gen: genEdge, sig: (rd) => `${rd.model}|${rd.from}` },
  { id: 'robust', name: 'Robust region', teach: 'Choose r so that the behaviour survives a nudge of ±δ in either direction — stay away from the edges.', bands: [1, 3], gen: genRobust, sig: (rd) => `${rd.model}|${rd.period}|${rd.delta}` },
  { id: 'sensitive', name: 'Two starts', teach: 'Same r, two starting values. Reveal more steps until you can tell how their long-term behaviour compares.', bands: [0, 3], gen: genSensitive, sig: (rd) => `${rd.model}|${rd.answer}|${Math.round(rd.r! * 20)}` },
];

export const ROUNDS = 5;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sliders = new Sliders();
  const sess = new Session<BifRound>(api, 'bifurcation', FAMILIES, ROUNDS);
  let rd: BifRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let rv = 2.6;
  let runs: { r: number; xs: number[] }[] = [];
  let exps = 0;
  let shown = 0;
  let pick = -1;
  let diagram: { r: number; x: number }[] = [];

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    runs = [];
    exps = 0;
    shown = 0;
    pick = -1;
    diagram = [];
    rv = Math.round((rd.lo + (rd.hi - rd.lo) * 0.3) * 1000) / 1000;
    if (rd.kind === 'sensitive') shown = 12;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const map = rd.model === 'logistic' ? 'x ↦ r·x(1 − x)' : 'x ↦ x·e^{r(1 − x)}';
    const ask =
      rd.kind === 'stable'
        ? `Find r so that the population settles on ${rd.level!.toFixed(3)} (± ${rd.levelTol}).`
        : rd.kind === 'cycle'
          ? `Find an r that gives ${name(rd.period!)}.`
          : rd.kind === 'edge'
            ? `Find the r where ${name(rd.from!)} gives way to ${name(rd.to!)} (± ${rd.tol}).`
            : rd.kind === 'robust'
              ? `Choose r so that r − ${rd.delta}, r and r + ${rd.delta} all give ${name(rd.period!)}.`
              : `r = ${rd.r!.toFixed(3)}. Starts ${rd.x0![0].toFixed(3)} and ${rd.x0![1].toFixed(3)}. How do they compare in the long run?`;
    api.prompt(ask, sess.teach || `${map} · ${rd.kind === 'sensitive' ? 'Reveal more steps, then answer' : 'Run experiments, then Lock'} · experiments are counted`);
    stage.request();
  }

  function run() {
    if (phase !== 'play') return;
    const xs: number[] = [];
    let x = X0[rd.model];
    for (let i = 0; i < 80; i++) {
      xs.push(x);
      x = step(rd.model, rv, x);
    }
    runs.push({ r: rv, xs });
    exps++;
    api.sfx.tick();
    stage.request();
  }

  function more() {
    if (phase !== 'play') return;
    shown = Math.min(120, shown + 12);
    exps++;
    stage.request();
  }

  function lock(choice?: number) {
    if (phase !== 'play') return;
    const n = exps;
    const extra = Math.min(0.3, 0.04 * Math.max(0, n - (rd.kind === 'sensitive' ? 3 : 4)));
    let pen = 1;
    let main = '';
    let sub = '';
    let note = '';
    const b = classify(rd.model, rv);
    const desc = (x: Behaviour) => (x.period ? name(x.period) : isChaotic(x) ? 'irregular (chaotic) motion' : 'no short period');
    if (rd.kind === 'stable') {
      const lv = b.period === 1 ? b.pts[0] : NaN;
      const err = Number.isFinite(lv) ? Math.abs(lv - rd.level!) : Infinity;
      pen = err <= rd.levelTol! ? (err / rd.levelTol!) * 0.15 : b.period === 1 ? Math.min(1, 0.15 + (err - rd.levelTol!) / 0.1) : 1;
      main = b.period === 1 ? `Settles at ${lv.toFixed(4)} (target ${rd.level!.toFixed(3)}).` : `At r = ${rv.toFixed(3)} it does not settle: ${desc(b)}.`;
      sub = `The steady state is 1 − 1/r, so r = ${(1 / (1 - rd.level!)).toFixed(3)}. Beyond r = 3 that state still exists but is unstable.`;
      note = b.period === 1 ? `level ${lv.toFixed(3)}` : desc(b);
    } else if (rd.kind === 'cycle') {
      const ok = b.period === rd.period;
      pen = ok ? 0 : 1;
      main = ok ? `r = ${rv.toFixed(3)} gives ${name(rd.period!)}.` : `r = ${rv.toFixed(3)} gives ${desc(b)}.`;
      sub = `${name(rd.period!)} occurs for r in ${rd.wins!.map((w) => `${w.lo.toFixed(3)}–${w.hi.toFixed(3)}`).join(', ')} (grid estimate).`;
      note = `${desc(b)} at r = ${rv.toFixed(3)}`;
    } else if (rd.kind === 'edge') {
      const err = Math.abs(rv - rd.edge!);
      pen = err <= rd.tol! ? (err / rd.tol!) * 0.15 : Math.min(1, 0.15 + (err - rd.tol!) / (4 * rd.tol!));
      main = `${err <= rd.tol! ? 'Within tolerance' : 'Off'}: you said ${rv.toFixed(4)}, the transition is at ${rd.edge!.toFixed(4)}.`;
      sub = rd.from === 1 ? 'There the steady state’s slope f′(x*) passes −1 and a 2-cycle is born.' : `There the ${rd.from}-cycle’s multiplier passes −1 and it splits into a ${rd.to}-cycle (period doubling).`;
      note = `${err.toFixed(4)} from the edge`;
    } else if (rd.kind === 'robust') {
      const ps = [rv - rd.delta!, rv, rv + rd.delta!].map((x) => classify(rd.model, x).period);
      const ok = ps.every((p) => p === rd.period);
      const w = rd.wins!.find((x) => rv >= x.lo && rv <= x.hi);
      const margin = w ? Math.min(rv - w.lo, w.hi - rv) : 0;
      pen = ok ? Math.max(0, 0.15 - (margin - rd.delta!) * 3) : ps[1] === rd.period ? 0.6 : 1;
      main = ok ? `Robust: all three give ${name(rd.period!)}.` : `Not robust: ${ps.map((p) => (p ? `period ${p}` : 'irregular')).join(' / ')}.`;
      sub = w ? `Your r is ${margin.toFixed(3)} from the nearest edge of its window (${w.lo.toFixed(3)}–${w.hi.toFixed(3)}).` : 'Your r is outside every window with that period.';
      note = ok ? `margin ${margin.toFixed(3)}` : 'fails under a nudge';
    } else {
      pick = choice ?? -1;
      const ok = pick === rd.answer;
      pen = ok ? 0 : 1;
      main = ok ? `Right — ${OUTCOMES[rd.answer!].toLowerCase()}.` : `It was: ${OUTCOMES[rd.answer!].toLowerCase()}.`;
      sub =
        rd.answer === 3
          ? 'A positive Lyapunov exponent: tiny differences grow until the two runs are unrelated.'
          : rd.answer === 2
            ? 'Both settle on the same cycle, one step apart — the attractor is the same, the phase is not.'
            : 'Nearby starts are pulled onto the same attractor.';
      note = `${ok ? 'right' : 'wrong'} · ${shown} steps viewed`;
    }
    pen = Math.min(1, pen + (pen < 1 ? extra : 0));
    if (extra) sub += ` ${n} experiments (a few more than needed).`;
    phase = 'reveal';
    sess.done(pen, `${note} · ${n} runs`, { x: stage.w / 2, y: 120 });
    api.sfx[pen < 0.5 ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (rd.kind !== 'sensitive') buildDiagram();
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per task (wrong regime, distance from target, extra experiments)', share: 'BIFURCATION' });
      if (r) bench.finish(r);
    }
    stage.request();
  }

  function buildDiagram() {
    diagram = [];
    const [a, b] = RANGE[rd.model];
    for (let i = 0; i <= 260; i++) {
      const r = a + ((b - a) * i) / 260;
      let x = X0[rd.model];
      for (let k = 0; k < 400; k++) x = step(rd.model, r, x);
      for (let k = 0; k < 48; k++) {
        x = step(rd.model, r, x);
        diagram.push({ r, x });
      }
    }
  }

  bench.onTap = (p: Pt) => {
    if (phase === 'reveal') return begin();
    if (phase === 'play') sliders.down(p);
  };
  bench.onMove = (p) => sliders.move(p) && stage.request();
  bench.onUp = () => sliders.up();
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase !== 'play') return;
    if (sliders.key(e)) e.preventDefault();
    else if (e.key === 'r' || e.key === 'R') rd.kind === 'sensitive' ? more() : run();
    else if (rd.kind === 'sensitive' && /^[1-4]$/.test(e.key)) lock(Number(e.key) - 1);
    else if (e.key === 'Enter' && rd.kind !== 'sensitive') {
      e.preventDefault();
      lock();
    }
  };

  function series(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, list: { xs: number[]; color: string }[], ymax: number, from = 0) {
    plate(c, x - 6, y - 6, w + 12, h + 12, 8);
    const n = Math.max(...list.map((l) => l.xs.length), 2);
    const py = (v: number) => y + h - (clamp(v, 0, ymax) / ymax) * h;
    if (rd.kind === 'stable') {
      const ty = py(rd.level!);
      c.fillStyle = alpha(pal.accent, 0.12);
      c.fillRect(x, py(rd.level! + rd.levelTol!), w, py(rd.level! - rd.levelTol!) - py(rd.level! + rd.levelTol!));
      c.fillStyle = pal.accent;
      c.fillRect(x, ty, w, 1);
    }
    for (const l of list) {
      c.strokeStyle = alpha(l.color, 0.5);
      c.lineWidth = 1;
      c.beginPath();
      l.xs.forEach((v, i) => {
        const xx = x + (i / (n - 1)) * w;
        i ? c.lineTo(xx, py(v)) : c.moveTo(xx, py(v));
      });
      c.stroke();
      l.xs.forEach((v, i) => {
        if (i < from) return;
        c.beginPath();
        c.arc(x + (i / (n - 1)) * w, py(v), 2.2, 0, TAU);
        c.fillStyle = l.color;
        c.fill();
      });
    }
    text(c, 'step n →', x + w, y + h + 14, font.mono(9), pal.ink3, 'right');
  }

  function cobweb(c: CanvasRenderingContext2D, x: number, y: number, s: number, r: number, xs: number[], ymax: number) {
    plate(c, x - 6, y - 6, s + 12, s + 12, 8);
    const P = (u: number, v: number) => ({ x: x + (clamp(u, 0, ymax) / ymax) * s, y: y + s - (clamp(v, 0, ymax) / ymax) * s });
    c.strokeStyle = pal.line;
    c.beginPath();
    c.moveTo(P(0, 0).x, P(0, 0).y);
    c.lineTo(P(ymax, ymax).x, P(ymax, ymax).y);
    c.stroke();
    c.strokeStyle = pal.ink2;
    c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const u = (i / 120) * ymax;
      const q = P(u, step(rd.model, r, u));
      i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y);
    }
    c.stroke();
    c.strokeStyle = alpha(AMBER, 0.7);
    c.beginPath();
    let q = P(xs[0], 0);
    c.moveTo(q.x, q.y);
    for (let i = 0; i < Math.min(xs.length - 1, 60); i++) {
      q = P(xs[i], xs[i + 1]);
      c.lineTo(q.x, q.y);
      q = P(xs[i + 1], xs[i + 1]);
      c.lineTo(q.x, q.y);
    }
    c.stroke();
    text(c, 'cobweb', x + 4, y + 12, font.mono(9, 600), pal.ink3);
  }

  stage.draw = () => {
    bench.frame();
    sliders.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, `${sess.fam.name} · ${rd.model}`, sess.curBand);
    const ymax = rd.model === 'logistic' ? 1 : 2.6;
    const wide = W >= 760;
    const top = 116;
    const sh = Math.min(200, (H - top) * 0.36);
    const cs = wide ? sh : 0;
    const sw = W - 48 - (wide ? cs + 24 : 0);
    const reveal = phase !== 'play';
    if (rd.kind === 'sensitive') {
      const mk = (x0: number) => {
        const xs: number[] = [];
        let x = x0;
        for (let i = 0; i < shown; i++) {
          xs.push(x);
          x = step(rd.model, rd.r!, x);
        }
        return xs;
      };
      series(c, 24, top, W - 48, sh, [{ xs: mk(rd.x0![0]), color: pal.accent }, { xs: mk(rd.x0![1]), color: AMBER }], ymax);
      const by = top + sh + 30;
      if (!reveal) bench.button(c, 24, by, 180, 40, `Reveal 12 more · ${shown}`, more, { key: 'R', off: shown >= 120 });
      const items = OUTCOMES.map((o, i) => ({ label: o, run: () => lock(i), o: { key: String(i + 1), off: reveal, sel: reveal && (i === rd.answer || i === pick), color: reveal ? (i === rd.answer ? pal.accent : pal.signal) : undefined, px: 12 } }));
      // Narrow screens: the four answers as a 2 × 2 grid.
      if (W >= 700) bench.row(c, W / 2, by + 56, Math.min(860, W - 32), items, 48);
      else {
        bench.row(c, W / 2, by + 56, W - 32, items.slice(0, 2), 48);
        bench.row(c, W / 2, by + 112, W - 32, items.slice(2), 48);
      }
    } else {
      const last = runs[runs.length - 1];
      const list = runs.slice(-3).map((rn, i, a) => ({ xs: rn.xs, color: i === a.length - 1 ? pal.accent : alpha(pal.ink, 0.35) }));
      series(c, 24, top, sw, sh, list, ymax, 20);
      if (wide && last) cobweb(c, 24 + sw + 24, top, cs, last.r, last.xs, ymax);
      if (last) text(c, `last run r = ${last.r.toFixed(4)} · ${(() => { const b = classify(rd.model, last.r); return b.period ? (b.period === 1 ? 'settles' : `${b.period}-cycle`) : isChaotic(b) ? 'irregular' : 'no short period'; })()}`, 24, top + sh + 26, font.mono(10, 500), pal.ink2);
      const by = top + sh + 56;
      const slw = Math.min(560, W - 48);
      if (rd.kind === 'robust' && phase === 'play') {
        const k = (v: number) => 24 + ((v - rd.lo) / (rd.hi - rd.lo)) * slw;
        c.fillStyle = alpha(AMBER, 0.25);
        c.fillRect(k(rv - rd.delta!), by - 4, k(rv + rd.delta!) - k(rv - rd.delta!), 8);
      }
      sliders.draw(c, 24, by, slw, 'GROWTH RATE r', rd.lo, rd.hi, () => rv, (v) => (rv = v), (v) => v.toFixed(4), { step: 0.0005, off: reveal });
      if (!reveal) {
        bench.button(c, 24, by + 30, 130, 40, `Run · ${runs.length}`, run, { key: 'R' });
        bench.button(c, 164, by + 30, 130, 40, 'Lock', () => lock(), { primary: true, key: 'Enter' });
      }
      if (reveal && diagram.length) {
        // The bifurcation diagram, with your r and the target marked.
        const dy = by + 34;
        const dh = Math.max(60, H - dy - 30);
        const [a, b] = RANGE[rd.model];
        const X = (r: number) => 24 + ((r - a) / (b - a)) * slw;
        const Y = (x: number) => dy + dh - (clamp(x, 0, ymax) / ymax) * dh;
        plate(c, 18, dy - 6, slw + 12, dh + 12, 8);
        if (rd.kind === 'edge') {
          c.fillStyle = alpha(pal.accent, 0.15);
          c.fillRect(X(rd.edge! - rd.tol!), dy, X(rd.edge! + rd.tol!) - X(rd.edge! - rd.tol!), dh);
        }
        for (const w of rd.wins ?? []) {
          c.fillStyle = alpha(pal.accent, 0.12);
          c.fillRect(X(w.lo), dy, Math.max(1, X(w.hi) - X(w.lo)), dh);
        }
        c.fillStyle = alpha(pal.ink, 0.55);
        for (const d of diagram) c.fillRect(X(d.r), Y(d.x), 1, 1);
        c.fillStyle = AMBER;
        c.fillRect(X(rv) - 1, dy, 2, dh);
        text(c, 'bifurcation diagram (long-run x against r)', 24, dy + dh + 16, font.mono(9), pal.ink3);
      }
    }
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return false;
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
