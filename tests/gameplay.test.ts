// Progression (stars, tiers, unlocking, streak) and the variety modes (Exact mixed units, Zero weights,
// Mirror transforms, Draw shapes).
import { beforeEach, describe, expect, it } from 'vitest';
import { pushRun } from '../src/core/records';
import { bestStars, hardUnlocked, playStreak, starsFor, starThresholds, tierOf, totalStars } from '../src/core/progress';
import type { Level } from '../src/core/types';
import { byId, games, recId } from '../src/games/registry';
import { notate, notations, makeTargets } from '../src/games/exact';
import { coefLabel, makeWeights } from '../src/games/zero';
import { makeMirror, makeTransforms, rotateAbout } from '../src/games/mirror';
import { corners, makePolygon, outline, signedDist } from '../src/games/draw';

const LEVELS: Level[] = ['easy', 'medium', 'hard'];

describe('Stars and tiers', () => {
  const exact = byId('exact')!;
  it('every game has three strictly harder targets (smaller errors, or longer distances)', () => {
    for (const g of games) {
      expect(g.stars, g.id).toBeDefined();
      const [a, b, c] = g.better === 'higher' ? [...g.stars!].reverse() : g.stars!;
      expect(a, g.id).toBeGreaterThan(b);
      expect(b, g.id).toBeGreaterThan(c);
      expect(c, g.id).toBeGreaterThan(0);
    }
  });
  it('Easy asks for more than Medium, Hard forgives more (error scores)', () => {
    for (const g of games) {
      if (g.better === 'higher') continue; // distance games set their own per-level targets
      const e = starThresholds(g, 'easy')!;
      const m = starThresholds(g, 'medium')!;
      const h = starThresholds(g, 'hard')!;
      expect(e[0]).toBeLessThan(m[0]);
      expect(h[0]).toBeGreaterThan(m[0]);
    }
  });
  it('a score earns the stars whose targets it meets, at the displayed precision', () => {
    // Exact medium: 6 / 3 / 1.2 °
    expect(starsFor(exact, 'medium', 7)).toBe(0);
    expect(starsFor(exact, 'medium', 6)).toBe(1);
    expect(starsFor(exact, 'medium', 2.9)).toBe(2);
    expect(starsFor(exact, 'medium', 1.24)).toBe(3); // shown as 1.2
    expect(starsFor(exact, 'medium', null)).toBe(0);
  });
  it('round tiers follow the same targets; a zero at display precision is EXACT', () => {
    expect(tierOf(exact, 'medium', 0.04)).toBe('exact');
    expect(tierOf(exact, 'medium', 1)).toBe('excellent');
    expect(tierOf(exact, 'medium', 2.5)).toBe('great');
    expect(tierOf(exact, 'medium', 5)).toBe('good');
    expect(tierOf(exact, 'medium', 20)).toBe('off');
  });
});

describe('Unlocking and streaks (from stored records)', () => {
  beforeEach(() => localStorage.clear());
  it('Hard unlocks with ★ on Medium, and stays open for anyone who already played it', () => {
    const g = byId('exact')!;
    expect(hardUnlocked(g)).toBe(false);
    pushRun(recId('exact', 'medium'), 9, 'lower', { kind: 'ranked' });
    expect(hardUnlocked(g)).toBe(false);
    pushRun(recId('exact', 'medium'), 5.5, 'lower', { kind: 'ranked' });
    expect(hardUnlocked(g)).toBe(true);
    expect(bestStars(g, 'medium')).toBe(1);
    const z = byId('zero')!;
    pushRun(recId('zero', 'hard'), 1, 'lower', { kind: 'ranked' });
    expect(hardUnlocked(z)).toBe(true);
  });
  it('practice runs never earn stars', () => {
    pushRun(recId('plumb', 'medium'), 0.1, 'lower', { kind: 'practice' });
    expect(bestStars(byId('plumb')!, 'medium')).toBe(0);
    expect(totalStars().earned).toBe(0);
  });
  it('the streak counts consecutive days with a run', () => {
    const day = 86400000;
    const now = new Date(2026, 9, 14, 12).getTime();
    const key = 'eps:rec:zero';
    localStorage.setItem(key, JSON.stringify({ runs: [now - 2 * day, now - day, now].map((t) => ({ s: 0.1, t, k: 'ranked' })), n: 3, best: 0.1 }));
    expect(playStreak(new Date(now)).days).toBe(3);
    expect(playStreak(new Date(now + day)).days).toBe(3); // yesterday still counts until today ends
    expect(playStreak(new Date(now + 2 * day)).days).toBe(0);
  });
});

describe('Exact — mixed units', () => {
  it('converts notations to the exact angle they express', () => {
    expect(notate(135, 'turn')).toEqual({ label: '³⁄₈ turn', value: 135 });
    expect(notate(90, 'turn').value).toBe(90);
    const clock = notate(45, 'clock');
    expect(clock.label).toBe('1:30 hour hand');
    expect(clock.value).toBeCloseTo(45, 9);
    expect(notate(0, 'clock').label).toBe('12:00 hour hand');
    const rad = notate(180, 'rad');
    expect(rad.label).toBe('3.14 rad');
    expect(rad.value).toBeCloseTo((3.14 * 180) / Math.PI, 9);
    const odd = notate(211.7, 'turn');
    expect(odd.label).toBe('0.588 turn');
    expect(odd.value).toBeCloseTo(0.588 * 360, 9);
  });
  it('Degrees mode is unchanged; Mixed uses several notations per run', () => {
    for (const l of LEVELS) {
      expect(new Set(notations(l, 5, false))).toEqual(new Set(['deg']));
      expect(new Set(notations(l, makeTargets(1, l).length, true)).size).toBeGreaterThan(1);
    }
    for (const s of [1, 2, 3, 99])
      for (const l of LEVELS) {
        const t = makeTargets(s, l);
        notations(l, t.length).forEach((k, i) => {
          const n = notate(t[i], k);
          // A notation never moves the target far (a clock rounded to 2 min is at most ½°; the score uses n.value).
          expect(Math.abs(n.value - t[i])).toBeLessThanOrEqual(0.5 + 1e-9);
        });
      }
  });
});

describe('Zero — weighted holds', () => {
  it('signs alternate, at least one weight is not 1, and runs replay from the seed', () => {
    for (const l of LEVELS)
      for (let s = 1; s < 80; s++) {
        const w = makeWeights(s, l);
        expect(makeWeights(s, l)).toEqual(w);
        expect(w).toHaveLength(l === 'easy' ? 2 : l === 'hard' ? 6 : 4);
        w.forEach((x, i) => expect(Math.sign(x)).toBe(i % 2 === 0 ? 1 : -1));
        expect(w.some((x) => Math.abs(x) !== 1)).toBe(true);
      }
    expect(coefLabel(2)).toBe('+×2');
    expect(coefLabel(-0.5)).toBe('−×½');
    expect(coefLabel(-1)).toBe('−');
  });
});

describe('Mirror — transforms', () => {
  it('rotations keep the distance to the centre; quarter turns are exact', () => {
    const q = rotateAbout({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(q.x).toBeCloseTo(0, 9);
    expect(q.y).toBeCloseTo(10, 9); // clockwise on screen (y down)
    for (const l of LEVELS)
      for (let s = 1; s < 40; s++) {
        const rounds = makeTransforms(s, l);
        expect(rounds).toHaveLength(makeMirror(s, l).length);
        for (const rd of rounds) {
          expect(Math.abs(rd.image.x)).toBeLessThanOrEqual(42);
          expect(Math.abs(rd.image.y)).toBeLessThanOrEqual(42);
          if (rd.rot) {
            const r0 = Math.hypot(rd.p.x - rd.rot.c.x, rd.p.y - rd.rot.c.y);
            const r1 = Math.hypot(rd.image.x - rd.rot.c.x, rd.image.y - rd.rot.c.y);
            expect(r1).toBeCloseTo(r0, 9);
          }
        }
        expect(rounds.some((r) => r.rot)).toBe(true);
      }
  });
});

describe('Draw — shapes', () => {
  it('a polygon outline lies on its edges; the inside is negative', () => {
    for (const l of LEVELS)
      for (let s = 1; s < 30; s++) {
        const p = makePolygon(s, l);
        expect([3, 4]).toContain(p.sides);
        const ol = outline(p);
        for (const q of ol.slice(0, 50)) expect(Math.abs(signedDist(q, p, ol))).toBeLessThan(1e-9);
        expect(signedDist({ x: p.x, y: p.y }, p, ol)).toBeLessThan(0);
        expect(signedDist({ x: p.x + 200, y: p.y }, p, ol)).toBeGreaterThan(0);
        for (const c of corners(p)) {
          expect(Math.abs(c.x)).toBeLessThan(50);
          expect(Math.abs(c.y)).toBeLessThan(50);
        }
      }
  });
});

describe('Next star goal', () => {
  it('points at the next threshold, not the last one', async () => {
    const { nextStar } = await import('../src/core/progress');
    const g = byId('loop')!; // medium 6 / 3 / 1.2
    expect(nextStar(g, 'medium', null)).toEqual({ have: 0, at: 6 });
    expect(nextStar(g, 'medium', 9.7)).toEqual({ have: 0, at: 6 });
    expect(nextStar(g, 'medium', 5)).toEqual({ have: 1, at: 3 });
    expect(nextStar(g, 'medium', 2)).toEqual({ have: 2, at: 1.2 });
    expect(nextStar(g, 'medium', 1)).toEqual({ have: 3, at: null });
  });
});
