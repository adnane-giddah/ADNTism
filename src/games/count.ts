// 34 · COUNT — a grid of discs in four (Hard: five) categories. Rank the categories by how many discs they
// have, most first, after a look too short to count one by one. Every category has its own colour AND its
// own mark (dot, ring, bar, cross, slash), so colour vision is never required. Boards hold exactly the
// generated counts; tied categories may be ranked either way (pairwise, tie-aware scoring).
import { circle, clamp, font, line, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { AMBER, badge, BLUE, Bench, mean, pairScore, Ranker, roundStrip, shuffle, trueOrder, VIOLET } from './kit';

export const ROUNDS = 6;
export interface CountRound {
  rows: number;
  cols: number;
  cells: number[]; // category per cell
  counts: number[];
  size: number[]; // disc radius factor per category (Hard: the commonest get the smallest discs)
  layout: 'scatter' | 'clusters' | 'stripes';
}

const CFG: Record<Level, { rows: number; cols: number; k: number; spread: [number, number]; look: number }> = {
  easy: { rows: 5, cols: 6, k: 4, spread: [2, 4], look: 4500 },
  medium: { rows: 7, cols: 8, k: 4, spread: [1, 2], look: 4000 },
  hard: { rows: 8, cols: 9, k: 5, spread: [1, 1], look: 3800 },
};

/** Counts that sum to the board, adjacent gaps within `spread` (ties allowed on Medium/Hard). */
export function makeCounts(total: number, k: number, spread: [number, number], next: () => number, ties: boolean) {
  for (let t = 0; t < 2000; t++) {
    const gaps = Array.from({ length: k - 1 }, () => (ties && next() < 0.2 ? 0 : spread[0] + Math.floor(next() * (spread[1] - spread[0] + 1))));
    // counts[k-1] = base, each previous adds its gap.
    const offs = [0];
    for (let i = k - 2; i >= 0; i--) offs.unshift(offs[0] + gaps[i]);
    const sum = offs.reduce((a, b) => a + b, 0);
    if ((total - sum) % k) continue;
    const base = (total - sum) / k;
    if (base < 2) continue;
    return offs.map((o) => base + o);
  }
  throw new Error('makeCounts: no solution');
}

export function makeCount(seed: number, level: Level): CountRound[] {
  const r = rng(seed);
  const cfg = CFG[level];
  return Array.from({ length: ROUNDS }, (_, ri) => {
    const total = cfg.rows * cfg.cols;
    const sorted = makeCounts(total, cfg.k, cfg.spread, r.next, level !== 'easy');
    // Which colour gets which count is random.
    const cats = shuffle(Array.from({ length: cfg.k }, (_, i) => i), r.next);
    const counts = new Array(cfg.k).fill(0);
    cats.forEach((c, i) => (counts[c] = sorted[i]));
    const labels: number[] = [];
    counts.forEach((n, c) => {
      for (let i = 0; i < n; i++) labels.push(c);
    });
    const layout = (['scatter', 'clusters', 'stripes'] as const)[level === 'easy' ? 0 : ri % 3];
    // Order the cells by a smooth field (clusters), by rows (stripes) or randomly, then deal the labels.
    const idx = Array.from({ length: total }, (_, i) => i);
    const ph = [r.range(0, 6), r.range(0, 6), r.range(0.5, 1.2), r.range(0.5, 1.2)];
    const key = (i: number) => {
      const x = i % cfg.cols;
      const y = Math.floor(i / cfg.cols);
      if (layout === 'clusters') return Math.sin(x * ph[2] + ph[0]) + Math.cos(y * ph[3] + ph[1]) + r.range(-0.6, 0.6);
      if (layout === 'stripes') return y * cfg.cols + x + r.range(-6, 6);
      return r.next();
    };
    const keys = idx.map(key);
    idx.sort((a, b) => keys[a] - keys[b]);
    const cells = new Array(total).fill(0);
    idx.forEach((cell, j) => (cells[cell] = labels[j]));
    // Hard: the commoner categories get smaller discs (more ink is not more items).
    const order = trueOrder(counts);
    const size = new Array(cfg.k).fill(1);
    if (level === 'hard') order.forEach((c, rank) => (size[c] = 0.72 + (0.28 * rank) / (cfg.k - 1)));
    return { rows: cfg.rows, cols: cfg.cols, cells, counts, size, layout };
  });
}

export const COLORS = () => [pal.accent, AMBER, VIOLET, pal.ink, BLUE];
const NAMES = ['cyan', 'amber', 'violet', 'white', 'blue'];

/** The category mark inside a disc (shape, so colour alone never carries the category). */
function mark(c: CanvasRenderingContext2D, cat: number, x: number, y: number, r: number) {
  const ink = pal.paper;
  if (cat === 0) circle(c, x, y, r * 0.28, undefined, ink);
  else if (cat === 1) circle(c, x, y, r * 0.42, ink, undefined, Math.max(1, r * 0.16));
  else if (cat === 2) line(c, x - r * 0.5, y, x + r * 0.5, y, ink, Math.max(1, r * 0.2));
  else if (cat === 3) {
    line(c, x - r * 0.38, y - r * 0.38, x + r * 0.38, y + r * 0.38, ink, Math.max(1, r * 0.18));
    line(c, x - r * 0.38, y + r * 0.38, x + r * 0.38, y - r * 0.38, ink, Math.max(1, r * 0.18));
  } else line(c, x - r * 0.4, y + r * 0.4, x + r * 0.4, y - r * 0.4, ink, Math.max(1, r * 0.2));
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: CountRound[] = [];
  let round = 0;
  let phase: 'ready' | 'look' | 'rank' | 'reveal' | 'done' = 'ready';
  let shownAt = 0;
  const ranker = new Ranker(4);
  let res: { order: number[]; frac: number; exact: boolean }[] = [];

  function reset(seed: number) {
    bench.clear();
    rounds = makeCount(seed, api.level);
    round = 0;
    res = [];
    ready();
  }

  function ready() {
    phase = 'ready';
    ranker.reset(rounds[round].counts.length);
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('Which colour has the most discs? Rank them, most first.', `You see the board for ${(CFG[api.level].look / 1000).toFixed(1)} s — too short to count · press to look`);
    stage.request();
  }

  function look() {
    phase = 'look';
    shownAt = performance.now();
    api.ownKeys(true);
    api.prompt('Rank the colours: most discs first.', `Tap the chips in order (keys 1–${rounds[round].counts.length}) · you can rank while the board shows`);
    bench.later(() => {
      if (phase === 'look') phase = 'rank';
      stage.request();
    }, CFG[api.level].look);
    stage.request();
  }

  function submit() {
    if ((phase !== 'rank' && phase !== 'look') || !ranker.done) return;
    bench.clear();
    const rd = rounds[round];
    const ps = pairScore(ranker.order, rd.counts, true, 0);
    res.push({ order: [...ranker.order], frac: ps.frac, exact: ps.exact });
    api.judge(ps.frac * 100, { x: stage.w / 2, y: 120 });
    api.prompt(ps.exact ? 'Exactly right.' : `${ps.wrong} of ${ps.total} pairs in the wrong order.`, `Counts: ${trueOrder(rd.counts).map((c) => `${NAMES[c]} ${rd.counts[c]}`).join(' · ')}${round < ROUNDS - 1 ? ' · tap for the next' : ''}`);
    phase = 'reveal';
    api.ownKeys(false);
    if (round === ROUNDS - 1) finish();
  }

  function finish() {
    phase = 'done';
    const pct = mean(res.map((r) => r.frac)) * 100;
    const exact = res.filter((r) => r.exact).length;
    const rows: [string, string][] = rounds.map((rd, i) => [`${i + 1} · ${rd.layout}`, `${res[i].exact ? '✓' : '✗'} ${trueOrder(rd.counts).map((c) => rd.counts[c]).join(' ≥ ')} · you ${res[i].order.map((c) => rd.counts[c]).join(', ')}`]);
    rows.push(['Exact rankings', `${exact} of ${ROUNDS}`]);
    // Did the top pick go to the category with the biggest discs?
    if (api.level === 'hard') rows.push(['Top pick was the biggest-disc colour', `${rounds.filter((rd, i) => rd.size[res[i].order[0]] === Math.max(...rd.size)).length} of ${ROUNDS}`]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'pairs in the wrong order',
      headline: exact === ROUNDS ? 'Every ranking exact.' : `${pct.toFixed(1)}% of pairs misordered; ${exact} of ${ROUNDS} exact.`,
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct === 0,
      near: pct < 6,
      share: [`COUNT · ${api.level}`, `${pct.toFixed(1)}% pairs wrong`],
    });
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    ready();
  }

  bench.onTap = () => {
    if (phase === 'ready') look();
    else if (phase === 'reveal') next();
  };
  bench.onKey = (e) => {
    if (e.repeat) return;
    const go = e.key === 'Enter' || e.code === 'Space';
    if (phase === 'ready' && go) look();
    else if (phase === 'reveal' && go) next();
    else if (phase === 'look' || phase === 'rank') {
      const d = Number(e.key);
      if (d >= 1 && d <= ranker.n) ranker.toggle(d - 1);
      else if (e.key === 'Backspace') ranker.undo();
      else if (e.key === 'Enter') submit();
      else return;
    } else return;
    e.preventDefault();
  };
  bench.onAway = () => {
    if (phase === 'look') api.voidRun('Attempt voided — the page lost focus while the board was showing.');
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const W = stage.w;
    const top = 74;
    const cell = Math.max(14, Math.min((W - 40) / rd.cols, (stage.h - top - 150) / rd.rows, 52));
    const gw = cell * rd.cols;
    const gh = cell * rd.rows;
    const x0 = (W - gw) / 2;
    plate(c, x0 - 10, top - 10, gw + 20, gh + 20, 12);
    const cols = COLORS();
    const visible = phase === 'look' || phase === 'reveal' || phase === 'done';
    const age = now - shownAt;
    const more = phase === 'look';
    rd.cells.forEach((cat, i) => {
      const x = x0 + (i % rd.cols) * cell + cell / 2;
      const y = top + Math.floor(i / rd.cols) * cell + cell / 2;
      if (!visible) {
        circle(c, x, y, cell * 0.36, pal.line2, alpha(pal.ink, 0.04));
        return;
      }
      const rad = cell * 0.4 * rd.size[cat] * (phase === 'look' && api.motion() ? clamp(age / 200 - (i % 7) * 0.02, 0, 1) : 1);
      circle(c, x, y, rad, undefined, cols[cat]);
      if (rad > 3) mark(c, cat, x, y, rad);
    });
    if (phase === 'look') {
      const left = clamp(1 - age / CFG[api.level].look, 0, 1);
      line(c, x0, top + gh + 14, x0 + gw * left, top + gh + 14, pal.accent, 2);
    }
    // Category chips: tap to rank.
    const k = rd.counts.length;
    const cw = Math.min(110, (W - 32 - (k - 1) * 8) / k);
    const cy = top + gh + 28;
    const judged = phase === 'reveal' || phase === 'done';
    const shown = judged ? res[round].order : ranker.order;
    const truth = trueOrder(rd.counts);
    for (let i = 0; i < k; i++) {
      const x = W / 2 + (i - (k - 1) / 2) * (cw + 8) - cw / 2;
      rr(c, x, cy, cw, 40, 8);
      c.fillStyle = pal.paper2;
      c.fill();
      c.strokeStyle = pal.line;
      c.lineWidth = 1;
      c.stroke();
      circle(c, x + 18, cy + 20, 10, undefined, cols[i]);
      mark(c, i, x + 18, cy + 20, 10);
      text(c, judged ? String(rd.counts[i]) : String(i + 1), x + 36, cy + 21, font.mono(12, 600), judged ? pal.ink : pal.ink3, 'left', 'middle');
      const rank = shown.indexOf(i) + 1;
      if (rank) badge(c, x + cw - 14, cy + 20, rank, !judged || rd.counts[i] === rd.counts[truth[rank - 1]] ? pal.accent : pal.signal);
      if (phase === 'look' || phase === 'rank') bench.hit(x, cy, cw, 40, () => ranker.toggle(i));
    }
    if (phase === 'look' || phase === 'rank')
      bench.row(c, W / 2, cy + 52, Math.min(W - 32, 360), [
        { label: 'Clear', run: () => ranker.reset(), o: { off: !ranker.order.length } },
        { label: 'Submit', run: submit, o: { primary: true, off: !ranker.done, key: 'Enter' } },
      ]);
    if (phase === 'ready') text(c, 'press to look', W / 2, top + gh / 2, font.mono(12, 500), pal.ink2, 'center', 'middle');
    roundStrip(c, W, stage.h - 8, res.map((r) => (r.exact ? '✓' : (r.frac * 100).toFixed(0))), ROUNDS, round);
    return more;
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
