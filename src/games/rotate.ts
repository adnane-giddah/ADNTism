// 36 · ROTATE — which candidate is the reference shape turned, not flipped?
// Shapes are polyominoes (unit squares joined edge to edge) so equivalence is exact: two shapes are the same
// under rotation iff their canonical forms over the four quarter-turns match. Every reference is chiral (its
// mirror image is NOT a rotation of it), so a mirrored candidate is always wrong. Distractors: the mirror, a
// one-cell modification, and the modification's mirror — each checked to be inequivalent to the reference.
// Candidates are drawn turned by any angle; the logic never depends on the drawing.
import { clamp, easeInOut, font, pal, text } from '../core/draw';
import { alpha, plate, softShadow } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { Bench, mean, roundStrip } from './kit';

export type Cells = [number, number][];
const key = (c: Cells) => {
  const mx = Math.min(...c.map((p) => p[0]));
  const my = Math.min(...c.map((p) => p[1]));
  return c
    .map(([x, y]) => `${x - mx},${y - my}`)
    .sort()
    .join(' ');
};
export const rot90 = (c: Cells): Cells => c.map(([x, y]) => [y, -x]);
export const mirror = (c: Cells): Cells => c.map(([x, y]) => [-x, y]);
/** Canonical form under rotation only. */
export function canonRot(c: Cells) {
  let best = key(c);
  let cur = c;
  for (let i = 0; i < 3; i++) {
    cur = rot90(cur);
    const k = key(cur);
    if (k < best) best = k;
  }
  return best;
}
export const sameByRotation = (a: Cells, b: Cells) => canonRot(a) === canonRot(b);
export const chiral = (c: Cells) => !sameByRotation(c, mirror(c));

const NB = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const has = (c: Cells, x: number, y: number) => c.some((p) => p[0] === x && p[1] === y);
function connected(c: Cells) {
  const seen = new Set([0]);
  const st = [0];
  while (st.length) {
    const [x, y] = c[st.pop()!];
    c.forEach((p, i) => {
      if (!seen.has(i) && Math.abs(p[0] - x) + Math.abs(p[1] - y) === 1) {
        seen.add(i);
        st.push(i);
      }
    });
  }
  return seen.size === c.length;
}
export function grow(r: Rng, n: number): Cells {
  const c: Cells = [[0, 0]];
  while (c.length < n) {
    const [x, y] = r.pick(c);
    const [dx, dy] = r.pick(NB);
    if (!has(c, x + dx, y + dy)) c.push([x + dx, y + dy]);
  }
  return c;
}
/** Move one cell elsewhere (still connected, same size). */
export function modify(r: Rng, c: Cells): Cells | null {
  for (let t = 0; t < 60; t++) {
    const i = r.int(0, c.length - 1);
    const rest = c.filter((_, j) => j !== i);
    if (!connected(rest)) continue;
    const [x, y] = r.pick(rest);
    const [dx, dy] = r.pick(NB);
    if (has(rest, x + dx, y + dy) || (x + dx === c[i][0] && y + dy === c[i][1])) continue;
    return [...rest, [x + dx, y + dy]];
  }
  return null;
}

export interface RotRound {
  ref: Cells;
  cands: Cells[];
  angles: number[]; // display rotation per candidate (rad)
  answer: number;
  kinds: string[]; // 'rotation' | 'mirror' | 'modified' | 'modified mirror'
}
const CFG: Record<Level, { n: [number, number]; k: number; step: number }> = {
  easy: { n: [5, 5], k: 3, step: 90 },
  medium: { n: [6, 7], k: 4, step: 30 },
  hard: { n: [7, 9], k: 5, step: 15 },
};
export const ROUNDS = 10;

export function makeRotate(seed: number, level: Level): RotRound[] {
  const r = rng(seed);
  const cfg = CFG[level];
  const out: RotRound[] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 3000) {
    const ref = grow(r, r.int(cfg.n[0], cfg.n[1]));
    if (!chiral(ref)) continue;
    const m1 = modify(r, ref);
    const m2 = modify(r, ref);
    if (!m1 || !m2) continue;
    const pool: { c: Cells; kind: string }[] = [
      { c: ref, kind: 'rotation' },
      { c: mirror(ref), kind: 'mirror' },
      { c: m1, kind: 'modified' },
      { c: mirror(m1), kind: 'modified mirror' },
      { c: m2, kind: 'modified' },
    ].slice(0, cfg.k);
    // Every distractor must be inequivalent to the reference and to each other.
    const keys = pool.map((p) => canonRot(p.c));
    if (new Set(keys).size !== keys.length) continue;
    const order = pool.map((_, i) => i).sort(() => r.next() - 0.5);
    const angles = order.map(() => {
      const steps = Math.round(360 / cfg.step);
      let s = r.int(1, steps - 1);
      if (cfg.step < 90 && s * cfg.step < 30) s += 2;
      return (s * cfg.step * Math.PI) / 180;
    });
    out.push({ ref, cands: order.map((i) => pool[i].c), angles, answer: order.indexOf(0), kinds: order.map((i) => pool[i].kind) });
  }
  return out;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: RotRound[] = [];
  let round = 0;
  let phase: 'ask' | 'reveal' | 'done' = 'ask';
  let t0 = 0;
  let revealAt = 0;
  let res: { pick: number; ms: number }[] = [];

  function reset(seed: number) {
    bench.clear();
    rounds = makeRotate(seed, api.level);
    round = 0;
    res = [];
    begin();
  }
  function begin() {
    phase = 'ask';
    t0 = performance.now();
    api.ownKeys(true);
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('Which one is the reference, only turned?', `Mirror images don’t count — a flip is not a rotation · tap or keys 1–${rounds[round].cands.length}`);
    stage.request();
  }
  function pick(i: number) {
    if (phase !== 'ask') return;
    const rd = rounds[round];
    res.push({ pick: i, ms: performance.now() - t0 });
    const ok = i === rd.answer;
    api.judge(ok ? 0 : 100, { x: stage.w / 2, y: 110 });
    api.prompt(ok ? 'Right.' : `No — that one is the ${rd.kinds[i]}${rd.kinds[i].includes('mirror') ? ': it needs a flip, which no rotation can do' : ''}.`, `The rotation turns back onto the reference${round < ROUNDS - 1 ? ' · tap for the next' : ''}`);
    phase = 'reveal';
    revealAt = performance.now();
    api.ownKeys(false);
    if (round === ROUNDS - 1) finish();
  }
  function finish() {
    phase = 'done';
    const wrong = res.filter((r, i) => r.pick !== rounds[i].answer).length;
    const mirrors = res.filter((r, i) => r.pick !== rounds[i].answer && rounds[i].kinds[r.pick].includes('mirror')).length;
    const pct = (wrong / ROUNDS) * 100;
    const rows: [string, string][] = rounds.map((rd, i) => [`${i + 1} · ${rd.ref.length} cells`, `${res[i].pick === rd.answer ? '✓' : `✗ chose the ${rd.kinds[res[i].pick]}`} · ${(res[i].ms / 1000).toFixed(1)} s`]);
    rows.push(['Mirror images chosen', String(mirrors)]);
    rows.push(['Mean time (right answers)', `${(mean(res.filter((r, i) => r.pick === rounds[i].answer).map((r) => r.ms)) / 1000).toFixed(2)} s`]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'wrong choices',
      headline: wrong === 0 ? 'Every rotation found.' : `${wrong} of ${ROUNDS} wrong${mirrors ? ` — ${mirrors} of them mirror images` : ''}.`,
      rows,
      accuracy: 1 - wrong / ROUNDS,
      perfect: wrong === 0,
      near: wrong === 1,
      share: [`ROTATE · ${api.level}`, `${ROUNDS - wrong}/${ROUNDS}`],
    });
  }
  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    begin();
  }

  bench.onTap = () => phase === 'reveal' && next();
  bench.onKey = (e) => {
    if (e.repeat) return;
    const d = Number(e.key);
    if (phase === 'ask' && d >= 1 && d <= rounds[round].cands.length) pick(d - 1);
    else if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) next();
    else return;
    e.preventDefault();
  };

  function drawCells(c: CanvasRenderingContext2D, cells: Cells, cx: number, cy: number, u: number, ang: number, color: string) {
    const mx = cells.reduce((s, p) => s + p[0], 0) / cells.length;
    const my = cells.reduce((s, p) => s + p[1], 0) / cells.length;
    c.save();
    c.translate(cx, cy);
    softShadow(c, 0, u * 2.6, u * 2.4, u * 0.5, 0.8);
    c.rotate(ang);
    for (const [x, y] of cells) {
      const px = (x - mx - 0.5) * u;
      const py = (y - my - 0.5) * u;
      const g = c.createLinearGradient(0, py, 0, py + u);
      g.addColorStop(0, color);
      g.addColorStop(1, alpha(color, 0.78));
      c.fillStyle = g;
      c.fillRect(px - 0.4, py - 0.4, u + 0.8, u + 0.8);
    }
    c.strokeStyle = alpha(pal.paper, 0.35);
    c.lineWidth = 1;
    for (const [x, y] of cells) c.strokeRect((x - mx - 0.5) * u + 0.5, (y - my - 0.5) * u + 0.5, u - 1, u - 1);
    c.restore();
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const W = stage.w;
    const top = 74;
    const k = rd.cands.length;
    const rs = Math.max(120, Math.min(220, stage.h * 0.3, W - 32));
    plate(c, W / 2 - rs / 2, top, rs, rs, 12);
    text(c, 'REFERENCE', W / 2 - rs / 2 + 10, top + 16, font.mono(10, 600), pal.ink3);
    const span = (cells: Cells) => Math.max(...cells.flatMap((p) => p)) - Math.min(...cells.flatMap((p) => p)) + 1;
    const u0 = (rs * 0.62) / Math.max(4, span(rd.ref));
    drawCells(c, rd.ref, W / 2, top + rs / 2, u0, 0, pal.accent);
    const cw = Math.max(80, Math.min(170, (W - 32 - (k - 1) * 10) / k, stage.h - top - rs - 70));
    const y = top + rs + 18;
    const p = phase === 'ask' ? 0 : api.motion() ? easeInOut(clamp((now - revealAt - 150) / 700, 0, 1)) : 1;
    rd.cands.forEach((cells, i) => {
      const x = W / 2 + (i - (k - 1) / 2) * (cw + 10) - cw / 2;
      const judged = phase !== 'ask';
      const isAns = i === rd.answer;
      const chosen = judged && res[round].pick === i;
      plate(c, x, y, cw, cw, 10);
      const u = (cw * 0.6) / Math.max(4, span(cells));
      const ang = judged && isAns ? rd.angles[i] * (1 - p) : rd.angles[i];
      drawCells(c, cells, x + cw / 2, y + cw / 2, u, ang, judged ? (isAns ? pal.accent : chosen ? pal.signal : pal.ink3) : pal.ink);
      text(c, String(i + 1), x + 9, y + 16, font.mono(11, 600), pal.ink2);
      if (judged) text(c, rd.kinds[i], x + cw / 2, y + cw - 8, font.mono(10, 500), isAns ? pal.accent : pal.ink3, 'center');
      if (phase === 'ask') bench.hit(x, y, cw, cw, () => pick(i));
    });
    roundStrip(c, W, stage.h - 8, res.map((r, i) => (r.pick === rounds[i].answer ? '✓' : '✗')), ROUNDS, round);
    return phase !== 'ask' && p < 1;
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
