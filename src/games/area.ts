// 30 · AREA — rank the shapes by their true area, largest first.
// Each shape is built to an exact target area: polygons by the shoelace formula, circles πr², ellipses πab,
// a stadium wh + πr². Shapes that look big (long, spiky, wide) are given the smaller areas on Hard. Scoring
// is pairwise: the share of pairs you put in the wrong order (tie-aware), so getting only the ends right
// does not earn full credit.
import { font, pal, text } from '../core/draw';
import { alpha, plate, softShadow } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { bbox, centroid, ellipsePts, P, polyArea, regular, rotate, scale, translate } from './geom';
import { badge, Bench, mean, pairScore, Ranker, roundStrip, trueOrder, type Pt } from './kit';

export const ROUNDS = 6;
export type Kind = 'rect' | 'square' | 'triangle' | 'circle' | 'ellipse' | 'parallelogram' | 'trapezoid' | 'polygon' | 'L' | 'stadium' | 'irregular';
export interface Shape {
  kind: Kind;
  pts: Pt[]; // outline in u, centred near the origin (curved shapes are finely sampled)
  area: number; // exact, u²
  elong: number; // bounding-box aspect (≥ 1)
}
export interface AreaRound {
  shapes: Shape[];
}

const ELONG: Kind[] = ['rect', 'triangle', 'ellipse', 'parallelogram', 'trapezoid', 'L', 'stadium', 'irregular'];
const COMPACT: Kind[] = ['square', 'circle', 'polygon', 'irregular', 'triangle', 'L'];

/** A unit-ish shape of the kind and its exact area; the caller scales it to the target area. */
function base(r: Rng, kind: Kind, stretch: number): { pts: Pt[]; area: number } {
  switch (kind) {
    case 'square':
      return { pts: [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], area: 4 };
    case 'rect':
      return { pts: [P(-stretch, -1), P(stretch, -1), P(stretch, 1), P(-stretch, 1)], area: 4 * stretch };
    case 'triangle': {
      const b = 2 * stretch;
      const apex = r.range(-0.2, 1.2) * b;
      const pts = [P(0, 0), P(b, 0), P(apex, 2)];
      return { pts, area: polyArea(pts) };
    }
    case 'circle':
      return { pts: ellipsePts(0, 0, 1, 1, 0, 180), area: Math.PI };
    case 'ellipse':
      return { pts: ellipsePts(0, 0, stretch, 1, 0, 180), area: Math.PI * stretch };
    case 'parallelogram': {
      const s = r.range(0.5, 1.4) * r.sign();
      const pts = [P(0, 0), P(2 * stretch, 0), P(2 * stretch + s, 2), P(s, 2)];
      return { pts, area: polyArea(pts) };
    }
    case 'trapezoid': {
      const top = r.range(0.25, 0.7) * 2 * stretch;
      const off = r.range(0, 2 * stretch - top);
      const pts = [P(0, 0), P(2 * stretch, 0), P(off + top, 2), P(off, 2)];
      return { pts, area: polyArea(pts) };
    }
    case 'polygon': {
      const pts = regular(r.pick([5, 6, 8]), 1, r.range(0, 1));
      return { pts, area: polyArea(pts) };
    }
    case 'L': {
      const W = 1 + stretch;
      const t = r.range(0.45, 0.8);
      const pts = [P(0, 0), P(W, 0), P(W, t), P(t, t), P(t, 2), P(0, 2)];
      return { pts, area: polyArea(pts) };
    }
    case 'stadium': {
      // A rectangle 2s × 2 with semicircular caps of radius 1: area 4s + π.
      const s = stretch * 0.8;
      const pts: Pt[] = [];
      for (let i = 0; i <= 60; i++) pts.push(P(s + Math.cos(-Math.PI / 2 + (i * Math.PI) / 60), Math.sin(-Math.PI / 2 + (i * Math.PI) / 60)));
      for (let i = 0; i <= 60; i++) pts.push(P(-s + Math.cos(Math.PI / 2 + (i * Math.PI) / 60), Math.sin(Math.PI / 2 + (i * Math.PI) / 60)));
      return { pts, area: 4 * s + Math.PI };
    }
    case 'irregular': {
      const n = r.int(7, 10);
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
        const rad = r.range(0.45, 1.15);
        return P(Math.cos(a) * rad * stretch, Math.sin(a) * rad);
      });
      return { pts, area: polyArea(pts) };
    }
  }
}

/** A shape of exactly `area` u², rotated, fitting a 90 u box — or null. */
export function makeShape(r: Rng, kind: Kind, area: number, stretch: number): Shape | null {
  const b = base(r, kind, stretch);
  const k = Math.sqrt(area / b.area);
  let pts = scale(b.pts, k);
  const c = centroid(pts);
  pts = rotate(translate(pts, -c.x, -c.y), r.range(0, Math.PI * 2));
  const bb = bbox(pts);
  if (bb.w > 90 || bb.h > 90) return null;
  pts = translate(pts, -(bb.x0 + bb.x1) / 2, -(bb.y0 + bb.y1) / 2);
  return { kind, pts, area: b.area * k * k, elong: Math.max(bb.w, bb.h) / Math.max(1e-9, Math.min(bb.w, bb.h)) };
}

const CFG: Record<Level, { n: [number, number]; gap: number; illusion: boolean }> = {
  easy: { n: [3, 3], gap: 0.2, illusion: false },
  medium: { n: [3, 4], gap: 0.08, illusion: false },
  hard: { n: [4, 5], gap: 0.035, illusion: true },
};

export function makeArea(seed: number, level: Level): AreaRound[] {
  const r = rng(seed);
  const cfg = CFG[level];
  const out: AreaRound[] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 3000) {
    const n = out.length < ROUNDS / 2 ? cfg.n[0] : cfg.n[1];
    // Areas spaced by at least `gap` (relative) — the closest pair sits near the gap on Hard.
    const areas: number[] = [r.range(700, 1100)];
    for (let i = 1; i < n; i++) areas.push(areas[i - 1] * (1 + cfg.gap * r.range(1, level === 'hard' ? 1.6 : 2.4)));
    if (areas[n - 1] > 2700) continue;
    // Illusion: the smallest areas get the long, eye-catching kinds; the largest the compact ones.
    const shapes: Shape[] = [];
    for (let i = 0; i < n && shapes.length === i; i++) {
      const small = i < n / 2;
      const kind = cfg.illusion ? r.pick(small ? ELONG : COMPACT) : r.pick([...ELONG, ...COMPACT]);
      const stretch = cfg.illusion && small ? r.range(2.2, 3.4) : r.range(1, 2.2);
      for (let t = 0; t < 30; t++) {
        const s = makeShape(r, kind, areas[i], stretch);
        if (s) {
          shapes.push(s);
          break;
        }
      }
    }
    if (shapes.length < n) continue;
    // Shuffle the display order.
    for (let i = n - 1; i > 0; i--) {
      const j = r.int(0, i);
      [shapes[i], shapes[j]] = [shapes[j], shapes[i]];
    }
    out.push({ shapes });
  }
  return out;
}

const LETTERS = 'ABCDE';

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: AreaRound[] = [];
  let round = 0;
  let phase: 'rank' | 'reveal' | 'done' = 'rank';
  const ranker = new Ranker(3);
  let t0 = 0;
  let res: { order: number[]; frac: number; exact: boolean; ms: number }[] = [];
  let revealAt = 0;

  const layout = (n: number) => {
    const W = stage.w;
    const H = stage.h;
    const top = 74;
    const cols = W >= 640 ? n : W >= 420 ? Math.min(n, 3) : 2;
    const rows = Math.ceil(n / cols);
    const cell = Math.max(96, Math.min((W - 32 - (cols - 1) * 12) / cols, (H - top - 120 - (rows - 1) * 12) / rows, 260));
    const x0 = W / 2 - (cols * cell + (cols - 1) * 12) / 2;
    const cells = Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * (cell + 12), y: top + Math.floor(i / cols) * (cell + 12) }));
    return { cell, cells, by: top + rows * (cell + 12) + 6 };
  };

  function prompt() {
    const n = rounds[round].shapes.length;
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('Rank the shapes by area — largest first.', `Tap them in order (or keys 1–${n}) · tap again to take back · Enter submits`);
  }

  function reset(seed: number) {
    bench.clear();
    rounds = makeArea(seed, api.level);
    round = 0;
    res = [];
    begin();
  }

  function begin() {
    phase = 'rank';
    ranker.reset(rounds[round].shapes.length);
    t0 = performance.now();
    api.ownKeys(true);
    prompt();
    stage.request();
  }

  function submit() {
    if (phase !== 'rank' || !ranker.done) return;
    const rd = rounds[round];
    const areas = rd.shapes.map((s) => s.area);
    const ps = pairScore(ranker.order, areas, true, 1e-6);
    res.push({ order: [...ranker.order], frac: ps.frac, exact: ps.exact, ms: performance.now() - t0 });
    api.judge(ps.frac * 100, { x: stage.w / 2, y: 110 });
    const truth = trueOrder(areas).map((i) => LETTERS[i]).join(' > ');
    api.prompt(ps.exact ? 'Exactly right.' : `${ps.wrong} of ${ps.total} pairs in the wrong order.`, `True order ${truth}${round < ROUNDS - 1 ? ' · tap for the next' : ''}`);
    phase = 'reveal';
    revealAt = performance.now();
    api.ownKeys(false);
    if (round === ROUNDS - 1) finish();
  }

  function finish() {
    phase = 'done';
    const pct = mean(res.map((r) => r.frac)) * 100;
    const exact = res.filter((r) => r.exact).length;
    const rows: [string, string][] = rounds.map((rd, i) => {
      const areas = rd.shapes.map((s) => s.area);
      return [`${i + 1} · ${rd.shapes.length} shapes`, `${res[i].exact ? '✓' : '✗'} you ${res[i].order.map((j) => LETTERS[j]).join('>')} · truth ${trueOrder(areas).map((j) => LETTERS[j]).join('>')} · ${(res[i].ms / 1000).toFixed(1)} s`];
    });
    rows.push(['Exact orders', `${exact} of ${ROUNDS}`]);
    // The usual error: ranking an elongated shape too high.
    let over = 0;
    rounds.forEach((rd, i) => {
      const o = res[i].order;
      for (let p = 0; p < o.length; p++) for (let q = p + 1; q < o.length; q++) if (rd.shapes[o[p]].area < rd.shapes[o[q]].area && rd.shapes[o[p]].elong > rd.shapes[o[q]].elong) over++;
    });
    rows.push(['Swaps that favoured the longer shape', String(over)]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'pairs in the wrong order',
      headline: exact === ROUNDS ? 'Every ranking exact.' : `${pct.toFixed(1)}% of pairs misordered; ${exact} of ${ROUNDS} rankings exact.`,
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct === 0,
      near: pct < 5,
      share: [`AREA · ${api.level}`, `${pct.toFixed(1)}% pairs wrong`],
    });
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    begin();
  }

  bench.onTap = () => {
    if (phase === 'reveal') next();
  };
  bench.onKey = (e) => {
    if (e.repeat) return;
    if (phase === 'rank') {
      const d = Number(e.key);
      if (d >= 1 && d <= ranker.n) ranker.toggle(d - 1);
      else if (e.key === 'Backspace') ranker.undo();
      else if (e.key === 'Enter') submit();
      else return;
      api.sfx.tick();
      e.preventDefault();
    } else if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      next();
    }
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const n = rd.shapes.length;
    const { cell, cells, by } = layout(n);
    const k = cell / 100;
    const judged = phase !== 'rank';
    const areas = rd.shapes.map((s) => s.area);
    const truth = trueOrder(areas);
    const mine = judged ? res[round].order : ranker.order;
    const grow = judged && api.motion() ? Math.min(1, (now - revealAt) / 350) : 1;
    rd.shapes.forEach((s, i) => {
      const b = cells[i];
      const cx = b.x + cell / 2;
      const cy = b.y + cell / 2;
      const rank = mine.indexOf(i) + 1;
      plate(c, b.x, b.y, cell, cell, 10);
      softShadow(c, cx, cy + 40 * k, 30 * k, 6 * k, 0.8);
      c.beginPath();
      s.pts.forEach((p, j) => (j ? c.lineTo(cx + p.x * k, cy + p.y * k) : c.moveTo(cx + p.x * k, cy + p.y * k)));
      c.closePath();
      c.fillStyle = alpha(pal.ink, rank && !judged ? 0.85 : 0.72);
      c.fill();
      c.strokeStyle = pal.ink;
      c.lineWidth = 1;
      c.stroke();
      text(c, LETTERS[i], b.x + 10, b.y + 18, font.mono(12, 600), pal.ink2);
      if (rank) badge(c, b.x + cell - 18, b.y + 18, rank, judged ? (truth.indexOf(i) + 1 === rank ? pal.accent : pal.signal) : pal.accent);
      if (judged) {
        text(c, `${s.area.toFixed(0)} u²`, cx, b.y + cell - 10, font.mono(12, 600), pal.ink, 'center');
        text(c, `#${truth.indexOf(i) + 1}`, b.x + 10, b.y + cell - 10, font.mono(11, 600), pal.accent);
        // A bar proportional to the true area, growing in.
        const w = ((cell - 20) * s.area * grow) / Math.max(...areas);
        c.fillStyle = alpha(pal.accent, 0.5);
        c.fillRect(b.x + 10, b.y + cell - 30, w, 3);
      }
      if (!judged) bench.hit(b.x, b.y, cell, cell, () => ranker.toggle(i));
    });
    if (phase === 'rank') {
      bench.row(c, stage.w / 2, by, Math.min(stage.w - 32, 360), [
        { label: 'Clear', run: () => ranker.reset(), o: { off: !ranker.order.length } },
        { label: 'Submit', run: submit, o: { primary: true, off: !ranker.done, key: 'Enter' } },
      ]);
    }
    roundStrip(c, stage.w, stage.h - 8, res.map((r) => (r.exact ? '✓' : (r.frac * 100).toFixed(0))), ROUNDS, round);
    return grow < 1;
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
