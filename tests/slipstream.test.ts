// Slipstream: a fair, deterministic course; clearance and grazes in radians; higher-is-better stars and records.
import { beforeEach, describe, expect, it } from 'vitest';
import { BOOST_MAX, CFG, clearance, freeIntervals, gapAt, gearAt, makeCourse, norm, PW, ring, rowClearance, speedAt, type Row } from '../src/games/slipstream';
import { byId } from '../src/games/registry';
import { nextStar, starsFor } from '../src/core/progress';
import { importAll, pushRun, stats } from '../src/core/records';

const TAU = Math.PI * 2;
const LEVELS = ['easy', 'medium', 'hard'] as const;
const angDist = (a: number, b: number) => Math.abs(norm(a - b + Math.PI) - Math.PI);
const free = (row: Row, min = 0) => Array.from({ length: 360 }, (_, k) => (k / 360) * TAU).filter((a) => rowClearance(row, a) >= min);

describe('slipstream course', () => {
  it('is the same for the same seed and level', () => {
    const a = makeCourse(42, 'medium');
    const b = makeCourse(42, 'medium');
    while (a.st.z < 6000) a.next();
    while (b.st.z < 6000) b.next();
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
    const c = makeCourse(43, 'medium');
    while (c.st.z < 6000) c.next();
    expect(JSON.stringify(c.rows)).not.toBe(JSON.stringify(a.rows));
  });

  it('keeps rows in order and leaves room for the ship in every one', () => {
    for (const level of LEVELS)
      for (let seed = 1; seed <= 12; seed++) {
        const c = makeCourse(seed, level);
        while (c.st.z < 10000) c.next();
        expect(c.rows[0].z).toBeGreaterThanOrEqual(60);
        for (let i = 1; i < c.rows.length; i++) expect(c.rows[i].z).toBeGreaterThanOrEqual(c.rows[i - 1].z);
        for (const row of c.rows) {
          for (const a of row.arcs) expect(a.w).toBeGreaterThan(0);
          // Somewhere the ship fits with at least 0.05 rad to spare.
          expect(free(row, 0.05).length).toBeGreaterThan(0);
        }
      }
  });

  it('never asks for a turn faster than the ship can make, even at full slipstream', () => {
    for (const level of LEVELS)
      for (let seed = 1; seed <= 12; seed++) {
        const c = makeCourse(seed, level);
        while (c.st.z < 9000) c.next();
        for (let i = 0; i + 1 < c.rows.length; i++) {
          const A = c.rows[i];
          const B = c.rows[i + 1];
          // Rotors move their own gaps and slalom lanes are walled; both are checked by construction.
          if (A.kind === 'slalom' || B.kind === 'slalom' || [...A.arcs, ...B.arcs].some((a) => a.rot)) continue;
          const dt = (B.z - A.z) / (speedAt(level, A.z) * (1 + BOOST_MAX)); // at full slipstream
          const reach = CFG[level].omega * dt + 1e-9;
          const fb = free(B);
          for (const a of free(A)) expect(fb.some((b) => angDist(a, b) <= reach)).toBe(true);
        }
      }
  });

  it('introduces patterns by gear: easy openers first, slalom lanes only from gear 4', () => {
    const c = makeCourse(7, 'medium');
    while (c.st.z < 20000) c.next();
    for (const row of c.rows) {
      const gear = gearAt('medium', row.z);
      if (row.kind === 'slalom') expect(gear).toBeGreaterThanOrEqual(4);
      if (row.kind === 'spiral' || row.kind === 'rotor') expect(gear).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(c.rows.map((r) => r.kind)).size).toBeGreaterThanOrEqual(6);
  });
});

describe('slipstream geometry', () => {
  it('measures clearance in radians; any overlap is a hit', () => {
    const row: Row = { z: 0, len: 1, arcs: ring([0], 1), kind: 'gate' };
    expect(rowClearance(row, 0)).toBeCloseTo(0.5 - PW, 9);
    expect(rowClearance(row, 0.5 - PW)).toBeCloseTo(0, 9);
    expect(rowClearance(row, 0.45)).toBeLessThan(0); // a wing overlaps the edge
    expect(rowClearance(row, Math.PI)).toBeLessThan(0);
    expect(rowClearance(row, TAU)).toBeCloseTo(rowClearance(row, 0), 9);
  });
  it('turns rotors with time', () => {
    const arc = { a: 0, w: 1, rot: 2 };
    expect(clearance(arc, 0.5, 0)).toBeLessThan(0);
    expect(clearance(arc, 0.5, 1)).toBeGreaterThan(0); // after 1 s it has turned 2 rad away
  });
  it('speeds up by gear and keeps every gap far wider than the ship', () => {
    expect(gearAt('medium', 0)).toBe(1);
    expect(gearAt('hard', 0)).toBe(2);
    expect(gearAt('medium', 1e7)).toBe(9);
    expect(speedAt('medium', 4000)).toBeGreaterThan(speedAt('medium', 0) * 1.5);
    for (const l of LEVELS) for (let g = 1; g <= 9; g++) expect(gapAt(l, g)).toBeGreaterThan(2 * PW + 0.35);
  });
  it('doors are open far away and close to their real size as they arrive', () => {
    const row: Row = { z: 0, len: 1.6, arcs: ring([0], 1).map((a) => ({ ...a, grow: 0.55 })), kind: 'doors' };
    const width = (d: number) => freeIntervals(row, 0, d).reduce((sum, [a, b]) => sum + (b - a), 0);
    expect(width(0)).toBeCloseTo(1, 6);
    expect(width(100)).toBeCloseTo(2.1, 6);
    expect(width(22.5)).toBeGreaterThan(width(0));
    // Collisions are judged where the door will be on arrival (d = 0).
    expect(rowClearance(row, 0.8)).toBeLessThan(0);
    expect(rowClearance(row, 0.8, 0, 100)).toBeGreaterThan(0);
  });
  it('lists the empty stretches of a row', () => {
    const row: Row = { z: 0, len: 1, arcs: ring([1, 1 + Math.PI], 0.8), kind: 'twin' };
    const free2 = freeIntervals(row, 0, 0);
    expect(free2).toHaveLength(2);
    for (const [a, b] of free2) expect(b - a).toBeCloseTo(0.8, 6);
  });
});

describe('slipstream pacing', () => {
  it('opens with four wide, slow gates — the first one never behind the ship', () => {
    for (const level of LEVELS)
      for (let seed = 1; seed <= 20; seed++) {
        const c = makeCourse(seed, level);
        while (c.rows.length < 6) c.next();
        const warm = c.rows.slice(0, 4);
        warm.forEach((row) => expect(row.kind).toBe('gate'));
        for (const row of warm) expect(TAU - row.arcs[0].w).toBeGreaterThanOrEqual(gapAt(level, 1) - 1e-9);
        const firstGap = norm(row0Center(warm[0]));
        expect(Math.min(firstGap, TAU - firstGap)).toBeLessThanOrEqual(1.2 + 1e-9);
        for (let i = 1; i < 4; i++) expect(warm[i].z - warm[i - 1].z).toBeGreaterThan(speedAt(level, warm[i - 1].z) * 1.05);
      }
  });
  it('clears the tube before each gear change', () => {
    for (const level of LEVELS) {
      const c = makeCourse(5, level);
      while (c.st.z < 8000) c.next();
      const gd = CFG[level].gearDist;
      for (const row of c.rows.slice(4)) {
        if (gearAt(level, row.z) >= 9) continue;
        const toShift = gd - (row.z % gd);
        // Nothing starts in the last ~1.3 s before a shift (patterns may run on for a moment).
        if (row.kind === 'gate' || row.kind === 'twin' || row.kind === 'doors' || row.kind === 'blades') expect(toShift).toBeGreaterThan(speedAt(level, row.z) * 1.7);
      }
    }
  });
});

/** Centre of the gap in a one-gap ring. */
function row0Center(row: Row) {
  const a = row.arcs[0];
  return a.a + a.w + (TAU - a.w) / 2;
}

describe('higher-is-better scoring', () => {
  beforeEach(() => localStorage.clear());
  it('stars count upwards for distance', () => {
    const g = byId('slipstream')!;
    expect(g.better).toBe('higher');
    expect(starsFor(g, 'medium', 500)).toBe(0);
    expect(starsFor(g, 'medium', 700)).toBe(1);
    expect(starsFor(g, 'medium', 2000)).toBe(2);
    expect(starsFor(g, 'medium', 4000)).toBe(3);
    expect(nextStar(g, 'medium', 900)).toEqual({ have: 1, at: 1800 });
    expect(nextStar(g, 'medium', 5000)).toEqual({ have: 3, at: null });
  });
  it('records keep the longest run as the best across reads and imports', () => {
    for (const s of [300, 900, 500]) pushRun('slipstream', s, 'higher', { kind: 'ranked' });
    expect(stats('slipstream', 'higher').best).toBe(900);
    const res = pushRun('slipstream', 950, 'higher', { kind: 'ranked' });
    expect(res.isBest).toBe(true);
    expect(stats('slipstream', 'higher').best).toBe(950);
    importAll(JSON.stringify({ app: 'epsilon', v: 1, data: { 'eps:rec:slipstream': { runs: [{ s: 1200, t: 1, k: 'ranked' }], n: 1, best: 1200 } } }));
    expect(stats('slipstream', 'higher').best).toBe(1200);
    // Lower-is-better games are unchanged.
    for (const s of [3, 1, 2]) pushRun('zero', s, 'lower', { kind: 'ranked' });
    expect(stats('zero', 'lower').best).toBe(1);
  });
});
