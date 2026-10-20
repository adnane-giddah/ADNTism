// 44 · CAUSAL CIRCUIT — learn what controls what by intervening.
// Every puzzle is a deterministic causal model: lamps (and meters) are boolean functions of the switches
// you set, sometimes through hidden intermediates. You run experiments — set the switches (and, where
// offered, clamp a meter to a value: an intervention, do(M = v)) and read the outputs. Competing hypotheses
// are generated deliberately and checked to be distinguishable with the permitted experiments; the
// experiment budget is at least what a greedy splitting strategy needs, so the inference is always
// possible. Lamps show only the result of the last experiment: nothing is learned for free.
// Penalty per puzzle: wrong = 1; right while several hypotheses still fitted your evidence = ½ (a guess);
// otherwise 0.06 per experiment beyond the minimum.
import { font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, shuffle } from './kit';
import { famChip, para, Session, type Band, type Family } from './lab';

export type F = { op: 'in'; i: number } | { op: 'not'; a: F } | { op: 'and' | 'or' | 'xor'; a: F; b: F };
export const ev = (f: F, x: number[]): number => {
  switch (f.op) {
    case 'in':
      return x[f.i];
    case 'not':
      return 1 - ev(f.a, x);
    case 'and':
      return ev(f.a, x) & ev(f.b, x);
    case 'or':
      return ev(f.a, x) | ev(f.b, x);
    case 'xor':
      return ev(f.a, x) ^ ev(f.b, x);
  }
};
export const LET = 'ABCDE';
export const show = (f: F): string =>
  f.op === 'in' ? LET[f.i] : f.op === 'not' ? `NOT ${f.a.op === 'in' ? show(f.a) : `(${show(f.a)})`}` : `${f.a.op === 'in' || f.a.op === 'not' ? show(f.a) : `(${show(f.a)})`} ${f.op.toUpperCase()} ${f.b.op === 'in' || f.b.op === 'not' ? show(f.b) : `(${show(f.b)})`}`;
const vars = (f: F, s = new Set<number>()): Set<number> => {
  if (f.op === 'in') s.add(f.i);
  else if (f.op === 'not') vars(f.a, s);
  else {
    vars(f.a, s);
    vars(f.b, s);
  }
  return s;
};

export const assignments = (n: number) => Array.from({ length: 1 << n }, (_, k) => Array.from({ length: n }, (_, i) => (k >> i) & 1));
/** Truth table of a formula over n switches, as a bit string. */
export const table = (f: F, n: number) => assignments(n).map((x) => ev(f, x)).join('');
/** True when every variable of f matters for some assignment. */
function essential(f: F, n: number) {
  for (const i of vars(f))
    if (!assignments(n).some((x) => ev(f, x) !== ev(f, x.map((v, j) => (j === i ? 1 - v : v))))) return false;
  return true;
}

/** An experiment: switch values, optionally a clamped meter (confounding puzzles). */
export interface Exp {
  x: number[];
  clamp?: { m: 0 | 1; v: number };
}
export interface Hyp {
  label: string;
  /** Predicted observations for an experiment (lamps, or meters). Null = no exact prediction (dependency hypotheses). */
  pred?: (e: Exp) => number[];
  /** Consistency with a whole observation list (used when there is no exact prediction). */
  fits?: (obs: { e: Exp; y: number[] }[]) => boolean;
  /** Structure drawn on the card (confounding): arrows between Z, M1, M2. */
  arrows?: [string, string][];
}

export interface CausalRound {
  kind: 'direct' | 'hidden' | 'confound' | 'design' | 'control';
  n: number;
  /** The true system: what an experiment returns. */
  sys: (e: Exp) => number[];
  /** Output names. */
  outs: string[];
  /** The true formulas (revealed at the end). */
  reveal: string[];
  hyps: Hyp[];
  truth: number;
  budget: number;
  /** Minimum experiments a good strategy needs. */
  minimum: number;
  focus?: number;
  target?: number[];
  options?: Exp[];
  optOk?: boolean[];
  /** Confounding: the switch drives a hidden cause Z; meters can be clamped. */
  clampable?: boolean;
}

export function consistent(rd: CausalRound, obs: { e: Exp; y: number[] }[]) {
  return rd.hyps.map((h, i) => ({ h, i })).filter(({ h }) => (h.pred ? obs.every((o) => h.pred!(o.e).join() === o.y.join()) : h.fits!(obs)));
}

/** Greedy minimax depth over an experiment space (pred hypotheses only). */
export function greedyDepth(hyps: Hyp[], space: Exp[]): number {
  if (hyps.length <= 1) return 0;
  let best = Infinity;
  let split: Map<string, Hyp[]> | null = null;
  for (const e of space) {
    const m = new Map<string, Hyp[]>();
    for (const h of hyps) {
      const k = h.pred!(e).join();
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    const worst = Math.max(...[...m.values()].map((v) => v.length));
    if (worst < best) {
      best = worst;
      split = m;
    }
  }
  if (best === hyps.length || !split) return Infinity;
  return 1 + Math.max(...[...split.values()].map((v) => greedyDepth(v, space)));
}

function randFormula(r: Rng, n: number, band: Band, depthBias = 0): F {
  const leaf = (): F => ({ op: 'in', i: r.int(0, n - 1) });
  const lvl = Math.min(3, band + depthBias);
  if (lvl === 0) return r.next() < 0.6 ? leaf() : { op: 'not', a: leaf() };
  const ops = lvl >= 2 ? (['and', 'or', 'xor'] as const) : (['and', 'or'] as const);
  const a = lvl >= 2 && r.next() < 0.45 ? { op: r.pick(['and', 'or'] as const), a: leaf(), b: leaf() } : r.next() < 0.3 ? ({ op: 'not', a: leaf() } as F) : leaf();
  return { op: r.pick(ops), a, b: r.next() < 0.25 && lvl >= 2 ? { op: 'not', a: leaf() } : leaf() };
}

const SLACK = [2, 1, 1, 0];

function genDirect(r: Rng, band: Band): CausalRound | null {
  const n = [3, 4, 5, 5][band];
  const nl = band === 0 ? 2 : 3;
  const k = r.int(0, n - 1);
  const focus = r.int(0, nl - 1);
  const lamps: F[] = [];
  for (let l = 0; l < nl; l++) {
    if (l === focus) lamps.push(r.next() < 0.5 ? { op: 'in', i: k } : { op: 'not', a: { op: 'in', i: k } });
    else {
      // Distractor lamps depend on other switches (from band 2 sometimes also on k, so they co-vary with it).
      const others = [...Array(n).keys()].filter((i) => i !== k || band >= 2);
      const f: F = { op: r.pick(['and', 'or'] as const), a: { op: 'in', i: r.pick(others) }, b: { op: 'in', i: r.pick(others) } };
      if (!essential(f, n) || vars(f).size < 2) return null;
      lamps.push(f);
    }
  }
  const hyps: Hyp[] = Array.from({ length: n }, (_, i) => ({
    label: `${LET[i]} controls L${focus + 1}`,
    // "L depends on switch i alone": equal values of i must always give equal lamp readings.
    fits: (obs) => {
      const seen = new Map<number, number>();
      for (const o of obs) {
        const v = o.e.x[i];
        if (seen.has(v) && seen.get(v) !== o.y[focus]) return false;
        seen.set(v, o.y[focus]);
      }
      return true;
    },
  }));
  const minimum = Math.ceil(Math.log2(n + 1)) + 1;
  return {
    kind: 'direct',
    n,
    sys: (e) => lamps.map((f) => ev(f, e.x)),
    outs: lamps.map((_, i) => `L${i + 1}`),
    reveal: lamps.map((f, i) => `L${i + 1} = ${show(f)}`),
    hyps,
    truth: k,
    budget: minimum + SLACK[band],
    minimum,
    focus,
  };
}

function genHidden(r: Rng, band: Band): CausalRound | null {
  const n = band <= 1 ? 3 : 4;
  const want = [3, 4, 4, 5][band];
  const cands: F[] = [];
  const tabs = new Set<string>();
  for (let tries = 0; cands.length < want && tries < 200; tries++) {
    const f = randFormula(r, n, Math.max(1, band) as Band);
    const t = table(f, n);
    if (tabs.has(t) || !t.includes('1') || !t.includes('0') || !essential(f, n) || vars(f).size < 2) continue;
    tabs.add(t);
    cands.push(f);
  }
  if (cands.length < want) return null;
  const truth = r.int(0, want - 1);
  const hyps: Hyp[] = cands.map((f) => ({ label: `L = ${show(f)}`, pred: (e) => [ev(f, e.x)] }));
  const space = assignments(n).map((x) => ({ x }));
  const minimum = greedyDepth(hyps, space);
  if (!Number.isFinite(minimum)) return null;
  return { kind: 'hidden', n, sys: (e) => [ev(cands[truth], e.x)], outs: ['L'], reveal: [`L = ${show(cands[truth])} (via a hidden ${cands[truth].op.toUpperCase()} stage)`], hyps, truth, budget: minimum + SLACK[band], minimum };
}

function genConfound(r: Rng, band: Band): CausalRound | null {
  const inv = r.next() < 0.5;
  const z = (e: Exp) => (inv ? 1 - e.x[0] : e.x[0]);
  const cl = (e: Exp, m: 0 | 1, v: number) => (e.clamp && e.clamp.m === m ? e.clamp.v : v);
  const models: Hyp[] = [
    {
      label: 'M1 causes M2',
      arrows: [
        ['Z', 'M1'],
        ['M1', 'M2'],
      ],
      pred: (e) => {
        const m1 = cl(e, 0, z(e));
        return [m1, cl(e, 1, m1)];
      },
    },
    {
      label: 'M2 causes M1',
      arrows: [
        ['Z', 'M2'],
        ['M2', 'M1'],
      ],
      pred: (e) => {
        const m2 = cl(e, 1, z(e));
        return [cl(e, 0, m2), m2];
      },
    },
    {
      label: 'Common cause only',
      arrows: [
        ['Z', 'M1'],
        ['Z', 'M2'],
      ],
      pred: (e) => [cl(e, 0, z(e)), cl(e, 1, z(e))],
    },
  ];
  if (band >= 2)
    models.push({
      label: 'M1 and Z both drive M2',
      arrows: [
        ['Z', 'M1'],
        ['M1', 'M2'],
        ['Z', 'M2'],
      ],
      pred: (e) => {
        const m1 = cl(e, 0, z(e));
        return [m1, cl(e, 1, m1 & z(e))];
      },
    });
  const space: Exp[] = [];
  for (const x of [0, 1]) {
    space.push({ x: [x] });
    for (const m of [0, 1] as const) for (const v of [0, 1]) space.push({ x: [x], clamp: { m, v } });
  }
  const minimum = greedyDepth(models, space);
  if (!Number.isFinite(minimum)) return null;
  const truth = r.int(0, models.length - 1);
  return {
    kind: 'confound',
    n: 1,
    sys: models[truth].pred!,
    outs: ['M1', 'M2'],
    reveal: [`${models[truth].label}${inv ? ' (Z is the switch inverted)' : ''}`],
    hyps: models,
    truth,
    budget: minimum + SLACK[band] + 1,
    minimum,
    clampable: true,
  };
}

function genDesign(r: Rng, band: Band): CausalRound | null {
  const n = band <= 1 ? 3 : 4;
  const fA = randFormula(r, n, Math.max(1, band) as Band);
  const fB = randFormula(r, n, Math.max(1, band) as Band);
  const g = randFormula(r, n, 0);
  if (table(fA, n) === table(fB, n) || !essential(fA, n) || !essential(fB, n)) return null;
  const hyps: Hyp[] = [
    { label: `Model A: L1 = ${show(fA)}, L2 = ${show(g)}`, pred: (e) => [ev(fA, e.x), ev(g, e.x)] },
    { label: `Model B: L1 = ${show(fB)}, L2 = ${show(g)}`, pred: (e) => [ev(fB, e.x), ev(g, e.x)] },
  ];
  const all = assignments(n);
  const yes = all.filter((x) => ev(fA, x) !== ev(fB, x));
  const no = all.filter((x) => ev(fA, x) === ev(fB, x));
  // Harder bands: the informative experiment is rare among the options.
  const nYes = band >= 2 ? 1 : r.int(1, 2);
  if (yes.length < nYes || no.length < 4 - nYes) return null;
  if (band >= 2 && yes.length > all.length / 2) return null;
  const options = shuffle([...shuffle(yes, r.next).slice(0, nYes), ...shuffle(no, r.next).slice(0, 4 - nYes)], r.next).map((x) => ({ x }));
  const truth = r.int(0, 1);
  return {
    kind: 'design',
    n,
    sys: hyps[truth].pred!,
    outs: ['L1', 'L2'],
    reveal: [hyps[truth].label],
    hyps,
    truth,
    budget: 1,
    minimum: 1,
    options,
    optOk: options.map((o) => ev(fA, o.x) !== ev(fB, o.x)),
  };
}

function genControl(r: Rng, band: Band): CausalRound | null {
  const n = band <= 1 ? 3 : 4;
  const lamps = [randFormula(r, n, Math.max(1, band) as Band), randFormula(r, n, Math.max(1, band) as Band)];
  if (!lamps.every((f) => essential(f, n) && vars(f).size >= 2)) return null;
  const target = [1, r.int(0, 1)];
  const all = assignments(n);
  const good = all.filter((x) => lamps.every((f, i) => ev(f, x) === target[i])).length;
  if (good === 0 || good / all.length > (band >= 2 ? 0.25 : 0.5)) return null;
  return {
    kind: 'control',
    n,
    sys: (e) => lamps.map((f) => ev(f, e.x)),
    outs: ['L1', 'L2'],
    reveal: lamps.map((f, i) => `L${i + 1} = ${show(f)}`),
    hyps: [],
    truth: -1,
    budget: [5, 4, 5, 4][band],
    minimum: 2,
    target,
  };
}

export const FAMILIES: Family<CausalRound>[] = [
  { id: 'direct', name: 'Direct cause', teach: 'Flip switches, press Run, and watch which lamps change. Then name the switch that controls the marked lamp.', bands: [0, 3], intro: true, gen: genDirect, sig: (rd) => `${rd.n}|${rd.truth}|${rd.focus}|${rd.reveal.join(';')}` },
  { id: 'hidden', name: 'Hidden stage', teach: 'The lamp depends on several switches through a hidden stage. Test combinations until one explanation is left.', bands: [1, 3], gen: genHidden, sig: (rd) => rd.hyps.map((h) => h.label).sort().join('|') },
  { id: 'confound', name: 'Confounding', teach: 'M1 and M2 always agree. Is one causing the other? Clamp a meter (an intervention) and see whether the other follows.', bands: [0, 3], gen: genConfound, sig: (rd) => `${rd.hyps.length}|${rd.truth}|${rd.reveal[0]}` },
  { id: 'design', name: 'Best experiment', teach: 'Two models disagree. You get one experiment: pick the one whose outcome would tell them apart.', bands: [0, 3], gen: genDesign, sig: (rd) => rd.hyps.map((h) => h.label).join('|') },
  { id: 'control', name: 'Control', teach: 'Experiment to learn the circuit, then set the switches so the lamps show the target — the last run counts.', bands: [1, 3], gen: genControl, sig: (rd) => `${rd.target}|${rd.reveal.join(';')}` },
];

export const ROUNDS = 5;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<CausalRound>(api, 'causal', FAMILIES, ROUNDS);
  let rd: CausalRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let x: number[] = [];
  let clamp: Exp['clamp'] = undefined;
  let obs: { e: Exp; y: number[] }[] = [];
  let sel = -1;
  let result: number[] | null = null;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    x = Array(rd.n).fill(0);
    clamp = undefined;
    obs = [];
    sel = -1;
    result = null;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const ask =
      rd.kind === 'direct'
        ? `Which switch controls lamp L${rd.focus! + 1}?`
        : rd.kind === 'hidden'
          ? 'Which explanation is wired inside the box?'
          : rd.kind === 'confound'
            ? 'The switch drives a hidden cause Z. M1 and M2 move together — why?'
            : rd.kind === 'design'
              ? 'One experiment only. Which one tells Model A from Model B?'
              : `Make L1 ${rd.target![0] ? 'ON' : 'OFF'} and L2 ${rd.target![1] ? 'ON' : 'OFF'}.`;
    const tail = rd.kind === 'design' ? 'Tap an experiment' : rd.kind === 'control' ? `${rd.budget} runs · the last run is your answer` : `${rd.budget} experiments · then pick and Commit`;
    api.prompt(ask, sess.teach || tail);
    stage.request();
  }

  function runExp() {
    if (phase !== 'play' || obs.length >= rd.budget) return;
    const e: Exp = { x: [...x], clamp: clamp ? { ...clamp } : undefined };
    const y = rd.sys(e);
    obs.push({ e, y });
    result = y;
    api.sfx.press();
    const left = rd.budget - obs.length;
    if (rd.kind === 'control') {
      const hit = y.every((v, i) => v === rd.target![i]);
      if (hit || !left) return judge();
    }
    api.prompt(`Run ${obs.length}: ${rd.outs.map((o, i) => `${o} ${y[i] ? 'ON' : 'off'}`).join(' · ')}`, left ? `${left} left` : 'No experiments left — decide');
  }

  function judge(opt?: number) {
    if (phase !== 'play') return;
    let pen = 1;
    let main = '';
    let sub = '';
    let note = '';
    if (rd.kind === 'design') {
      if (opt === undefined) return;
      sel = opt;
      const e = rd.options![opt];
      const y = rd.sys(e);
      obs = [{ e, y }];
      result = y;
      const ok = rd.optOk![opt];
      pen = ok ? 0 : 1;
      const pa = rd.hyps[0].pred!(e);
      const pb = rd.hyps[1].pred!(e);
      main = ok ? `Informative: A predicts L1 ${pa[0] ? 'ON' : 'off'}, B predicts ${pb[0] ? 'ON' : 'off'}.` : `Both models predict the same lamps there — the outcome could not tell them apart.`;
      sub = `The circuit was ${rd.truth ? 'Model B' : 'Model A'}. An experiment is useful only where the hypotheses disagree.`;
      note = ok ? 'chose an informative experiment' : 'chose an uninformative experiment';
    } else if (rd.kind === 'control') {
      const last = obs[obs.length - 1];
      const ok = !!last && last.y.every((v, i) => v === rd.target![i]);
      pen = ok ? Math.min(0.3, 0.06 * Math.max(0, obs.length - rd.minimum)) : 1;
      main = ok ? `Target reached in ${obs.length} run${obs.length > 1 ? 's' : ''}.` : 'The last run did not show the target.';
      sub = `Inside: ${rd.reveal.join(' · ')}.`;
      note = `${ok ? 'reached' : 'missed'} · ${obs.length} runs`;
    } else {
      if (sel < 0) return;
      const left = consistent(rd, obs);
      const right = sel === rd.truth;
      const extra = Math.max(0, obs.length - rd.minimum);
      pen = !right ? 1 : left.length > 1 ? 0.5 : Math.min(0.3, 0.06 * extra);
      main = right ? (left.length > 1 ? `Right — but ${left.length} explanations still fitted your runs: a guess.` : 'Right, and your runs ruled out every alternative.') : `No — ${rd.hyps[rd.truth].label}.`;
      // The most informative run: the one that eliminated the most hypotheses.
      let alive = rd.hyps.length;
      let best = { k: -1, cut: 0 };
      obs.forEach((_, k) => {
        const now = consistent(rd, obs.slice(0, k + 1)).length;
        if (alive - now > best.cut) best = { k, cut: alive - now };
        alive = now;
      });
      sub = `${best.k >= 0 ? `Run ${best.k + 1} was the most informative (ruled out ${best.cut}). ` : ''}${rd.kind === 'confound' ? 'Correlation alone cannot say which way causation runs; clamping one meter and watching the other can. ' : ''}Inside: ${rd.reveal.join(' · ')}.`;
      note = `${right ? (left.length > 1 ? 'guess' : 'right') : 'wrong'} · ${obs.length} runs (min ${rd.minimum})`;
    }
    phase = 'reveal';
    sess.done(pen, note, { x: stage.w / 2, y: 120 });
    api.sfx[pen < 0.5 ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per system (wrong, guessed, or extra experiments)', share: 'CAUSAL CIRCUIT' });
      if (r) bench.finish(r);
    }
  }

  bench.onTap = () => phase === 'reveal' && begin();
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase !== 'play') return;
    const i = LET.toLowerCase().indexOf(e.key.toLowerCase());
    if (i >= 0 && i < rd.n) x[i] = 1 - x[i];
    else if (e.key === 'r' || e.key === 'R' || (e.key === 'Enter' && rd.kind === 'control')) runExp();
    else if (/^[1-9]$/.test(e.key)) {
      const k = Number(e.key) - 1;
      if (rd.kind === 'design' && k < 4) judge(k);
      else if (k < rd.hyps.length) sel = k;
    } else if (e.key === 'Enter' && sel >= 0) judge();
    else return;
    e.preventDefault();
  };

  function lamp(c: CanvasRenderingContext2D, cx: number, cy: number, on: number | null, label: string, mark = false) {
    c.beginPath();
    c.arc(cx, cy, 15, 0, Math.PI * 2);
    c.fillStyle = on === null ? pal.paper2 : on ? AMBER : alpha(pal.ink, 0.08);
    c.fill();
    c.strokeStyle = mark ? pal.accent : pal.line;
    c.lineWidth = mark ? 2 : 1;
    c.stroke();
    if (on) {
      c.save();
      c.shadowColor = AMBER;
      c.shadowBlur = 16;
      c.fill();
      c.restore();
    }
    text(c, label, cx + 24, cy + 1, font.mono(11, 600), mark ? pal.accent : pal.ink2, 'left', 'middle');
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const reveal = phase !== 'play';
    const wide = W >= 820;
    const top = 116;
    const appW = wide ? Math.min(520, W * 0.52) : W - 32;
    const ax = 16;
    const appH = Math.max(150, Math.max(rd.n, rd.outs.length) * 46 + 20);
    plate(c, ax, top, appW, appH, 8);
    // Switches.
    const sx = ax + 20;
    const labels = rd.kind === 'confound' ? ['S'] : Array.from({ length: rd.n }, (_, i) => LET[i]);
    labels.forEach((L, i) => {
      const y = top + 20 + i * 46;
      const on = x[i];
      rr(c, sx, y, 54, 28, 14);
      c.fillStyle = on ? alpha(pal.accent, 0.25) : pal.paper2;
      c.fill();
      c.strokeStyle = on ? pal.accent : pal.line;
      c.stroke();
      c.beginPath();
      c.arc(sx + (on ? 40 : 14), y + 14, 10, 0, Math.PI * 2);
      c.fillStyle = on ? pal.accent : pal.ink3;
      c.fill();
      text(c, L, sx + 66, y + 15, font.mono(13, 600), pal.ink, 'left', 'middle');
      if (!reveal && rd.kind !== 'design') bench.hit(sx, y, 80, 28, () => (x[i] = 1 - x[i]));
    });
    // The box.
    const bx = sx + 100;
    const bw = appW - 230;
    rr(c, bx, top + 14, bw, appH - 28, 8);
    c.fillStyle = reveal ? alpha(pal.accent, 0.05) : alpha(pal.ink, 0.04);
    c.fill();
    c.strokeStyle = pal.line;
    c.stroke();
    if (reveal) para(c, rd.reveal.join('  ·  '), bx + 10, top + 34, bw - 20, font.mono(11, 500), pal.accent, 16);
    else {
      text(c, rd.kind === 'confound' ? 'S → Z → ?' : '?', bx + bw / 2, top + appH / 2, font.serif(rd.kind === 'confound' ? 18 : 34, true), pal.ink3, 'center', 'middle');
    }
    // Outputs.
    const ox = bx + bw + 30;
    rd.outs.forEach((o, i) => {
      const y = top + 34 + i * 46;
      lamp(c, ox, y, result ? result[i] : null, o, rd.focus === i);
      if (rd.clampable && !reveal) {
        // Clamp buttons: free / 0 / 1 for this meter.
        const opts: [string, Exp['clamp']][] = [
          ['free', undefined],
          ['=0', { m: i as 0 | 1, v: 0 }],
          ['=1', { m: i as 0 | 1, v: 1 }],
        ];
        opts.forEach(([lab, val], j) => {
          const on = val ? clamp?.m === val.m && clamp.v === val.v : !clamp || clamp.m !== i;
          bench.button(c, ox + 50 + j * 40, y - 13, 36, 26, lab, () => (clamp = val ? { ...val } : clamp?.m === i ? undefined : clamp), { sel: on, px: 10 });
        });
      }
      if (rd.target) text(c, `target ${rd.target[i] ? 'ON' : 'off'}`, ox + 60, y + 1, font.mono(10, 500), pal.accent, 'left', 'middle');
    });
    // Run button and log.
    const ly = top + appH + 18;
    if (!reveal && rd.kind !== 'design') bench.button(c, ax, ly, 150, 40, `Run · ${obs.length}/${rd.budget}`, runExp, { key: 'R', off: obs.length >= rd.budget, primary: rd.kind === 'control' });
    const logX = ax + (rd.kind !== 'design' ? 166 : 0);
    obs.slice(-6).forEach((o, k) => {
      const idx = obs.length - Math.min(6, obs.length) + k;
      const prev = obs[idx - 1];
      const y = ly + 10 + k * 18;
      const ins = rd.kind === 'confound' ? `S${o.e.x[0]}${o.e.clamp ? ` do(M${o.e.clamp.m + 1}=${o.e.clamp.v})` : ''}` : o.e.x.map((v, i) => `${LET[i]}${v}`).join(' ');
      text(c, `${idx + 1}. ${ins}  →`, logX, y, font.mono(10, 500), pal.ink2);
      c.font = font.mono(10, 500);
      let tx = logX + c.measureText(`${idx + 1}. ${ins}  → `).width;
      o.y.forEach((v, i) => {
        const changed = prev && prev.y[i] !== v;
        const s = `${rd.outs[i]}${v ? '●' : '○'} `;
        text(c, s, tx, y, font.mono(10, changed ? 700 : 500), changed ? pal.accent : pal.ink2);
        tx += c.measureText(s).width + 4;
      });
    });
    // Hypotheses / options.
    const hx = wide ? ax + appW + 24 : 16;
    const hw = wide ? W - hx - 16 : W - 32;
    let hy = wide ? top : ly + 10 + Math.min(6, obs.length) * 18 + 16;
    if (rd.kind === 'design') {
      rd.hyps.forEach((h, i) => {
        para(c, h.label, hx, hy + 14, hw, font.mono(11, 500), i === rd.truth && reveal ? pal.accent : pal.ink, 15);
        hy += 40;
        void i;
      });
      rd.options!.forEach((o, i) => {
        const lab = `${i + 1}. ${o.x.map((v, j) => `${LET[j]}=${v}`).join(' ')}`;
        bench.button(c, hx, hy, Math.min(hw, 300), 38, lab, () => judge(i), { off: reveal, sel: reveal && (rd.optOk![i] || i === sel), color: reveal ? (rd.optOk![i] ? pal.accent : pal.signal) : undefined, px: 12 });
        hy += 46;
      });
    } else if (rd.kind !== 'control') {
      const alive = new Set(consistent(rd, obs).map((h) => h.i));
      rd.hyps.forEach((h, i) => {
        const isSel = sel === i;
        const dead = !alive.has(i) && (sess.curBand <= 1 || reveal);
        const hh = h.arrows ? 54 : 36;
        rr(c, hx, hy, hw, hh - 6, 6);
        c.fillStyle = isSel ? alpha(pal.accent, 0.12) : reveal && i === rd.truth ? alpha(pal.accent, 0.18) : pal.paper2;
        c.fill();
        c.strokeStyle = isSel ? (reveal && i !== rd.truth ? pal.signal : pal.accent) : pal.line;
        c.stroke();
        text(c, `${i + 1}. ${h.label}`, hx + 10, hy + 16, font.mono(11, 500), dead ? pal.ink3 : pal.ink, 'left', 'middle');
        if (dead) {
          c.fillStyle = pal.ink3;
          c.fillRect(hx + 10, hy + 16, Math.min(hw - 20, h.label.length * 7 + 20), 1);
        }
        if (h.arrows) text(c, h.arrows.map(([a, b]) => `${a}→${b}`).join('  '), hx + 24, hy + 36, font.mono(10, 500), pal.ink3, 'left', 'middle');
        if (!reveal) bench.hit(hx, hy, hw, hh - 6, () => (sel = sel === i ? -1 : i));
        hy += hh;
      });
      if (!reveal) bench.button(c, hx, hy + 6, 150, 40, 'Commit', () => judge(), { primary: true, off: sel < 0, key: 'Enter' });
      if (sess.curBand >= 2 && !reveal) text(c, 'struck-out hints are off at this level', hx + 166, hy + 30, font.mono(10, 500), pal.ink3);
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
