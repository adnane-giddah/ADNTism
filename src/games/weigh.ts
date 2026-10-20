// 32 · WEIGH — deduce weights from balance scales.
// Objects are unknown positive real weights. Each scale says sum(left) > / = / < sum(right). A relation
// between two objects is *deducible* only if every assignment of positive weights that fits all scales
// agrees on it; otherwise the honest answer is "can't tell". The engine decides this exactly by
// Fourier–Motzkin elimination over strict and non-strict homogeneous inequalities (no sampling, no
// integer assumption). Scales tilt by a fixed angle: the size of a tilt never leaks how much heavier.
import { clamp, font, line, pal, springOut, text } from '../core/draw';
import { alpha, plate, rr, softShadow, solidBlock } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { AMBER, badge, Bench, mean, pairScore, Ranker, roundStrip, trueOrder } from './kit';

export type Rel = '>' | '=' | '<';
export interface Scale {
  L: number[];
  R: number[];
  out: Rel; // sum(L) ? sum(R)
}
interface Ineq {
  c: number[];
  strict: boolean; // c·w > 0, else c·w ≥ 0
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
function norm(q: Ineq): Ineq {
  const g = q.c.reduce((s, x) => gcd(s, Math.round(Math.abs(x))), 0) || 1;
  return { c: q.c.map((x) => x / g), strict: q.strict };
}

/** Exact feasibility of a homogeneous system with w > 0, by Fourier–Motzkin elimination. */
export function feasible(sys: Ineq[], n: number): boolean {
  let S = sys.map(norm);
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0);
    e[i] = 1;
    S.push({ c: e, strict: true });
  }
  for (let v = 0; v < n; v++) {
    const pos: Ineq[] = [];
    const neg: Ineq[] = [];
    const next: Ineq[] = [];
    for (const q of S) (q.c[v] > 0 ? pos : q.c[v] < 0 ? neg : next).push(q);
    for (const p of pos)
      for (const m of neg) {
        const a = p.c[v];
        const b = -m.c[v];
        next.push(norm({ c: p.c.map((x, i) => b * x + a * m.c[i]), strict: p.strict || m.strict }));
      }
    const seen = new Map<string, Ineq>();
    for (const q of next) {
      const k = q.c.join(',');
      const o = seen.get(k);
      if (!o || (q.strict && !o.strict)) seen.set(k, q);
    }
    S = [...seen.values()];
    if (S.some((q) => q.c.every((x) => x === 0) && q.strict)) return false;
  }
  return S.every((q) => !q.strict || q.c.some((x) => x !== 0));
}

function scaleIneqs(s: Scale, n: number): Ineq[] {
  const c = new Array(n).fill(0);
  s.L.forEach((i) => c[i]++);
  s.R.forEach((i) => c[i]--);
  if (s.out === '>') return [{ c, strict: true }];
  if (s.out === '<') return [{ c: c.map((x) => -x), strict: true }];
  return [
    { c, strict: false },
    { c: c.map((x) => -x), strict: false },
  ];
}

/** Which relations between objects a and b are consistent with the scales. */
export function possible(scales: Scale[], n: number, a: number, b: number): Rel[] {
  const base = scales.flatMap((s) => scaleIneqs(s, n));
  const out: Rel[] = [];
  for (const r of ['>', '=', '<'] as Rel[]) if (feasible([...base, ...scaleIneqs({ L: [a], R: [b], out: r }, n)], n)) out.push(r);
  return out;
}

/** The deducible relation, or null when the scales allow more than one. */
export function deduce(scales: Scale[], n: number, a: number, b: number): Rel | null {
  const p = possible(scales, n, a, b);
  return p.length === 1 ? p[0] : null;
}

/** A small subset of scales that still decides the question (greedy removal). */
export function decisive(scales: Scale[], n: number, a: number, b: number) {
  const want = deduce(scales, n, a, b);
  if (!want) return [];
  let keep = scales.map((_, i) => i);
  for (const i of [...keep]) {
    const trial = keep.filter((j) => j !== i);
    if (deduce(trial.map((j) => scales[j]), n, a, b) === want) keep = trial;
  }
  return keep;
}

export type Question = { kind: 'pair'; a: number; b: number; answer: Rel | null } | { kind: 'rank' };
export interface WeighRound {
  n: number;
  w: number[]; // one hidden assignment that produced the scales (for the reveal)
  scales: Scale[];
  q: Question;
}

const CFG: Record<Level, { n: number; scales: [number, number]; side: number; unknown: number; rank: number; equal: boolean }> = {
  easy: { n: 3, scales: [2, 2], side: 1, unknown: 0, rank: 0, equal: false },
  medium: { n: 4, scales: [3, 4], side: 2, unknown: 0.3, rank: 0, equal: false },
  hard: { n: 5, scales: [4, 5], side: 2, unknown: 0.35, rank: 2, equal: true },
};
export const ROUNDS = 6;

export function makeWeigh(seed: number, level: Level): WeighRound[] {
  const r = rng(seed);
  const cfg = CFG[level];
  const out: WeighRound[] = [];
  const rankAt = new Set<number>();
  while (rankAt.size < cfg.rank) rankAt.add(r.int(2, ROUNDS - 1));
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 5000) {
    const n = cfg.n;
    const w = Array.from({ length: n }, () => r.int(1, 9));
    if (!cfg.equal && new Set(w).size < n) continue;
    const ns = r.int(cfg.scales[0], cfg.scales[1]);
    const scales: Scale[] = [];
    const keys = new Set<string>();
    for (let t = 0; t < 60 && scales.length < ns; t++) {
      const objs = Array.from({ length: n }, (_, i) => i).sort(() => r.next() - 0.5);
      const nl = r.int(1, cfg.side);
      const nr = r.int(1, cfg.side);
      if (nl + nr > n) continue;
      const L = objs.slice(0, nl).sort();
      const R = objs.slice(nl, nl + nr).sort();
      const sl = L.reduce((s, i) => s + w[i], 0);
      const sr = R.reduce((s, i) => s + w[i], 0);
      const k = [L.join(''), R.join('')].sort().join('|');
      if (keys.has(k)) continue;
      // Equal readings only when the level allows equal weights (they are the strongest clues).
      if (sl === sr && !cfg.equal && nl === 1 && nr === 1) continue;
      keys.add(k);
      scales.push({ L, R, out: sl > sr ? '>' : sl < sr ? '<' : '=' });
    }
    if (scales.length < ns) continue;
    const i = out.length;
    if (rankAt.has(i)) {
      // Rank questions need every pair decided.
      let all = true;
      for (let a = 0; a < n && all; a++) for (let b = a + 1; b < n && all; b++) if (!deduce(scales, n, a, b)) all = false;
      if (!all) continue;
      out.push({ n, w, scales, q: { kind: 'rank' } });
      continue;
    }
    const a = r.int(0, n - 1);
    let b = r.int(0, n - 2);
    if (b >= a) b++;
    // Not asked directly by a one-against-one scale: the answer must be deduced.
    if (scales.some((s) => s.L.length === 1 && s.R.length === 1 && [s.L[0], s.R[0]].includes(a) && [s.L[0], s.R[0]].includes(b))) continue;
    const ans = deduce(scales, n, a, b);
    const wantUnknown = r.next() < cfg.unknown;
    if (wantUnknown !== (ans === null)) continue;
    out.push({ n, w, scales, q: { kind: 'pair', a: Math.min(a, b), b: Math.max(a, b), answer: deduce(scales, n, Math.min(a, b), Math.max(a, b)) } });
  }
  return out;
}

/** A witness: positive integer weights (≤ 12) fitting every scale with the asked relation, if one exists. */
export function witness(scales: Scale[], n: number, a: number, b: number, rel: Rel): number[] | null {
  const top = n <= 4 ? 12 : 8;
  const w = new Array(n).fill(1);
  const ok = () =>
    scales.every((s) => {
      const d = s.L.reduce((x, i) => x + w[i], 0) - s.R.reduce((x, i) => x + w[i], 0);
      return s.out === '>' ? d > 0 : s.out === '<' ? d < 0 : d === 0;
    }) && (rel === '>' ? w[a] > w[b] : rel === '<' ? w[a] < w[b] : w[a] === w[b]);
  const rec = (i: number): boolean => {
    if (i === n) return ok();
    for (let v = 1; v <= top; v++) {
      w[i] = v;
      if (rec(i + 1)) return true;
    }
    return false;
  };
  return rec(0) ? [...w] : null;
}

const NAME = 'ABCDE';
type Ans = Rel | 'unknown';
const scaleText = (s: Scale) => `${s.L.map((i) => NAME[i]).join('+')} ${s.out} ${s.R.map((i) => NAME[i]).join('+')}`;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: WeighRound[] = [];
  let round = 0;
  let phase: 'ask' | 'reveal' | 'done' = 'ask';
  let shownAt = 0;
  const ranker = new Ranker(5);
  let res: { pen: number; ans: Ans | number[]; ms: number }[] = [];
  let note = '';
  let dec: number[] = [];

  function reset(seed: number) {
    bench.clear();
    rounds = makeWeigh(seed, api.level);
    round = 0;
    res = [];
    begin();
  }

  function begin() {
    phase = 'ask';
    shownAt = performance.now();
    const rd = rounds[round];
    ranker.reset(rd.n);
    api.ownKeys(true);
    api.progress(`${round + 1} / ${ROUNDS}`);
    if (rd.q.kind === 'pair') api.prompt(`What can you conclude about ${NAME[rd.q.a]} and ${NAME[rd.q.b]}?`, `Only what the scales prove counts${api.level === 'easy' ? '' : ' · “Can’t tell” is a valid answer'} · keys 1–${api.level === 'easy' ? 3 : 4}`);
    else api.prompt('Rank every object from lightest to heaviest.', 'Tap the objects in order (keys 1–5) · Enter submits');
    stage.request();
  }

  function answer(a: Ans) {
    const rd = rounds[round];
    if (phase !== 'ask' || rd.q.kind !== 'pair') return;
    const truth: Ans = rd.q.answer ?? 'unknown';
    const pen = a === truth ? 0 : 1;
    res.push({ pen, ans: a, ms: performance.now() - shownAt });
    const A = NAME[rd.q.a];
    const B = NAME[rd.q.b];
    const say = (x: Ans) => (x === 'unknown' ? 'can’t tell' : x === '>' ? `${A} is heavier` : x === '<' ? `${B} is heavier` : `${A} = ${B}`);
    if (truth === 'unknown') {
      const w1 = witness(rd.scales, rd.n, rd.q.a, rd.q.b, '>');
      const w2 = witness(rd.scales, rd.n, rd.q.a, rd.q.b, '<') ?? witness(rd.scales, rd.n, rd.q.a, rd.q.b, '=');
      note = w1 && w2 ? `Both fit every scale: ${w1.map((v, i) => `${NAME[i]}=${v}`).join(' ')} and ${w2.map((v, i) => `${NAME[i]}=${v}`).join(' ')}` : 'More than one relation fits every scale.';
      dec = [];
    } else {
      dec = decisive(rd.scales, rd.n, rd.q.a, rd.q.b);
      note = `Decided by: ${dec.map((i) => scaleText(rd.scales[i])).join('  ·  ')}`;
    }
    api.judge(pen * 100, { x: stage.w / 2, y: 120 });
    api.prompt(pen ? `No — ${say(truth)}${truth === 'unknown' ? ': that is not provable from these scales' : ''}.` : `Right: ${say(truth)}.`, `${a !== truth && truth === 'unknown' ? 'Unsupported conclusion. ' : a === 'unknown' && truth !== 'unknown' ? 'It was deducible. ' : ''}${round < ROUNDS - 1 ? 'Tap for the next' : ''}`);
    reveal();
  }

  function submitRank() {
    const rd = rounds[round];
    if (phase !== 'ask' || rd.q.kind !== 'rank' || !ranker.done) return;
    const ps = pairScore(ranker.order, rd.w, false, 0);
    res.push({ pen: ps.frac, ans: [...ranker.order], ms: performance.now() - shownAt });
    dec = [];
    note = `One weight set that fits: ${rd.w.map((v, i) => `${NAME[i]}=${v}`).join(' ')}`;
    api.judge(ps.frac * 100, { x: stage.w / 2, y: 120 });
    api.prompt(ps.exact ? 'Exactly right.' : `${ps.wrong} of ${ps.total} pairs in the wrong order.`, `Lightest → heaviest: ${trueOrder(rd.w, false).map((i) => NAME[i]).join(' ≤ ')}${round < ROUNDS - 1 ? ' · tap for the next' : ''}`);
    reveal();
  }

  function reveal() {
    phase = 'reveal';
    api.ownKeys(false);
    if (round === ROUNDS - 1) finish();
  }

  function finish() {
    phase = 'done';
    const pct = mean(res.map((r) => r.pen)) * 100;
    const pairs = rounds.map((rd, i) => ({ rd, r: res[i] })).filter(({ rd }) => rd.q.kind === 'pair');
    const unsupported = pairs.filter(({ rd, r }) => rd.q.kind === 'pair' && rd.q.answer === null && r.ans !== 'unknown').length;
    const missed = pairs.filter(({ rd, r }) => rd.q.kind === 'pair' && rd.q.answer !== null && r.ans === 'unknown').length;
    const rows: [string, string][] = rounds.map((rd, i) => [
      `${i + 1} · ${rd.scales.length} scales`,
      rd.q.kind === 'pair' ? `${res[i].pen ? '✗' : '✓'} ${NAME[rd.q.a]} ? ${NAME[rd.q.b]}: ${rd.q.answer ?? 'can’t tell'} (you: ${res[i].ans === 'unknown' ? 'can’t tell' : res[i].ans})` : `rank · ${(res[i].pen * 100).toFixed(0)}% pairs wrong`,
    ]);
    rows.push(['Unsupported conclusions', String(unsupported)]);
    rows.push(['Deducible but answered “can’t tell”', String(missed)]);
    rows.push(['Mean time per question', `${(mean(res.map((r) => r.ms)) / 1000).toFixed(1)} s`]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'deductions wrong',
      headline: pct === 0 ? 'Every deduction sound.' : `${pct.toFixed(0)}% wrong${unsupported ? ` — ${unsupported} conclusion${unsupported > 1 ? 's' : ''} the scales did not support` : ''}.`,
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct === 0,
      near: pct < 10,
      share: [`WEIGH · ${api.level}`, `${pct.toFixed(0)}% wrong`],
    });
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    begin();
  }

  const options = (): { label: string; a: Ans }[] => {
    const rd = rounds[round];
    if (rd.q.kind !== 'pair') return [];
    const o: { label: string; a: Ans }[] = [
      { label: `${NAME[rd.q.a]} heavier`, a: '>' },
      { label: 'Equal', a: '=' },
      { label: `${NAME[rd.q.b]} heavier`, a: '<' },
    ];
    if (api.level !== 'easy') o.push({ label: 'Can’t tell', a: 'unknown' });
    return o;
  };

  bench.onTap = () => phase === 'reveal' && next();
  bench.onKey = (e) => {
    if (e.repeat) return;
    const rd = rounds[round];
    if (phase === 'ask') {
      const d = Number(e.key);
      if (rd.q.kind === 'pair' && d >= 1 && d <= options().length) answer(options()[d - 1].a);
      else if (rd.q.kind === 'rank' && d >= 1 && d <= rd.n) ranker.toggle(d - 1);
      else if (rd.q.kind === 'rank' && e.key === 'Backspace') ranker.undo();
      else if (rd.q.kind === 'rank' && e.key === 'Enter') submitRank();
      else return;
      e.preventDefault();
    } else if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      next();
    }
  };

  function drawScale(c: CanvasRenderingContext2D, cx: number, by: number, w: number, s: Scale, k: number) {
    const tilt = (s.out === '>' ? 1 : s.out === '<' ? -1 : 0) * 0.13 * k;
    const ph = w * 0.42;
    const py = by - ph;
    // Stand: a weighted foot and a post.
    softShadow(c, cx, by + 2, w * 0.3, 4, 1);
    solidBlock(c, cx - w * 0.16, by - 8, w * 0.32, 8, pal.ink3);
    line(c, cx, by - 8, cx, py, pal.ink2, 3);
    const half = w * 0.42;
    const ex = Math.cos(tilt) * half;
    const ey = Math.sin(tilt) * half;
    line(c, cx - ex, py - ey, cx + ex, py + ey, pal.ink, 3);
    c.beginPath();
    c.moveTo(cx, py - 5);
    c.lineTo(cx - 6, py + 5);
    c.lineTo(cx + 6, py + 5);
    c.closePath();
    c.fillStyle = pal.ink2;
    c.fill();
    const blk = Math.min(22, w * 0.16);
    const pan = (x: number, y: number, objs: number[]) => {
      const hy = y + w * 0.18;
      line(c, x, y, x - w * 0.14, hy, pal.ink3, 1);
      line(c, x, y, x + w * 0.14, hy, pal.ink3, 1);
      c.beginPath();
      c.ellipse(x, hy, w * 0.17, 4, 0, 0, Math.PI);
      c.fillStyle = alpha(pal.ink, 0.25);
      c.fill();
      line(c, x - w * 0.17, hy, x + w * 0.17, hy, pal.ink2, 2);
      objs.forEach((o, i) => {
        const bx = x - (objs.length * (blk + 3) - 3) / 2 + i * (blk + 3);
        rr(c, bx, hy - blk - 1, blk, blk, 3);
        c.fillStyle = pal.paper2;
        c.fill();
        c.strokeStyle = pal.ink2;
        c.lineWidth = 1;
        c.stroke();
        text(c, NAME[o], bx + blk / 2, hy - blk / 2 - 1, font.mono(Math.round(blk * 0.55), 600), pal.ink, 'center', 'middle');
      });
    };
    pan(cx - ex, py - ey, s.L);
    pan(cx + ex, py + ey, s.R);
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const W = stage.w;
    const top = 78;
    const ns = rd.scales.length;
    const perRow = W >= 900 ? ns : W >= 560 ? Math.min(ns, 3) : 2;
    const sw = Math.min(230, (W - 32) / perRow);
    const rowsN = Math.ceil(ns / perRow);
    const rowH = sw * 0.78;
    const settle = api.motion() ? clamp((now - shownAt) / 900, 0, 1) : 1;
    plate(c, 12, top - 8, W - 24, rowsN * rowH + 16, 12);
    rd.scales.forEach((s, i) => {
      const inRow = Math.min(perRow, ns - Math.floor(i / perRow) * perRow);
      const cx = W / 2 + ((i % perRow) - (inRow - 1) / 2) * sw;
      const by = top + Math.floor(i / perRow) * rowH + rowH - 8;
      drawScale(c, cx, by, sw * 0.9, s, springOut(settle));
      if (phase !== 'ask' && dec.includes(i)) text(c, 'decisive', cx, by + 12, font.mono(10, 600), pal.accent, 'center');
    });
    let y = top + rowsN * rowH + 22;
    if (rd.q.kind === 'pair') {
      if (phase === 'ask') {
        const o = options();
        bench.row(c, W / 2, y, Math.min(W - 32, 620), o.map((x, i) => ({ label: x.label, run: () => answer(x.a), o: { key: String(i + 1), color: x.a === 'unknown' ? AMBER : undefined } })));
      }
    } else {
      // Rank: the objects as tappable blocks.
      const bw = Math.min(64, (W - 32) / rd.n - 8);
      const shown = phase === 'ask' ? ranker.order : (res[round].ans as number[]);
      for (let i = 0; i < rd.n; i++) {
        const x = W / 2 + (i - (rd.n - 1) / 2) * (bw + 8) - bw / 2;
        rr(c, x, y, bw, bw, 6);
        c.fillStyle = pal.paper2;
        c.fill();
        c.strokeStyle = pal.ink2;
        c.stroke();
        text(c, NAME[i], x + bw / 2, y + bw / 2, font.mono(18, 600), pal.ink, 'center', 'middle');
        const rk = shown.indexOf(i) + 1;
        if (rk) badge(c, x + bw - 4, y + 4, rk, phase === 'ask' || rd.w[i] === rd.w[trueOrder(rd.w, false)[rk - 1]] ? pal.accent : pal.signal);
        if (phase === 'ask') bench.hit(x, y, bw, bw, () => ranker.toggle(i));
      }
      if (phase === 'ask') bench.row(c, W / 2, y + bw + 14, 300, [{ label: 'Submit', run: submitRank, o: { primary: true, off: !ranker.done, key: 'Enter' } }]);
    }
    if (phase !== 'ask' && note) {
      text(c, note, W / 2, y + (rd.q.kind === 'pair' ? 20 : 90), font.mono(11, 500), pal.ink2, 'center');
    }
    roundStrip(c, W, stage.h - 8, res.map((r) => (r.pen === 0 ? '✓' : '✗')), ROUNDS, round);
    return settle < 1;
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
