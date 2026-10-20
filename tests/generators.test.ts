// Seed reproducibility and feasibility of every generated condition.
import { describe, expect, it } from 'vitest';
import { rng } from '../src/core/rng';
import { BALANCE_MAX_X, BALANCE_MIN_X, fieldToPad, stoppingDistance } from '../src/core/scoring';
import type { Level } from '../src/core/types';
import { makeBalance } from '../src/games/balance';
import { makeCenter } from '../src/games/center';
import { makeShape } from '../src/games/draw';
import { force, makeDrift } from '../src/games/drift';
import { makePattern } from '../src/games/echo';
import { makeTargets } from '../src/games/exact';
import { makeRounds } from '../src/games/loop';
import { makeStop } from '../src/games/stop';
import { DAILY_POOL, dailyGame, dailySeed, games } from '../src/games/registry';

const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const SEEDS = Array.from({ length: 400 }, (_, i) => (rng(i + 1).next() * 0xffffffff) >>> 0);

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('every generator is reproducible from its seed', () => {
  const gens: [string, (s: number, l: Level) => unknown][] = [
    ['exact', makeTargets],
    ['loop', makeRounds],
    ['draw', makeShape],
    ['stop', makeStop],
    ['balance', makeBalance],
    ['drift', makeDrift],
    ['echo', makePattern],
    ['center', makeCenter],
  ];
  for (const [name, gen] of gens)
    it(name, () => {
      for (const l of LEVELS) for (const s of SEEDS.slice(0, 50)) expect(gen(s, l)).toEqual(gen(s, l));
    });
});

describe('Balance feasibility', () => {
  it('balance point is always reachable and away from the pivot', () => {
    for (const l of LEVELS)
      for (const s of SEEDS) {
        const { xStar, mysteries } = makeBalance(s, l);
        expect(xStar).toBeGreaterThan(BALANCE_MIN_X);
        expect(xStar).toBeLessThan(BALANCE_MAX_X);
        expect(Number.isFinite(xStar)).toBe(true);
        const n = mysteries.length;
        if (l === 'easy') expect(n).toBe(1);
        if (l === 'hard') expect(n).toBeGreaterThanOrEqual(2);
      }
  });
});

describe('Exact targets', () => {
  it('have the right count and range per level', () => {
    for (const s of SEEDS) {
      expect(makeTargets(s, 'easy')).toHaveLength(5);
      expect(makeTargets(s, 'medium')).toHaveLength(5);
      const hard = makeTargets(s, 'hard');
      expect(hard).toHaveLength(7);
      for (const t of hard) {
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(360);
        expect(Math.abs(t - Math.round(t))).toBeGreaterThan(0.05); // every Hard target has a decimal
      }
    }
  });
});

describe('Close the Loop feasibility', () => {
  it('every closing arrow fits on its pad', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 120)) {
        for (const rd of makeRounds(s, l)) {
          const end = rd.vecs.reduce((p, v) => ({ x: p.x + v.x, y: p.y + v.y }), { x: 0, y: 0 });
          const need = fieldToPad({ x: -end.x, y: -end.y }, rd);
          expect(Math.hypot(need.x, need.y)).toBeLessThan(50); // pad half-width is 50 u
        }
      }
  });
});

describe('Stop feasibility', () => {
  it('one clean brake from launch can stop on the line', () => {
    for (const l of LEVELS)
      for (const s of SEEDS) {
        const { A, v0, target } = makeStop(s, l);
        expect(stoppingDistance(v0, A)).toBeLessThan(target);
        expect(target).toBeLessThan(100);
      }
  });
});

describe('Draw shapes', () => {
  it('fit inside the 100 u field', () => {
    for (const l of LEVELS)
      for (const s of SEEDS) {
        const sh = makeShape(s, l);
        expect(Math.abs(sh.x) + Math.max(sh.a, sh.b)).toBeLessThan(50);
        expect(Math.abs(sh.y) + Math.max(sh.a, sh.b)).toBeLessThan(50);
        if (l === 'hard') expect(sh.b).toBeLessThan(sh.a);
      }
  });
});

describe('Drift', () => {
  it('has the documented number of sudden changes and a finite force', () => {
    const want = { easy: 0, medium: 2, hard: 4 };
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 100)) {
        const d = makeDrift(s, l);
        expect(d.steps).toHaveLength(want[l]);
        for (let t = 0; t <= 25; t += 0.5) expect(Number.isFinite(force(d, t))).toBe(true);
      }
  });
});

describe('Echo patterns', () => {
  it('have the documented length and bounds', () => {
    for (const s of SEEDS) {
      expect(makePattern(s, 'easy')).toHaveLength(3);
      expect(makePattern(s, 'medium')).toHaveLength(4);
      const hard = makePattern(s, 'hard');
      expect(hard).toHaveLength(8);
      const total = hard.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(4600);
      expect(Math.min(...hard)).toBeGreaterThanOrEqual(90);
    }
  });
});

describe('Center feasibility', () => {
  it('leaves room for a point outside the ring in every direction', () => {
    for (const l of LEVELS)
      for (const s of SEEDS) {
        const { T, EXCL, W } = makeCenter(s, l);
        expect(Math.abs(T.x) + EXCL).toBeLessThan(50);
        expect(Math.abs(T.y) + EXCL).toBeLessThan(50);
        expect(W.every((w) => w > 0)).toBe(true);
      }
  });
});

describe('Daily experiment', () => {
  it('is the same game and seed for the same date', () => {
    const d = new Date(2026, 9, 11);
    expect(dailyGame(d).id).toBe(dailyGame(new Date(2026, 9, 11, 23, 59)).id);
    expect(dailySeed(d)).toBe(dailySeed(new Date(2026, 9, 11, 6)));
    expect(dailySeed(d)).not.toBe(dailySeed(new Date(2026, 9, 12)));
  });
  it('cycles through the whole (frozen) daily pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < DAILY_POOL.length; i++) seen.add(dailyGame(new Date(2026, 0, 1 + i)).id);
    expect(seen.size).toBe(DAILY_POOL.length);
  });
  it('keeps the original v1 selection (adding games must not change it)', () => {
    // Day 1 = 2026-01-01 → index 4 = stop; day 2 → index 8 = center; day 3 → index 3 = draw.
    expect(dailyGame(new Date(2026, 0, 1)).id).toBe('stop');
    expect(dailyGame(new Date(2026, 0, 2)).id).toBe('center');
    expect(dailyGame(new Date(2026, 0, 3)).id).toBe('draw');
    expect(games.length).toBeGreaterThanOrEqual(DAILY_POOL.length);
  });
});
