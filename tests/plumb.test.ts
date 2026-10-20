import { describe, expect, it } from 'vitest';
import { analysePlumb, makePlumb } from '../src/games/plumb';
import type { Level } from '../src/core/types';

const ln = { a: { x: -40, y: 0 }, b: { x: 40, y: 0 } };
const stroke = (f: (u: number) => number, from = -40, to = 40, n = 400) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / n;
    return { x, y: f((x + 40) / 80) };
  });

describe('Plumb scoring', () => {
  it('a perfect line scores 0 with full coverage', () => {
    const m = analysePlumb(stroke(() => 0), ln)!;
    expect(m.rms).toBeCloseTo(0, 9);
    expect(m.span).toBeGreaterThanOrEqual(0.99);
    expect(m.startMiss).toBeCloseTo(0);
    expect(m.endMiss).toBeCloseTo(0);
  });
  it('a constant 2 u offset scores RMS 2 and bow ±2', () => {
    const m = analysePlumb(stroke(() => 2), ln)!;
    expect(m.rms).toBeCloseTo(2, 6);
    expect(Math.abs(m.bow)).toBeCloseTo(2, 6);
    expect(m.maxDev).toBeCloseTo(2, 6);
  });
  it('is direction-independent (B→A scores the same as A→B)', () => {
    const f = (u: number) => Math.sin(u * Math.PI) * 3;
    const fwd = analysePlumb(stroke(f), ln)!;
    const rev = analysePlumb(stroke(f).reverse(), ln)!;
    expect(rev.rms).toBeCloseTo(fwd.rms, 9);
    expect(rev.startMiss).toBeCloseTo(0);
  });
  it('ignores overshoot beyond the dots', () => {
    const m = analysePlumb(stroke(() => 0, -60, 60), ln)!;
    expect(m.rms).toBeCloseTo(0, 9);
    expect(m.endMiss).toBeCloseTo(20);
  });
  it('a short accurate segment does not cover the line', () => {
    const m = analysePlumb(stroke(() => 0, -40, 0), ln)!;
    expect(m.span).toBeLessThan(0.6);
  });
});

describe('Plumb generator', () => {
  it('is deterministic and keeps both dots in the field', () => {
    for (const l of ['easy', 'medium', 'hard'] as Level[])
      for (let s = 1; s < 300; s++) {
        const p = makePlumb(s, l);
        expect(makePlumb(s, l)).toEqual(p);
        for (const v of [p.a, p.b]) {
          expect(Math.abs(v.x)).toBeLessThan(50);
          expect(Math.abs(v.y)).toBeLessThan(50);
        }
        const L = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
        expect(L).toBeGreaterThanOrEqual(50);
        expect(L).toBeLessThanOrEqual(85);
      }
  });
});
