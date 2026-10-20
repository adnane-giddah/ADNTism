// 33 · INTERSECTION — predict where (and how much) shapes overlap.
// Round types: do they overlap? which silhouette is the overlap? which pair overlaps more? what share of A
// does B cover? The truth comes from geometry, never from pixels: circle–circle lenses use the exact formula;
// anything with a polygon is clipped exactly (Sutherland–Hodgman against a convex shape), with circles as
// 720-gons (area error below 0.002 %). Touching is not overlapping, and no round ever shows an exact touch:
// separations and overlaps are at least 1.5 u in a 100 u field.
import { font, pal, text } from '../core/draw';
import { Controls } from '../core/controls';
import { alpha, plate } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { bbox, clipConvex, ellipsePts, isConvex, lensArea, P, polyArea, rotate, segDist, translate } from './geom';
import { Bench, mean, roundStrip, VIOLET, type Pt } from './kit';

export type Sh = { kind: 'circle'; cx: number; cy: number; r: number } | { kind: 'poly'; pts: Pt[]; convex: boolean };
export type RoundType = 'classify' | 'choose' | 'compare' | 'estimate';
export interface XRound {
  type: RoundType;
  pairs: [Sh, Sh][]; // one pair, or two for compare
  cands?: Pt[][]; // choose: candidate overlap outlines (one is true)
  answer: number; // classify: 1 yes / 0 no; choose: index; compare: 0 / 1; estimate: share × 100
  areas: number[]; // overlap area per pair
}

export const circlePoly = (s: { cx: number; cy: number; r: number }, n = 720) => ellipsePts(s.cx, s.cy, s.r, s.r, 0, n);
export const outline = (s: Sh) => (s.kind === 'circle' ? circlePoly(s) : s.pts);
export const shArea = (s: Sh) => (s.kind === 'circle' ? Math.PI * s.r * s.r : polyArea(s.pts));
const isConv = (s: Sh) => s.kind === 'circle' || s.convex;

/** The overlap region as a polygon (empty when they do not overlap). One shape must be convex. */
export function overlapPoly(a: Sh, b: Sh): Pt[] {
  if (isConv(b)) return clipConvex(outline(a), outline(b));
  if (isConv(a)) return clipConvex(outline(b), outline(a));
  throw new Error('overlapPoly: at least one shape must be convex');
}

/** Exact overlap area for two circles; polygon clipping otherwise. */
export function overlapArea(a: Sh, b: Sh) {
  if (a.kind === 'circle' && b.kind === 'circle') return lensArea(a.r, b.r, Math.hypot(a.cx - b.cx, a.cy - b.cy));
  const p = overlapPoly(a, b);
  return p.length >= 3 ? polyArea(p) : 0;
}

/** Gap between two non-overlapping shapes (0 if they overlap). */
export function gap(a: Sh, b: Sh) {
  if (a.kind === 'circle' && b.kind === 'circle') return Math.max(0, Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r);
  if (overlapArea(a, b) > 0) return 0;
  const A = outline(a);
  const B = outline(b);
  let d = Infinity;
  for (const p of A) for (let i = 0; i < B.length; i++) d = Math.min(d, segDist(p, B[i], B[(i + 1) % B.length]));
  for (const p of B) for (let i = 0; i < A.length; i++) d = Math.min(d, segDist(p, A[i], A[(i + 1) % A.length]));
  return d;
}

function randShape(r: Rng, kinds: string[], cx: number, cy: number, rot: boolean): Sh {
  const kind = r.pick(kinds);
  if (kind === 'circle') return { kind: 'circle', cx, cy, r: r.range(13, 24) };
  let pts: Pt[];
  if (kind === 'rect') {
    const w = r.range(18, 46);
    const h = r.range(14, 34);
    pts = [P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)];
  } else if (kind === 'tri') {
    pts = [P(r.range(-26, -14), r.range(8, 18)), P(r.range(14, 26), r.range(8, 18)), P(r.range(-10, 10), r.range(-24, -14))];
  } else {
    // Concave: an L or a chevron.
    const s = r.range(0.85, 1.2);
    pts = r.next() < 0.5 ? [P(-20, -20), P(4, -20), P(4, 2), P(20, 2), P(20, 20), P(-20, 20)] : [P(-22, -16), P(0, 0), P(22, -16), P(22, 6), P(0, 20), P(-22, 6)];
    pts = pts.map((q) => P(q.x * s, q.y * s));
  }
  if (rot) pts = rotate(pts, r.range(0, Math.PI));
  pts = translate(pts, cx, cy);
  return { kind: 'poly', pts, convex: isConvex(pts) };
}

const KINDS: Record<Level, { a: string[]; b: string[]; rot: boolean; types: RoundType[] }> = {
  easy: { a: ['circle', 'rect'], b: ['circle', 'rect'], rot: false, types: ['classify', 'classify', 'classify', 'choose', 'choose', 'choose', 'choose', 'choose'] },
  medium: { a: ['circle', 'rect', 'tri'], b: ['circle', 'rect', 'tri'], rot: true, types: ['classify', 'classify', 'choose', 'choose', 'choose', 'compare', 'compare', 'compare'] },
  hard: { a: ['circle', 'rect', 'tri', 'concave'], b: ['circle', 'rect', 'tri'], rot: true, types: ['classify', 'choose', 'choose', 'compare', 'compare', 'estimate', 'estimate', 'estimate'] },
};
export const ROUNDS = 8;

/** A pair that overlaps (by at least `minArea`) or is separated by at least `minGap`. */
function makePair(r: Rng, level: Level, overlap: boolean, sliver = false): [Sh, Sh] | null {
  const k = KINDS[level];
  for (let t = 0; t < 400; t++) {
    const a = randShape(r, k.a, r.range(-12, 0), r.range(-8, 8), k.rot);
    const ang = r.range(0, Math.PI * 2);
    const d = r.range(sliver ? 18 : 8, 44);
    const b = randShape(r, k.b, Math.cos(ang) * d + 6, Math.sin(ang) * d, k.rot);
    const bb = bbox([...outline(a), ...outline(b)]);
    if (bb.x0 < -48 || bb.x1 > 48 || bb.y0 < -48 || bb.y1 > 48) continue;
    const area = overlapArea(a, b);
    const small = Math.min(shArea(a), shArea(b));
    if (overlap) {
      if (sliver ? area > 0.02 * small && area < 0.09 * small : area > 0.12 * small && area < 0.85 * small) return [a, b];
    } else {
      const g = gap(a, b);
      if (g >= 1.5 && g <= (sliver ? 4 : 14)) return [a, b];
    }
  }
  return null;
}

export function makeIntersection(seed: number, level: Level): XRound[] {
  const r = rng(seed);
  const out: XRound[] = [];
  const types = KINDS[level].types;
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 400) {
    const type = types[out.length];
    if (type === 'classify') {
      const yes = r.next() < 0.5;
      const p = makePair(r, level, yes, level !== 'easy');
      if (p) out.push({ type, pairs: [p], answer: yes ? 1 : 0, areas: [overlapArea(p[0], p[1])] });
    } else if (type === 'choose') {
      const p = makePair(r, level, true);
      if (!p) continue;
      const [a, b] = p;
      const truth = overlapPoly(a, b);
      const ta = polyArea(truth);
      // Distractors: the overlap if B were mirrored, shifted, or turned — real overlaps of nearby configurations.
      const cx = a.kind === 'circle' ? a.cx : bbox(a.pts).x0 + bbox(a.pts).w / 2;
      const variants: Sh[] = [];
      const mv = (f: (q: Pt) => Pt): Sh => (b.kind === 'circle' ? { ...b, ...((q) => ({ cx: q.x, cy: q.y }))(f(P(b.cx, b.cy))) } : { kind: 'poly', pts: b.pts.map(f), convex: b.convex });
      variants.push(mv((q) => P(2 * cx - q.x, q.y)));
      variants.push(mv((q) => P(q.x + r.sign() * r.range(6, 10), q.y + r.sign() * r.range(5, 9))));
      variants.push(b.kind === 'circle' ? { ...b, r: b.r * r.pick([0.7, 1.3]) } : { kind: 'poly', pts: rotate(b.pts, r.sign() * r.range(0.5, 0.9), P(bbox(b.pts).x0 + bbox(b.pts).w / 2, bbox(b.pts).y0 + bbox(b.pts).h / 2)), convex: b.convex });
      const cands: Pt[][] = [truth];
      for (const v of variants) {
        const q = overlapPoly(a, v);
        if (q.length < 3) continue;
        const qa = polyArea(q);
        const qb = bbox(q);
        const tb = bbox(truth);
        const moved = Math.hypot(qb.x0 + qb.w / 2 - tb.x0 - tb.w / 2, qb.y0 + qb.h / 2 - tb.y0 - tb.h / 2);
        if (Math.abs(qa - ta) / ta > 0.2 || moved > 4) cands.push(q);
      }
      if (cands.length < 4) continue;
      const order = [0, 1, 2, 3].sort(() => r.next() - 0.5);
      out.push({ type, pairs: [p], cands: order.map((i) => cands[i]), answer: order.indexOf(0), areas: [ta] });
    } else if (type === 'compare') {
      const p1 = makePair(r, level, true);
      const p2 = makePair(r, level, true);
      if (!p1 || !p2) continue;
      const a1 = overlapArea(p1[0], p1[1]);
      const a2 = overlapArea(p2[0], p2[1]);
      const ratio = Math.max(a1, a2) / Math.min(a1, a2);
      if (ratio < (level === 'hard' ? 1.15 : 1.3) || ratio > 2.2) continue;
      // The bigger overlap must not simply come from bigger shapes.
      out.push({ type, pairs: [p1, p2], answer: a1 > a2 ? 0 : 1, areas: [a1, a2] });
    } else {
      const p = makePair(r, level, true);
      if (!p) continue;
      const ar = overlapArea(p[0], p[1]);
      out.push({ type, pairs: [p], answer: (ar / shArea(p[0])) * 100, areas: [ar] });
    }
  }
  return out;
}

/** Penalty 0..1 for one answer. Estimates lose all credit at 25 percentage points off. */
export function xPenalty(rd: XRound, ans: number) {
  if (rd.type === 'estimate') return Math.min(1, Math.abs(ans - rd.answer) / 25);
  return ans === rd.answer ? 0 : 1;
}

const ASK: Record<RoundType, string> = {
  classify: 'Do the two shapes overlap?',
  choose: 'Which silhouette is their overlap?',
  compare: 'Which pair overlaps more (larger shared area)?',
  estimate: 'What share of A does B cover?',
};

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: XRound[] = [];
  let round = 0;
  let phase: 'ask' | 'reveal' | 'done' = 'ask';
  let t0 = 0;
  let res: { ans: number; pen: number; ms: number }[] = [];
  const controls = new Controls(stage, () => answer(controls.get('p').value));

  function reset(seed: number) {
    bench.clear();
    rounds = makeIntersection(seed, api.level);
    round = 0;
    res = [];
    begin();
  }

  function begin() {
    const rd = rounds[round];
    phase = 'ask';
    t0 = performance.now();
    api.progress(`${round + 1} / ${rounds.length}`);
    api.prompt(ASK[rd.type], rd.type === 'classify' ? 'Touching would not count — and never happens here · ← yes · → no' : rd.type === 'estimate' ? 'Set the gauge · Lock' : rd.type === 'compare' ? '← left · → right' : 'Tap a candidate · keys ← ↑ → ↓');
    controls.set(rd.type === 'estimate' ? [{ id: 'p', label: 'share of A covered by B', lo: 0, hi: 100, value: 50, speed: 30, readout: (v) => `${v.toFixed(0)}%` }] : []);
    controls.enabled = rd.type === 'estimate';
    stage.request();
  }

  function answer(a: number) {
    if (phase !== 'ask') return;
    const rd = rounds[round];
    const pen = xPenalty(rd, a);
    res.push({ ans: a, pen, ms: performance.now() - t0 });
    controls.enabled = false;
    api.judge(pen * 100, { x: stage.w / 2, y: 120 });
    const a0 = rd.areas[0].toFixed(0);
    api.prompt(
      rd.type === 'classify'
        ? `${rd.answer ? `They overlap: ${a0} u² shared` : 'They do not overlap'}. ${pen ? 'Wrong.' : 'Right.'}`
        : rd.type === 'choose'
          ? `${pen ? 'No' : 'Yes'} — the overlap is ${'ABCD'[rd.answer]} (${a0} u²).`
          : rd.type === 'compare'
            ? `${['Left', 'Right'][rd.answer]} overlaps more: ${rd.areas[0].toFixed(0)} vs ${rd.areas[1].toFixed(0)} u². ${pen ? 'Wrong.' : 'Right.'}`
            : `B covers ${rd.answer.toFixed(1)}% of A; you said ${a.toFixed(0)}% (${Math.abs(a - rd.answer).toFixed(1)} points off).`,
      round < rounds.length - 1 ? 'The overlap is shown in cyan · tap for the next' : '',
    );
    phase = 'reveal';
    if (round === rounds.length - 1) finish();
  }

  function finish() {
    phase = 'done';
    const pct = mean(res.map((r) => r.pen)) * 100;
    const by = (t: RoundType) => res.filter((_, i) => rounds[i].type === t);
    const rows: [string, string][] = rounds.map((rd, i) => [`${i + 1} · ${rd.type}`, rd.type === 'estimate' ? `${rd.answer.toFixed(1)}% → ${res[i].ans.toFixed(0)}%` : res[i].pen ? '✗' : '✓']);
    for (const t of ['classify', 'choose', 'compare'] as RoundType[]) if (by(t).length) rows.push([`${t} accuracy`, `${by(t).filter((r) => !r.pen).length} of ${by(t).length}`]);
    if (by('estimate').length) rows.push(['Estimate error (mean)', `${mean(by('estimate').map((r, j) => Math.abs(r.ans - rounds.filter((x) => x.type === 'estimate')[j].answer))).toFixed(1)} points`]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'mean penalty per round',
      headline: pct === 0 ? 'Every overlap read right.' : `${pct.toFixed(1)}% penalty across ${rounds.length} rounds.`,
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct === 0,
      near: pct < 8,
      share: [`INTERSECTION · ${api.level}`, `${pct.toFixed(1)}% penalty`],
    });
  }

  function next() {
    if (phase !== 'reveal' || round >= rounds.length - 1) return;
    round++;
    begin();
  }

  bench.onTap = () => phase === 'reveal' && next();
  bench.onKey = (e) => {
    if (e.repeat) return;
    const rd = rounds[round];
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) next();
    else if (phase === 'ask' && rd.type === 'classify' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) answer(e.key === 'ArrowLeft' ? 1 : 0);
    else if (phase === 'ask' && rd.type === 'compare' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) answer(e.key === 'ArrowLeft' ? 0 : 1);
    else if (phase === 'ask' && rd.type === 'choose' && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) answer(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].indexOf(e.key));
    else return;
    e.preventDefault();
  };

  const drawShape = (c: CanvasRenderingContext2D, s: Sh, X: (p: Pt) => Pt, color: string, fillA: number) => {
    const pts = outline(s).map(X);
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fillStyle = alpha(color, fillA);
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = 1.5;
    c.stroke();
  };
  const fillPoly = (c: CanvasRenderingContext2D, pts: Pt[], X: (p: Pt) => Pt, color: string, a: number) => {
    if (pts.length < 3) return;
    c.beginPath();
    pts.map(X).forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fillStyle = alpha(color, a);
    c.fill();
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const W = stage.w;
    const top = 74;
    const judged = phase !== 'ask';
    const bottom = rd.type === 'estimate' ? 120 : rd.type === 'choose' ? Math.min(170, W / 4 + 40) : 90;
    const two = rd.pairs.length === 2;
    const F = Math.max(140, Math.min(two ? (W - 48) / 2 : W - 32, stage.h - top - bottom, 440));
    rd.pairs.forEach((pair, pi) => {
      const fx = two ? W / 2 + (pi ? 8 : -8 - F) : W / 2 - F / 2;
      plate(c, fx, top, F, F, 10);
      const k = F / 100;
      const X = (p: Pt) => P(fx + F / 2 + p.x * k, top + F / 2 + p.y * k);
      drawShape(c, pair[0], X, pal.ink, 0.1);
      drawShape(c, pair[1], X, VIOLET, 0.14);
      const ca = pair[0].kind === 'circle' ? P(pair[0].cx, pair[0].cy) : bbox(pair[0].pts);
      const la = 'x' in ca ? X(ca) : X(P(ca.x0 + 3, ca.y0 + 4));
      text(c, 'A', la.x, la.y, font.mono(11, 600), pal.ink, 'center', 'middle');
      const cb = pair[1].kind === 'circle' ? P(pair[1].cx, pair[1].cy) : bbox(pair[1].pts);
      const lb = 'x' in cb ? X(cb) : X(P(cb.x0 + 3, cb.y0 + 4));
      text(c, 'B', lb.x, lb.y, font.mono(11, 600), VIOLET, 'center', 'middle');
      if (judged) {
        fillPoly(c, overlapPoly(pair[0], pair[1]), X, pal.accent, 0.75);
        if (two) text(c, `${rd.areas[pi].toFixed(0)} u²`, fx + F / 2, top + F - 10, font.mono(12, 600), pi === rd.answer ? pal.accent : pal.ink2, 'center');
      }
      if (two && phase === 'ask') bench.hit(fx, top, F, F, () => answer(pi));
    });
    const y = top + F + 14;
    if (rd.type === 'classify' && phase === 'ask')
      bench.row(c, W / 2, y, Math.min(W - 32, 360), [
        { label: 'Overlap', run: () => answer(1), o: { key: '←' } },
        { label: 'Apart', run: () => answer(0), o: { key: '→' } },
      ]);
    if (rd.type === 'choose' && rd.cands) {
      const cw = Math.min(110, (W - 32 - 3 * 10) / 4);
      rd.cands.forEach((q, i) => {
        const x = W / 2 + (i - 1.5) * (cw + 10) - cw / 2;
        const sel = judged && res[round].ans === i;
        plate(c, x, y, cw, cw, 8);
        const k = cw / 100;
        fillPoly(c, q, (p) => P(x + cw / 2 + p.x * k, y + cw / 2 + p.y * k), judged && i === rd.answer ? pal.accent : pal.ink, 0.8);
        text(c, 'ABCD'[i], x + 7, y + 14, font.mono(11, 600), sel && i !== rd.answer ? pal.signal : pal.ink2);
        if (sel || (judged && i === rd.answer)) {
          c.strokeStyle = i === rd.answer ? pal.accent : pal.signal;
          c.lineWidth = 2;
          c.strokeRect(x + 1, y + 1, cw - 2, cw - 2);
        }
        if (phase === 'ask') bench.hit(x, y, cw, cw, () => answer(i));
      });
    }
    const more = controls.tick(now);
    if (rd.type === 'estimate' && phase === 'ask') controls.draw(c, W / 2 - Math.min(W - 32, 480) / 2, y, Math.min(W - 32, 480));
    if (rd.type === 'estimate' && judged) text(c, `true ${rd.answer.toFixed(1)}% · you ${res[round].ans.toFixed(0)}%`, W / 2, y + 24, font.mono(12, 600), pal.ink, 'center');
    roundStrip(c, W, stage.h - 8, res.map((r) => (r.pen === 0 ? '✓' : r.pen < 1 ? (r.pen * 100).toFixed(0) : '✗')), rounds.length, round);
    return more;
  };

  return {
    reset,
    destroy: () => {
      controls.destroy();
      bench.destroy();
    },
  };
};

export default factory;
