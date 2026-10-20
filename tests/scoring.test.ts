import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  angularCoverage,
  balanceError,
  BALANCE_MIN_X,
  closureGap,
  echoErrors,
  fieldToPad,
  idealLastPoint,
  lineDistance,
  mad,
  median,
  padToField,
  parseSeed,
  seedToString,
  signedTotal,
  stoppingDistance,
  validScore,
  virtualStop,
  weightedCentroid,
  weightedRms,
} from '../src/core/scoring';

const circle = (r: number, n = 360, turns = 1) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI * turns;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });

describe('validScore', () => {
  it('accepts finite non-negative numbers only', () => {
    expect(validScore(0)).toBe(true);
    expect(validScore(1.5)).toBe(true);
    expect(validScore(-0.1)).toBe(false);
    expect(validScore(NaN)).toBe(false);
    expect(validScore(Infinity)).toBe(false);
  });
});

describe('angleDiff (Exact)', () => {
  it('returns the signed shortest difference, clockwise positive', () => {
    expect(angleDiff(10, 350)).toBeCloseTo(20);
    expect(angleDiff(350, 10)).toBeCloseTo(-20);
    expect(angleDiff(137.4, 137)).toBeCloseTo(0.4);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(720 + 5, 0)).toBeCloseTo(5);
  });
  it('never leaves (−180, 180]', () => {
    for (let a = -720; a <= 720; a += 7.3) for (let b = 0; b < 360; b += 11.1) {
      const d = angleDiff(a, b);
      expect(d).toBeGreaterThan(-180);
      expect(d).toBeLessThanOrEqual(180);
    }
  });
});

describe('signedTotal (Zero)', () => {
  it('alternates signs', () => {
    expect(signedTotal([0.71, 0.64, 0.38, 0.44], [1, -1, 1, -1])).toBeCloseTo(0.01, 10);
  });
});

describe('pad transforms (Close the Loop)', () => {
  const ts = [
    { scale: 1, rot: 0, mirror: false },
    { scale: 2, rot: Math.PI / 2, mirror: false },
    { scale: 1.5, rot: 2.5, mirror: true },
    { scale: 1.25, rot: -1.2, mirror: true },
  ];
  it('fieldToPad is the exact inverse of padToField', () => {
    for (const t of ts) {
      const f = { x: 23.4, y: -11.2 };
      const back = padToField(fieldToPad(f, t), t);
      expect(back.x).toBeCloseTo(f.x, 9);
      expect(back.y).toBeCloseTo(f.y, 9);
    }
  });
  it('the ideal pad arrow closes the loop with zero gap', () => {
    const home = { x: -10, y: 5 };
    const end = { x: 20, y: -15 };
    for (const t of ts) {
      const ideal = fieldToPad({ x: home.x - end.x, y: home.y - end.y }, t);
      expect(closureGap(end, home, padToField(ideal, t))).toBeCloseTo(0, 9);
    }
  });
  it('a 90° clockwise pad maps pad-right to field-up', () => {
    const v = padToField({ x: 1, y: 0 }, { scale: 1, rot: Math.PI / 2, mirror: false });
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(-1);
  });
});

describe('Draw metrics', () => {
  it('a perfect circle has zero RMS and full coverage', () => {
    const pts = circle(30);
    const { rms, mean } = weightedRms(pts, (p) => Math.hypot(p.x, p.y) - 30);
    expect(rms).toBeLessThan(0.01);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(angularCoverage(pts, { x: 0, y: 0 })).toBe(1);
  });
  it('a circle 2 u too big has RMS 2 and mean offset +2', () => {
    const { rms, mean } = weightedRms(circle(32), (p) => Math.hypot(p.x, p.y) - 30);
    expect(rms).toBeCloseTo(2, 2);
    expect(mean).toBeCloseTo(2, 2);
  });
  it('a short accurate arc has low coverage (cannot pass as a full shape)', () => {
    const arc = circle(30, 90, 0.25);
    expect(angularCoverage(arc, { x: 0, y: 0 })).toBeLessThan(0.3);
  });
  it('RMS is NaN for an empty or zero-length stroke (rejected upstream)', () => {
    expect(Number.isNaN(weightedRms([{ x: 1, y: 1 }], () => 0).rms)).toBe(true);
  });
  it('lineDistance is signed perpendicular distance', () => {
    expect(lineDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(lineDistance({ x: 5, y: -3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(-3);
  });
});

describe('Stop physics', () => {
  it('stopping distance is v²/2A', () => {
    expect(stoppingDistance(60, 60)).toBe(30);
    expect(virtualStop(100, 30, 60)).toBe(107.5);
  });
});

describe('Balance error', () => {
  it('is relative to the balance point', () => {
    expect(balanceError(55, 50)).toBeCloseTo(10);
    expect(balanceError(50, 50)).toBe(0);
  });
  it('is undefined (NaN) for a balance point too close to the pivot — never a huge bogus score', () => {
    expect(Number.isNaN(balanceError(5, 0.001))).toBe(true);
    expect(Number.isNaN(balanceError(5, BALANCE_MIN_X - 1))).toBe(true);
  });
});

describe('Echo errors', () => {
  const gaps = [400, 200, 200, 600];
  const at = (g: number[], start = 1000) => g.reduce((a, x) => [...a, a[a.length - 1] + x], [start]);
  it('perfect taps score 0', () => {
    const r = echoErrors(at(gaps), gaps);
    expect(r.mean).toBe(0);
    expect(r.tempo).toBeCloseTo(0);
  });
  it('a uniformly slower tempo is forgiven by the shape metric', () => {
    const r = echoErrors(at(gaps.map((g) => g * 1.1)), gaps);
    expect(r.mean).toBeCloseTo(35);
    expect(r.shape).toBeCloseTo(0, 9);
    expect(r.tempo).toBeCloseTo(10);
  });
  it('only gaps matter: a constant latency offset changes nothing', () => {
    const a = echoErrors(at(gaps, 0), gaps);
    const b = echoErrors(at(gaps, 5000), gaps);
    expect(a.mean).toBe(b.mean);
  });
});

describe('Center', () => {
  it('placing the last point at the ideal puts the weighted centroid on target', () => {
    const w = [1, 2, 1, 3, 1];
    const pts = [
      { x: -30, y: 20 },
      { x: 25, y: 30 },
      { x: 10, y: -40 },
      { x: -35, y: -10 },
    ];
    const T = { x: 7, y: -3 };
    const last = idealLastPoint(pts, w, T);
    const g = weightedCentroid([...pts, last], w);
    expect(g.x).toBeCloseTo(T.x, 9);
    expect(g.y).toBeCloseTo(T.y, 9);
  });
});

describe('robust statistics', () => {
  it('median and MAD resist one wild run', () => {
    const runs = [1.1, 1.0, 0.9, 1.2, 50];
    expect(median(runs)).toBeCloseTo(1.1);
    expect(mad(runs)).toBeCloseTo(0.1);
  });
  it('are defined at zero (unlike 1 − σ/μ)', () => {
    expect(median([0, 0, 0])).toBe(0);
    expect(mad([0, 0, 0])).toBe(0);
  });
});

describe('seed strings', () => {
  it('round-trip every 32-bit seed', () => {
    for (const s of [0, 1, 0xffff, 0x10000, 123456789, 0xffffffff]) expect(parseSeed(seedToString(s))).toBe(s);
  });
  it('are case-insensitive', () => {
    expect(parseSeed('1a2b')).toBe(parseSeed('1A2B'));
  });
  it('reject invalid input', () => {
    for (const bad of [null, '', ' ', '-5', '12.5', 'abc$', 'ZZZZZZZZ', '../x']) expect(parseSeed(bad)).toBeNull();
  });
});
