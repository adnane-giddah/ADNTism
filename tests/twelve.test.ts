import { describe, expect, it } from 'vitest';
import { LEVELS as LV } from '../src/core/types';
import { densityAnswer, insideRegion, makeDensity, regionArea } from '../src/games/density';
import { makeArea } from '../src/games/area';
import { judgeRecall, makeDistractors, makeSequence, nextLength, TRACE } from '../src/games/trace';
import { deduce, decisive, feasible, makeWeigh, possible, witness, type Scale } from '../src/games/weigh';
import { gap, makeIntersection, overlapArea, xPenalty, type Sh } from '../src/games/intersection';
import { makeCount, makeCounts } from '../src/games/count';
import { BASE, consistent, DOMAIN, greedyDepth, hypPenalty, makeHypothesis } from '../src/games/hypothesis';
import { canonRot, chiral, makeRotate, mirror, sameByRotation, type Cells } from '../src/games/rotate';
import { crossTime, interceptError, makeIntercept, pos } from '../src/games/intercept';
import { makeLength, pathLength, segLength } from '../src/games/length';
import { balancedError, makeFilter, RULES, scoreBlock, targets, type Ev } from '../src/games/filter';
import { pairScore, Ranker, trueOrder } from '../src/games/kit';
import { clipConvex, integrate, lensArea as lensArea_, P, polyArea, regular } from '../src/games/geom';
import { byId } from '../src/games/registry';

const NEW = ['density', 'area', 'trace', 'weigh', 'intersection', 'count', 'hypothesis', 'rotate', 'intercept', 'length', 'filter', 'fpath'];

describe('registry', () => {
  it('registers all twelve with unique ids and loaders', () => {
    for (const id of NEW) {
      const g = byId(id)!;
      expect(g, id).toBeDefined();
      expect(g.stars, id).toBeDefined();
      expect(typeof g.load).toBe('function');
    }
  });
});

describe('ranking scores', () => {
  it('counts discordant pairs and ignores ties', () => {
    expect(pairScore([0, 1, 2], [3, 2, 1]).exact).toBe(true);
    expect(pairScore([2, 1, 0], [3, 2, 1]).frac).toBe(1);
    // Ends right, middle swapped: not full credit.
    const s = pairScore([0, 2, 1, 3], [4, 3, 2, 1]);
    expect(s.exact).toBe(false);
    expect(s.wrong).toBe(1);
    // A tie may go either way.
    expect(pairScore([1, 0, 2], [2, 2, 1]).exact).toBe(true);
    expect(trueOrder([1, 3, 2])).toEqual([1, 2, 0]);
  });
  it('tap-to-rank fills the last place and undoes cleanly', () => {
    const r = new Ranker(3);
    r.toggle(2);
    r.toggle(0);
    expect(r.order).toEqual([2, 0, 1]);
    r.undo();
    expect(r.order).toEqual([2]);
    r.toggle(2);
    expect(r.order).toEqual([]);
  });
});

describe('geometry', () => {
  it('areas, clipping and lens areas are exact', () => {
    expect(polyArea([P(0, 0), P(4, 0), P(4, 3)])).toBe(6);
    expect(polyArea(regular(6, 1))).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12);
    const sq = [P(0, 0), P(2, 0), P(2, 2), P(0, 2)];
    expect(polyArea(clipConvex(sq, [P(1, 1), P(3, 1), P(3, 3), P(1, 3)]))).toBeCloseTo(1, 12);
    // Concave L clipped by a square.
    const L = [P(0, 0), P(4, 0), P(4, 1), P(1, 1), P(1, 4), P(0, 4)];
    expect(polyArea(clipConvex(L, [P(0, 0), P(2, 0), P(2, 2), P(0, 2)]))).toBeCloseTo(3, 12);
    expect(lensArea_(1, 1, 2)).toBe(0); // tangent
    expect(lensArea_(2, 1, 0.5)).toBeCloseTo(Math.PI, 12); // contained
    expect(lensArea_(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 12);
    expect(integrate((x) => Math.sqrt(1 + Math.cos(x) ** 2), 0, Math.PI)).toBeCloseTo(3.820197789027712, 9);
  });
});

describe('density', () => {
  it('computes answers from the generated data; dots never overlap and stay inside', () => {
    for (const lv of LV)
      for (const rd of makeDensity(7, lv)) {
        expect(rd.answer).toBe(densityAnswer(rd.f[0], rd.f[1]));
        for (const f of rd.f) {
          expect(f.area).toBeCloseTo(regionArea(f.region), 9);
          expect(f.dots.length).toBe(f.n);
          for (const p of f.dots) expect(insideRegion(f.region, p, f.s)).toBe(true);
          for (let i = 0; i < f.dots.length; i++) for (let j = i + 1; j < f.dots.length; j++) expect(Math.hypot(f.dots[i].x - f.dots[j].x, f.dots[i].y - f.dots[j].y)).toBeGreaterThan(2 * f.s);
        }
      }
    const med = makeDensity(3, 'medium');
    expect(med.filter((r) => r.answer === 2).length).toBe(1);
    expect(JSON.stringify(makeDensity(3, 'hard'))).toBe(JSON.stringify(makeDensity(3, 'hard')));
  });
});

describe('area', () => {
  it('builds shapes of exact target area with real gaps', () => {
    for (const lv of LV)
      for (const rd of makeArea(11, lv)) {
        const a = rd.shapes.map((s) => s.area).sort((p, q) => p - q);
        for (let i = 1; i < a.length; i++) expect(a[i] / a[i - 1]).toBeGreaterThan(1.03);
        for (const s of rd.shapes) if (!['circle', 'ellipse', 'stadium'].includes(s.kind)) expect(polyArea(s.pts)).toBeCloseTo(s.area, 6);
      }
  });
});

describe('trace', () => {
  it('generates valid sequences and judges recall', () => {
    for (const lv of LV) {
      const cfg = TRACE[lv];
      for (const len of [cfg.start, cfg.start + 6]) {
        const s = makeSequence(5, cfg, len);
        expect(s.length).toBe(len);
        for (let i = 1; i < s.length; i++) expect(s[i]).not.toBe(s[i - 1]);
        for (const d of makeDistractors(5, cfg, s)) expect(d.cell).toBeLessThan(cfg.n * cfg.n);
      }
    }
    expect(judgeRecall([1, 2, 3], [1, 2, 3]).exact).toBe(true);
    expect(judgeRecall([1, 2, 3], [1, 5]).prefix).toBe(1);
    expect(judgeRecall([4, 1, 4], [4, 1, 4]).exact).toBe(true); // repeated cell
    expect(nextLength(4, true, 1)).toEqual({ len: 5, fails: 0, over: false });
    expect(nextLength(4, false, 1).over).toBe(true);
  });
});

describe('weigh', () => {
  const S = (L: number[], out: '>' | '=' | '<', R: number[]): Scale => ({ L, R, out });
  it('deduces exactly, including what cannot be deduced', () => {
    // A > B, B > C ⇒ A > C.
    expect(deduce([S([0], '>', [1]), S([1], '>', [2])], 3, 0, 2)).toBe('>');
    // A + B = C ⇒ C > A for positive weights.
    expect(deduce([S([0, 1], '=', [2])], 3, 2, 0)).toBe('>');
    // A > B, C > B says nothing about A vs C.
    expect(deduce([S([0], '>', [1]), S([2], '>', [1])], 3, 0, 2)).toBeNull();
    expect(possible([S([0], '>', [1]), S([2], '>', [1])], 3, 0, 2).sort()).toEqual(['<', '=', '>']);
    // Contradictions are infeasible.
    expect(feasible([{ c: [1, -1], strict: true }, { c: [-1, 1], strict: true }], 2)).toBe(false);
    // A + B > C + D, C > A, D > B is impossible.
    expect(feasible([{ c: [1, 1, -1, -1], strict: true }, { c: [-1, 0, 1, 0], strict: true }, { c: [0, -1, 0, 1], strict: true }], 4)).toBe(false);
  });
  it('generates consistent puzzles whose answers match the hidden weights', () => {
    for (const lv of LV)
      for (const rd of makeWeigh(21, lv)) {
        for (const s of rd.scales) {
          const d = s.L.reduce((a, i) => a + rd.w[i], 0) - s.R.reduce((a, i) => a + rd.w[i], 0);
          expect(s.out).toBe(d > 0 ? '>' : d < 0 ? '<' : '=');
        }
        if (rd.q.kind === 'pair') {
          const t = rd.w[rd.q.a] - rd.w[rd.q.b];
          if (rd.q.answer) expect(rd.q.answer).toBe(t > 0 ? '>' : t < 0 ? '<' : '=');
          else {
            const ps = possible(rd.scales, rd.n, rd.q.a, rd.q.b);
            expect(ps.length).toBeGreaterThan(1);
          }
          if (rd.q.answer) expect(deduce(decisive(rd.scales, rd.n, rd.q.a, rd.q.b).map((i) => rd.scales[i]), rd.n, rd.q.a, rd.q.b)).toBe(rd.q.answer);
        }
      }
    expect(witness([S([0], '>', [1]), S([2], '>', [1])], 3, 0, 2, '<')).not.toBeNull();
  });
});

describe('intersection', () => {
  const C = (cx: number, cy: number, r: number): Sh => ({ kind: 'circle', cx, cy, r });
  it('classifies separate, tangent, partial and contained circles', () => {
    expect(overlapArea(C(0, 0, 1), C(3, 0, 1))).toBe(0);
    expect(overlapArea(C(0, 0, 1), C(2, 0, 1))).toBe(0);
    expect(overlapArea(C(0, 0, 3), C(0.5, 0, 1))).toBeCloseTo(Math.PI, 12);
    expect(gap(C(0, 0, 1), C(3, 0, 1))).toBeCloseTo(1, 12);
  });
  it('circle–polygon overlap matches the analytic value closely', () => {
    const half: Sh = { kind: 'poly', pts: [P(0, -5), P(5, -5), P(5, 5), P(0, 5)], convex: true };
    expect(overlapArea(C(0, 0, 2), half)).toBeCloseTo(2 * Math.PI, 3);
  });
  it('generates rounds whose answers come from geometry', () => {
    for (const lv of LV)
      for (const rd of makeIntersection(5, lv)) {
        if (rd.type === 'classify') expect(rd.answer).toBe(overlapArea(rd.pairs[0][0], rd.pairs[0][1]) > 0 ? 1 : 0);
        if (rd.type === 'compare') expect(rd.answer).toBe(rd.areas[0] > rd.areas[1] ? 0 : 1);
        if (rd.type === 'choose') expect(polyArea(rd.cands![rd.answer])).toBeCloseTo(rd.areas[0], 6);
        if (rd.type === 'estimate') {
          expect(xPenalty(rd, rd.answer)).toBe(0);
          expect(xPenalty(rd, rd.answer + 30)).toBe(1);
        }
      }
  });
});

describe('count', () => {
  it('boards hold exactly the generated counts', () => {
    expect(makeCounts(56, 4, [1, 2], Math.random, true).reduce((a, b) => a + b, 0)).toBe(56);
    for (const lv of LV)
      for (const rd of makeCount(9, lv)) {
        expect(rd.cells.length).toBe(rd.rows * rd.cols);
        rd.counts.forEach((n, c) => expect(rd.cells.filter((x) => x === c).length).toBe(n));
        const s = [...rd.counts].sort((a, b) => b - a);
        expect(s[0] - s[s.length - 1]).toBeLessThanOrEqual(lv === 'easy' ? 12 : 8);
      }
  });
});

describe('hypothesis', () => {
  it('tracks consistent rules and keeps rounds solvable', () => {
    const even = BASE.find((r) => r.id === 'even')!;
    const m4 = BASE.find((r) => r.id === 'm4')!;
    expect(consistent([even, m4], [{ n: 12, yes: true }]).length).toBe(2);
    expect(consistent([even, m4], [{ n: 14, yes: true }])).toEqual([even]);
    for (const lv of LV)
      for (const rd of makeHypothesis(31, lv)) {
        const sigs = new Set(rd.cands.map((c) => DOMAIN.map((n) => +c.f(n)).join('')));
        expect(sigs.size).toBe(rd.cands.length);
        expect(greedyDepth(rd.cands)).toBeLessThanOrEqual(rd.budget);
      }
  });
  it('penalises lucky guesses and redundant tests', () => {
    const even = BASE.find((r) => r.id === 'even')!;
    const m4 = BASE.find((r) => r.id === 'm4')!;
    const rd = { cands: [even, m4], hidden: 0, budget: 3 };
    expect(hypPenalty(rd, [{ n: 14, yes: true }], 0).pen).toBe(0);
    expect(hypPenalty(rd, [{ n: 12, yes: true }], 0).pen).toBe(0.6); // lucky (½) + one redundant test (0.1)
    expect(hypPenalty(rd, [{ n: 14, yes: true }], 1).pen).toBe(1);
  });
});

describe('rotate', () => {
  it('distinguishes rotation from reflection exactly', () => {
    const L: Cells = [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [2, 3],
    ];
    expect(chiral(L)).toBe(true);
    expect(sameByRotation(L, mirror(L))).toBe(false);
    const T: Cells = [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ];
    expect(chiral(T)).toBe(false);
    for (const lv of LV)
      for (const rd of makeRotate(4, lv)) {
        rd.cands.forEach((c, i) => expect(sameByRotation(c, rd.ref)).toBe(i === rd.answer));
        expect(new Set(rd.cands.map(canonRot)).size).toBe(rd.cands.length);
      }
  });
});

describe('intercept', () => {
  it('solves crossing times analytically', () => {
    expect(crossTime(10, 0, 50)).toBe(5);
    expect(crossTime(0, 2, 16)).toBeCloseTo(4, 12);
    expect(crossTime(10, -2, 100)).toBeNaN(); // stops at 25
    expect(crossTime(20, -10, 15, true)).toBeCloseTo(3, 12); // falls back through 15
    for (const lv of LV)
      for (const tr of makeIntercept(8, lv)) {
        expect(pos(tr, tr.tCross)).toBeCloseTo(tr.target, 9);
        expect(tr.screen).toBeLessThan(tr.target);
      }
    const tr = makeIntercept(8, 'easy')[0];
    expect(interceptError(tr, tr.tCross - 0.05)).toBeCloseTo(-50, 6);
    expect(interceptError(tr, null)).toBe(800);
  });
});

describe('length', () => {
  it('uses true arc length, never endpoint distance', () => {
    expect(segLength({ t: 'arc', c: P(0, 0), r: 2, a0: 0, a1: Math.PI })).toBeCloseTo(2 * Math.PI, 12);
    const sine = { t: 'sine' as const, a: P(0, 0), len: Math.PI, amp: 1, k: 1, ang: 0 };
    expect(segLength(sine)).toBeCloseTo(3.820197789027712, 8);
    // A straight cubic Bézier with evenly spaced controls is exactly its chord.
    expect(segLength({ t: 'bez', p: [P(0, 0), P(1, 0), P(2, 0), P(3, 0)] })).toBeCloseTo(3, 9);
    for (const lv of LV)
      for (const ps of makeLength(6, lv)) {
        const L = ps.map((p) => pathLength(p.segs));
        ps.forEach((p, i) => expect(p.length).toBeCloseTo(L[i], 9));
        const s = [...L].sort((a, b) => a - b);
        for (let i = 1; i < s.length; i++) expect(s[i] / s[i - 1]).toBeGreaterThan(1.03);
      }
  });
});

describe('filter', () => {
  const ev = (shape: Ev['shape'], color: Ev['color']): Ev => ({ shape, color, big: false, side: 0 });
  it('sequential rules look exactly one event back', () => {
    const h = [ev('triangle', 'white'), ev('square', 'amber'), ev('circle', 'cyan')];
    expect(RULES.afterTri.test(h, 2)).toBe(false); // the triangle was two back
    const h2 = [ev('square', 'amber'), ev('triangle', 'white'), ev('circle', 'cyan')];
    expect(RULES.afterTri.test(h2, 2)).toBe(true);
  });
  it('scores detection and inhibition together', () => {
    const tgt = [false, true, false, true];
    const on = [0, 1000, 2000, 3000];
    const all = scoreBlock(on, 1000, tgt, [500, 1500, 2500, 3500]);
    const none = scoreBlock(on, 1000, tgt, []);
    const good = scoreBlock(on, 1000, tgt, [1400, 3300, 3400]);
    expect(balancedError(all)).toBe(50);
    expect(balancedError(none)).toBe(50);
    expect(balancedError(good)).toBe(0);
    expect(good.rts).toEqual([400, 300]);
    // A press within 120 ms of an onset belongs to the previous event.
    expect(scoreBlock(on, 1000, tgt, [1050]).fa).toBe(1);
  });
  it('generated blocks contain targets and near-misses', () => {
    for (const lv of LV)
      for (const b of makeFilter(13, lv)) {
        const t = targets(b);
        const n = t.filter(Boolean).length;
        expect(n).toBeGreaterThan(b.events.length * 0.12);
        expect(n).toBeLessThan(b.events.length * 0.5);
      }
  });
});
