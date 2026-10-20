// Ground truth for the precision, synchronisation, rhythm and illusion modes (11–18) and their combos.
import { describe, expect, it } from 'vitest';
import { primary } from '../src/core/input';
import { rng } from '../src/core/rng';
import {
  accuracyPct,
  beatTime,
  biasSummary,
  circularError,
  closestApproach,
  crossingTime,
  fillError,
  idealLaunch,
  interceptErrors,
  latencyEstimate,
  levelFor,
  pourTable,
  reflect,
  relPhase,
  syncError,
  tapError,
  trackingRms,
} from '../src/core/scoring';
import type { Level } from '../src/core/types';
import { makeAfterimage, paramError, paramSigned } from '../src/games/afterimage';
import { idealTimes, makeBeat, MAX_ERR, scoreTap } from '../src/games/beat';
import { HOLD, makeHeldPattern, makePattern } from '../src/games/echo';
import { CONTACT, makeIntersect, posA, scoreLaunch } from '../src/games/intersect';
import { imageOf, makeMirror } from '../src/games/mirror';
import { makeGusts, makePendulum, simulate } from '../src/games/pendulum';
import { makePerception, perceptionError } from '../src/games/perception';
import { makePhase, scorePhase, WINDOW } from '../src/games/phase';
import { emitted, FALL, finalOf, FLUIDS, landed, makePour, TANK_H, widthAt } from '../src/games/pour';
import { makeShadow, targetAt } from '../src/games/shadow';

const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const SEEDS = Array.from({ length: 150 }, (_, i) => (rng(i + 7).next() * 0xffffffff) >>> 0);

describe('circular angles', () => {
  it('wrap correctly near 0° and 360°', () => {
    expect(circularError(359, 1)).toBeCloseTo(2);
    expect(circularError(1, 359)).toBeCloseTo(2);
    expect(circularError(0, 360)).toBeCloseTo(0);
    expect(circularError(90, 270)).toBeCloseTo(180);
    expect(circularError(-725, 5)).toBeCloseTo(10);
  });
  it('accuracy maps 0 → 100 and the tolerance → 0', () => {
    expect(accuracyPct(0, 10)).toBe(100);
    expect(accuracyPct(10, 10)).toBe(0);
    expect(accuracyPct(25, 10)).toBe(0);
    expect(accuracyPct(2.5, 10)).toBeCloseTo(75);
  });
});

describe('Phaseshift: synchronisation over a window', () => {
  it('perfect sync scores 0', () => {
    expect(syncError(0, 0, WINDOW)).toBe(0);
  });
  it('a pure phase offset scores that offset', () => {
    expect(syncError(12.5, 0, WINDOW)).toBeCloseTo(12.5);
    expect(syncError(-30, 0, WINDOW)).toBeCloseTo(30);
  });
  it('a momentary overlap with the wrong speed is penalised by the drift', () => {
    // In phase at the lock, but 5°/s too fast: 20° apart after 4 s.
    expect(syncError(0, 5, 4)).toBeCloseTo(20);
    // Opposite drift that first improves then worsens: the worst end counts.
    expect(syncError(10, -5, 4)).toBeCloseTo(10);
  });
  it('a drift that reaches the far side saturates at 180°', () => {
    expect(syncError(170, 10, 4)).toBe(180);
    expect(syncError(0, 100, 4)).toBe(180);
  });
  it('scorePhase uses the oscillators at the lock time', () => {
    const a = { theta0: 10, omega: 200 };
    expect(scorePhase(a, { ...a }, 3.3).sync).toBeCloseTo(0);
    const b = { theta0: 10 + 7, omega: 200 };
    expect(scorePhase(a, b, 1.234).d0).toBeCloseTo(7);
    expect(relPhase(a, { theta0: 5, omega: 210 }, 0.5)).toBeCloseTo(0);
  });
  it('generator: reproducible, speed starts off on Medium/Hard, equal on Easy', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 60)) {
        const r = makePhase(s, l);
        expect(makePhase(s, l)).toEqual(r);
        for (const rd of r) {
          if (l === 'easy') expect(rd.b.omega).toBe(rd.a.omega);
          else {
            expect(Math.abs(rd.b.omega - rd.a.omega) / rd.a.omega).toBeGreaterThanOrEqual(0.07);
            expect(rd.wLo).toBeLessThan(rd.a.omega);
            expect(rd.wHi).toBeGreaterThan(rd.a.omega);
          }
        }
      }
  });
});

describe('False Beat: scheduled beats and taps', () => {
  it('beats and crossings come from formulas, not frames', () => {
    expect(beatTime(1000, 4, 120)).toBe(3000);
    expect(beatTime(0, 0, 97)).toBe(0);
    expect(crossingTime(0, 25, 75, 500)).toBe(3500);
    expect(tapError(2420, 2400, 15)).toBe(5);
  });
  it('an exact tap scores 0; early/late keep their sign; a miss scores the maximum', () => {
    const [rd] = makeBeat(42, 'easy');
    const { ideal } = idealTimes(rd);
    expect(scoreTap(rd, ideal).err).toBe(0);
    expect(scoreTap(rd, ideal - 37).signedErr).toBeCloseTo(-37);
    expect(scoreTap(rd, ideal + 37).err).toBeCloseTo(37);
    expect(scoreTap(rd, null)).toMatchObject({ err: MAX_ERR, missed: true });
    expect(scoreTap(rd, ideal + 5000).err).toBe(MAX_ERR);
  });
  it('the decoy event is never the answer', () => {
    for (const s of SEEDS.slice(0, 40))
      for (const rd of makeBeat(s, 'hard')) {
        const t = idealTimes(rd);
        expect(rd.objective).not.toBe('both');
        expect(t.other).not.toBeNull();
        expect(Math.abs(t.other! - t.ideal)).toBeGreaterThanOrEqual(90);
        expect(scoreTap(rd, t.other!).tracked).toBe(false);
        expect(scoreTap(rd, t.ideal).tracked).toBe(true);
        expect(scoreTap(rd, t.other!).err).toBeGreaterThan(0);
      }
  });
  it('the target beat is always after the count-in, and Easy/Medium crossings land on it', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 50)) {
        const r = makeBeat(s, l);
        expect(makeBeat(s, l)).toEqual(r);
        for (const rd of r) {
          expect(rd.target).toBeGreaterThanOrEqual(5);
          if (l !== 'hard') expect(rd.crossOff).toBe(0);
        }
      }
  });
  it('latency calibration only trusts steady taps', () => {
    expect(latencyEstimate([30, 32, 28, 31, 29, 33])!.offset).toBeCloseTo(30.5);
    expect(latencyEstimate([30, 32, 28])).toBeNull();
    expect(latencyEstimate([0, 200, -150, 90, -120, 160])).toBeNull();
  });
});

describe('Intersect: trajectories', () => {
  it('closest approach of crossing and parallel movers', () => {
    // Head-on along x: they meet at t = 1.
    expect(closestApproach({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: -10, y: 0 }, 5).d).toBeCloseTo(0);
    // Parallel, never meeting: constant gap.
    const p = closestApproach({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, { x: 5, y: 0 }, 5);
    expect(p.d).toBeCloseTo(3);
    // Moving apart: closest at t = 0.
    expect(closestApproach({ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 5, y: 0 }, { x: 1, y: 0 }, 5).t).toBe(0);
  });
  it('the ideal launch meets at the target exactly on time', () => {
    const L = { x: -40, y: 40 };
    const P = { x: 10, y: -5 };
    const { s, theta } = idealLaunch(L, P, 2.5);
    const e = interceptErrors(L, s, theta, P, 2.5);
    expect(e.miss).toBeCloseTo(0, 9);
    expect(e.spatial).toBeCloseTo(0, 9);
    expect(e.timing).toBeCloseTo(0, 9);
  });
  it('direction and timing errors separate', () => {
    const L = { x: 0, y: 0 };
    const P = { x: 50, y: 0 };
    // Right direction, 10% too slow: no direction error, late.
    const slow = interceptErrors(L, 22.5, 0, P, 2);
    expect(slow.spatial).toBeCloseTo(0);
    expect(slow.timing).toBeGreaterThan(0);
    expect(slow.miss).toBeCloseTo(5);
    // Pointing away: B never reaches P.
    expect(interceptErrors(L, 25, Math.PI, P, 2).timing).toBe(Infinity);
  });
  it('generators: the ideal launch is reachable with the controls, and scores a collision', () => {
    for (const mode of ['line', 'mislead', 'orbit'])
      for (const l of LEVELS)
        for (const s of SEEDS.slice(0, 25)) {
          const rounds = makeIntersect(s, l, mode);
          expect(makeIntersect(s, l, mode)).toEqual(rounds);
          for (const rd of rounds) {
            const best = rd.passes.map((t) => idealLaunch({ x: -40, y: 40 }, rd.P, t)).find((x) => x.s >= 12 && x.s <= 60)!;
            expect(best.s).toBeGreaterThan(rd.sLo);
            expect(best.s).toBeLessThan(rd.sHi);
            expect(best.theta).toBeGreaterThan(rd.aLo);
            expect(best.theta).toBeLessThan(rd.aHi);
            const sc = scoreLaunch(rd, best.s, best.theta);
            expect(sc.miss).toBeLessThan(1e-6);
            expect(sc.hit).toBe(true);
            // ● really is at ✛ at the pass time.
            const pa = posA(rd.track, sc.tA);
            expect(Math.hypot(pa.x - rd.P.x, pa.y - rd.P.y)).toBeLessThan(1e-6);
          }
        }
  });
  it('a near miss is not a collision', () => {
    const rd = makeIntersect(SEEDS[0], 'medium', 'line')[0];
    const best = idealLaunch({ x: -40, y: 40 }, rd.P, rd.passes[0]);
    const off = scoreLaunch(rd, best.s, best.theta + 0.2);
    expect(off.hit).toBe(off.closest.d <= CONTACT);
    expect(off.closest.d).toBeGreaterThan(CONTACT);
    expect(off.hit).toBe(false);
  });
});

describe('Perception: the engine scores geometry, not appearance', () => {
  it('five rounds, one of each type, targets inside the adjustable range, starts away from the answer', () => {
    for (const l of LEVELS)
      for (const s of SEEDS) {
        const r = makePerception(s, l);
        expect(new Set(r.map((x) => x.type)).size).toBe(5);
        for (const rd of r) {
          expect(rd.target).toBeGreaterThan(rd.lo);
          expect(rd.target).toBeLessThan(rd.hi);
          expect(rd.norm).toBeGreaterThan(0);
          if (rd.type === 'align') expect(Math.abs(rd.start - rd.target)).toBeGreaterThanOrEqual(3);
          else expect(Math.abs(rd.start - rd.target) / rd.target).toBeGreaterThanOrEqual(0.12);
          if (l === 'easy') expect(rd.illusion).toBe('none');
          else expect(rd.illusion).not.toBe('none');
        }
      }
  });
  it('exact settings score 0 whatever the illusion; the illusion never moves the answer', () => {
    for (const rd of makePerception(99, 'hard')) {
      expect(perceptionError(rd, rd.target)).toBe(0);
      const louder = { ...rd, k: rd.k * 3, polarity: -rd.polarity };
      expect(perceptionError(louder, rd.target + 1)).toBeCloseTo(perceptionError(rd, rd.target + 1));
    }
  });
  it('relative errors are signed and normalised', () => {
    const rd = makePerception(5, 'medium').find((x) => x.type === 'length')!;
    expect(perceptionError(rd, rd.target * 1.1)).toBeCloseTo(0.1);
    expect(perceptionError(rd, rd.target * 0.95)).toBeCloseTo(-0.05);
  });
  it('a bias is only called systematic with enough consistent evidence', () => {
    expect(biasSummary([0.05, 0.06]).systematic).toBe(false);
    expect(biasSummary([0.05, 0.06, 0.04, 0.05, 0.07, 0.05, 0.06, 0.04]).systematic).toBe(true);
    expect(biasSummary([0.05, -0.06, 0.04, -0.05, 0.07, -0.05, 0.06, -0.04]).systematic).toBe(false);
  });
});

describe('Afterimage: normalised reconstruction', () => {
  it('phase error is a fraction of a cycle and wraps', () => {
    expect(paramError('phase', 350, 10)).toBeCloseTo(20 / 360);
    expect(paramError('phase', 10, 10)).toBe(0);
    expect(paramSigned('phase', 10, 350)).toBeCloseTo(20 / 360);
  });
  it('relative errors for the others', () => {
    expect(paramError('freq', 1.1, 1)).toBeCloseTo(0.1);
    expect(paramError('amp', 18, 20)).toBeCloseTo(0.1);
    expect(paramSigned('interval', 450, 500)).toBeCloseTo(-0.1);
  });
  it('only the asked parameters vary, and every answer is reachable', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 60)) {
        const r = makeAfterimage(s, l);
        expect(makeAfterimage(s, l)).toEqual(r);
        for (const rd of r) {
          expect(rd.ask.length).toBe(l === 'hard' ? 2 : 1);
          for (const p of rd.ask) {
            const g = rd.ranges[p];
            if (p === 'interval' || p === 'phase') continue;
            expect(g!.lo).toBeLessThan(rd.sig[p]);
            expect(g!.hi).toBeGreaterThan(rd.sig[p]);
          }
          if (l === 'hard') expect(rd.distractor).not.toBeNull();
          if (l === 'easy') expect(rd.ask).not.toContain('phase');
        }
      }
  });
});

describe('Echo, rhythm memory (Held mode)', () => {
  it('keeps the pattern length and applies a monotone tempo change', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 40)) {
        const base = makePattern(s, l);
        const held = makeHeldPattern(s, l);
        expect(held).toHaveLength(base.length);
        expect(makeHeldPattern(s, l)).toEqual(held);
        const ratios = held.map((g, i) => g / base[i]);
        const inc = ratios.every((v, i) => i === 0 || v > ratios[i - 1]);
        const dec = ratios.every((v, i) => i === 0 || v < ratios[i - 1]);
        expect(inc || dec).toBe(true);
        expect(HOLD[l]).toBeGreaterThanOrEqual(3000);
      }
  });
});

describe('Pour: volume is area', () => {
  it('a straight tank is linear', () => {
    const tab = pourTable(() => 20, 70);
    expect(tab.total).toBeCloseTo(1400);
    expect(levelFor(tab, 700)).toBeCloseTo(35);
    expect(levelFor(tab, 0)).toBe(0);
    expect(levelFor(tab, 99999)).toBe(70);
  });
  it('a cone holds half its volume well above half its height', () => {
    // Width 0 → 40 over height 70 (a triangle): half the area sits at 70·√½ from the bottom.
    const tab = pourTable((y) => (40 * y) / 70, 70);
    expect(levelFor(tab, tab.total / 2)).toBeCloseTo(70 * Math.SQRT1_2, 1);
    expect(fillError(tab.total / 2, tab.total, 0.5)).toBeCloseTo(0);
    expect(fillError(tab.total * 0.6, tab.total, 0.5)).toBeCloseTo(10);
  });
  it('generated tanks have positive width and a target fraction within (0, 1)', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 50))
        for (const rd of makePour(s, l)) {
          for (let y = 0; y <= TANK_H; y += 1) expect(widthAt(rd, y)).toBeGreaterThan(5);
          expect(rd.f).toBeGreaterThan(0.2);
          expect(rd.f).toBeLessThan(0.85);
          if (l === 'easy') expect(rd.f).toBe(0.5);
          if (l === 'hard') expect(rd.pours).toBe(1);
        }
  });
});

describe('Pour: fluids', () => {
  it('everything let out eventually lands: the stream in the air and the drip', () => {
    for (const fl of Object.values(FLUIDS)) {
      const Q = 50;
      const open = 2.3;
      const fin = finalOf(Q, fl, open);
      expect(landed(Q, fl, open, 60)).toBeCloseTo(fin, 6);
      // At the instant of release, less has landed than will: the afterflow is real.
      expect(landed(Q, fl, open, open)).toBeLessThan(fin);
      // Nothing lands before the first drop has fallen.
      expect(landed(Q, fl, null, FALL * 0.9)).toBe(0);
    }
  });
  it('a sluggish fluid delivers less for the same hold, then drips more', () => {
    const Q = 50;
    expect(emitted(Q, FLUIDS.mercury.ramp, 1)).toBeLessThan(emitted(Q, FLUIDS.xenon.ramp, 1));
    const tailM = finalOf(Q, FLUIDS.mercury, 1) - emitted(Q, FLUIDS.mercury.ramp, 1);
    const tailX = finalOf(Q, FLUIDS.xenon, 1) - emitted(Q, FLUIDS.xenon.ramp, 1);
    expect(tailM).toBeGreaterThan(tailX);
  });
  it('Medium meets all three fluids; Easy is xenon; Hard is never xenon', () => {
    for (const s of SEEDS.slice(0, 40)) {
      expect(new Set(makePour(s, 'medium').map((r) => r.fluid)).size).toBe(3);
      expect(makePour(s, 'easy').every((r) => r.fluid === 'xenon')).toBe(true);
      expect(makePour(s, 'hard').every((r) => r.fluid !== 'xenon')).toBe(true);
    }
  });
});

describe('Pendulum: gusts', () => {
  it('are seeded, change the swing, and never send the bob over the top', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 12)) {
        const rds = makePendulum(s, l);
        const g1 = makeGusts(s, rds, l);
        expect(makeGusts(s, rds, l)).toEqual(g1);
        rds.forEach((rd, i) => {
          const calm = simulate(rd.L, rd.th0);
          const gust = simulate(rd.L, rd.th0, undefined, g1[i]);
          let peak = 0;
          let diff = 0;
          for (let j = 0; j < gust.length; j += 10) {
            peak = Math.max(peak, Math.abs(gust[j]));
            diff = Math.max(diff, Math.abs(gust[j] - calm[j]));
          }
          expect(peak).toBeLessThan(2.8);
          expect(diff).toBeGreaterThan(0.01);
        });
      }
  });
});

describe('Shadow: grid-sampled tracking error', () => {
  it('a cursor exactly on the target scores 0; a constant offset scores that offset', () => {
    const tgt = (t: number) => ({ x: Math.sin(t) * 10, y: 0 });
    const on = Array.from({ length: 2001 }, (_, i) => ({ t: i / 1000, ...tgt(i / 1000) }));
    expect(trackingRms(on, tgt, 0, 2).rms).toBeLessThan(0.02);
    const still = (t: number) => ({ x: 5, y: t * 0 });
    expect(trackingRms([{ t: 0, x: 5, y: 3 }], still, 0, 2).rms).toBeCloseTo(3);
  });
  it('the event rate does not change the score', () => {
    const tgt = (t: number) => ({ x: t, y: 0 });
    const sparse = [{ t: 0, x: 0, y: 0 }];
    const dense = Array.from({ length: 100 }, (_, i) => ({ t: i / 50, x: 0, y: 0 }));
    expect(trackingRms(sparse, tgt, 0, 2).rms).toBeCloseTo(trackingRms(dense, tgt, 0, 2).rms, 9);
  });
  it('the target stays inside the field', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 30)) {
        const p = makeShadow(s, l);
        for (let t = 0; t <= p.duration; t += 0.1) {
          const q = targetAt(p, t);
          expect(Math.abs(q.x)).toBeLessThan(50);
          expect(Math.abs(q.y)).toBeLessThan(50);
        }
        if (l === 'hard') expect(p.hidden).toHaveLength(3);
      }
  });
});

describe('Mirror: reflections', () => {
  it('reflects across axes and diagonals', () => {
    expect(reflect({ x: 3, y: 4 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 3, y: -4 });
    const d = reflect({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(2);
  });
  it('two reflections are a rotation by twice the angle between the mirrors', () => {
    const m1 = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const m2 = { a: { x: 0, y: 0 }, b: { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) } };
    const q = imageOf({ x: 10, y: 0 }, [m1, m2]);
    expect(q.x).toBeCloseTo(10 * Math.cos(Math.PI / 3));
    expect(q.y).toBeCloseTo(10 * Math.sin(Math.PI / 3));
  });
  it('every generated image is inside the field', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 60))
        for (const rd of makeMirror(s, l)) {
          expect(Math.abs(rd.image.x)).toBeLessThanOrEqual(42);
          expect(Math.abs(rd.image.y)).toBeLessThanOrEqual(42);
          expect(rd.mirrors).toHaveLength(l === 'hard' ? 2 : 1);
        }
  });
});

describe('input', () => {
  it('mouse drags are not dropped: pointermove reports button −1', () => {
    const ev = (o: Partial<PointerEvent>) => ({ isPrimary: true, pointerType: 'mouse', button: 0, ...o }) as PointerEvent;
    expect(primary(ev({ button: -1 }))).toBe(true);
    expect(primary(ev({ button: 0 }))).toBe(true);
    expect(primary(ev({ button: 2 }))).toBe(false);
    expect(primary(ev({ isPrimary: false }))).toBe(false);
    expect(primary(ev({ pointerType: 'touch', button: 0 }))).toBe(true);
  });
});
