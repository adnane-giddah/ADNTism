// Ground truth for experiments 19–29 and the shared settings / records changes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rng } from '../src/core/rng';
import { boxTank, equilibrium, flowStep, levelFor, pourTable, revolveTable, surfaceOf, volumeAt, type Tank } from '../src/core/scoring';
import type { Level } from '../src/core/types';
import { LABELS, resolveLanes } from '../src/core/keymap';
import { makeVessels, tankOf } from '../src/games/vessels';
import { makeValves, runPlan, valveScore, valveStep } from '../src/games/valves';
import { alignWords, editDistance, makeVerbatim, normalize, scoreRecall } from '../src/games/verbatim';
import { judge, letterfallScore, makeLetterfall, WINDOW } from '../src/games/letterfall';
import { family, gridError, makeRules, RULES } from '../src/games/rules';
import { hitsChange, makeDiff, penalty } from '../src/games/diff';
import { makeQuantity, quantityErrors } from '../src/games/quantity';
import { brakeStep, idealOnset, makeBrake, stopFrom, type Terrain } from '../src/games/brake';
import { catchError, crossings, exactPeriod, makePendulum, simulate, smallAnglePeriod } from '../src/games/pendulum';

const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const SEEDS = Array.from({ length: 60 }, (_, i) => (rng(i + 101).next() * 0xffffffff) >>> 0);


describe('Communicating Vessels: equilibrium and conservation', () => {
  it('connected surfaces level out while the volumes differ', () => {
    const a = boxTank(10, 60);
    const b = boxTank(30, 60);
    const eq = equilibrium([a, b], [400, 200]);
    expect(eq.surface).toBeCloseTo(600 / 40, 6);
    expect(eq.volumes[0] + eq.volumes[1]).toBeCloseTo(600, 6);
    expect(eq.volumes[1]).toBeCloseTo(3 * eq.volumes[0], 6);
    expect(eq.overflow).toBe(0);
  });
  it('a short vessel overflows: the surface stops at its rim and the excess is lost', () => {
    const a = boxTank(10, 60);
    const b = boxTank(10, 20);
    const eq = equilibrium([a, b], [580, 0]);
    expect(eq.surface).toBeCloseTo(20, 6);
    expect(eq.overflow).toBeCloseTo(580 - 400, 6);
  });
  it('a raised vessel drains completely if the common level is below its floor', () => {
    const low = boxTank(20, 60, 0);
    const high = boxTank(10, 60, 30);
    const eq = equilibrium([low, high], [100, 50]);
    expect(eq.volumes[1]).toBeCloseTo(0, 6);
    expect(eq.surface).toBeCloseTo(150 / 20, 6);
  });
  it('the flow conserves liquid exactly, never overshoots, and converges to equilibrium', () => {
    const tanks: Tank[] = [boxTank(12, 60), { tab: pourTable((y) => 8 + y / 3, 60), floor: 0 }, boxTank(20, 60)];
    let V = [600, 50, 100];
    const total = V.reduce((x, y) => x + y, 0);
    const pipes = [
      { a: 0, b: 1, k: 30, open: true },
      { a: 1, b: 2, k: 30, open: true },
    ];
    let spilled = 0;
    for (let i = 0; i < 4000; i++) {
      const r = flowStep(tanks, V, pipes, 1 / 120);
      V = r.V;
      spilled += r.spilled;
      expect(V.reduce((x, y) => x + y, 0) + spilled).toBeCloseTo(total, 6);
    }
    const eq = equilibrium(tanks, [600, 50, 100]);
    V.forEach((v, i) => expect(v).toBeCloseTo(eq.volumes[i], 0));
    const s = tanks.map((t, i) => surfaceOf(t, V[i]));
    expect(Math.max(...s) - Math.min(...s)).toBeLessThan(0.05);
  });
  it('generated target rounds are reachable (the mark lies between the start and the pair equilibrium)', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 30)) {
        const rounds = makeVessels(s, l);
        expect(makeVessels(s, l)).toEqual(rounds);
        for (const rd of rounds) {
          if (!rd.target) continue;
          const tanks = rd.vessels.map(tankOf);
          const start = surfaceOf(tanks[rd.target.i], rd.V0[rd.target.i]);
          expect(rd.target.s).toBeGreaterThan(start);
        }
      }
  });
});

describe('Valve Engineer: deterministic routing', () => {
  it('a step conserves liquid, and overfull containers spill', () => {
    const pz = makeValves(SEEDS[0], 'medium');
    let V = pz.nodes.map((n) => n.V0);
    const total = V.reduce((a, b) => a + b, 0);
    let spilled = 0;
    const open = pz.pipes.map(() => true);
    for (let i = 0; i < 2000; i++) {
      const r = valveStep(pz.nodes, pz.pipes, V, open, 1 / 60);
      V = r.V;
      spilled += r.spilled;
      expect(V.reduce((a, b) => a + b, 0) + spilled).toBeCloseTo(total, 6);
      V.forEach((v, j) => expect(v).toBeLessThanOrEqual(pz.nodes[j].cap + 1e-9));
    }
  });
  it('goals are sensible and an exact delivery scores 0', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 20)) {
        const pz = makeValves(s, l);
        expect(makeValves(s, l)).toEqual(pz);
        const exact = pz.nodes.map((n) => n.goal ?? 0);
        expect(valveScore(pz, exact, 0).pct).toBe(0);
        for (const n of pz.nodes) if (n.goal != null) expect(n.goal).toBeGreaterThanOrEqual(20);
      }
  });
  it('every level generates its own network (never the emergency fallback)', () => {
    const size = { easy: 3, medium: 6, hard: 8 };
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 25)) {
        const pz = makeValves(s, l);
        expect(pz.nodes).toHaveLength(size[l]);
        if (l === 'hard') expect(pz.ops).toBe(14);
      }
  });
  it('a plan that never opens anything delivers nothing', () => {
    const pz = makeValves(SEEDS[1], 'easy');
    const r = runPlan(pz, pz.pipes.map(() => 0));
    expect(r.spilled).toBe(0);
    expect(valveScore(pz, r.V, r.spilled).pct).toBeCloseTo(100, 6);
  });
});

describe('Verbatim: transparent recall scoring', () => {
  it('normalises layout only', () => {
    expect(normalize('  Hello\n  “world”  —  ok… ')).toBe('Hello "world" - ok...');
    expect(normalize('It’s')).toBe("It's");
  });
  it('edit distance and word alignment', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    const ops = alignWords('the cat sat on the mat'.split(' '), 'the cat sat the big mat'.split(' '));
    expect(ops.filter((o) => o.op === 'omit').length + ops.filter((o) => o.op === 'sub').length).toBeGreaterThan(0);
    expect(ops.filter((o) => o.op === 'ok').length).toBe(5);
  });
  it('an exact answer scores 0; capitals and punctuation count and are reported', () => {
    const t = 'She folded the map along its oldest crease.';
    expect(scoreRecall(t, t).cer).toBe(0);
    expect(scoreRecall(t, '  She folded   the map along its oldest crease. ').cer).toBe(0);
    const c = scoreRecall(t, 'she folded the map along its oldest crease');
    expect(c.chars).toBe(2);
    expect(c.caseOnly).toBe(1);
    expect(c.punctOnly).toBe(1);
    const o = scoreRecall(t, 'She folded the map along its crease.');
    expect(o.omissions).toBe(1);
    expect(o.insertions).toBe(0);
  });
  it('passages are reproducible and match the level', () => {
    for (const s of SEEDS.slice(0, 10)) {
      expect(makeVerbatim(s, 'easy')).toHaveLength(3);
      expect(makeVerbatim(s, 'hard')).toHaveLength(1);
      expect(makeVerbatim(s, 'medium')).toEqual(makeVerbatim(s, 'medium'));
    }
  });
});

describe('Letterfall: mapping and timing', () => {
  it('lanes are physical keys; labels follow the chosen layout', () => {
    const q = resolveLanes(6, { layout: 'qwerty' });
    const a = resolveLanes(8, { layout: 'azerty' });
    expect(q.map((l) => l.code)).toEqual(['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL']);
    expect(a[0]).toEqual({ code: 'KeyA', label: 'Q' });
    expect(a[7].label).toBe(LABELS.azerty.Semicolon);
    const custom = Array.from({ length: 8 }, (_, i) => ({ code: `Digit${i}`, label: String(i) }));
    expect(resolveLanes(4, { layout: 'custom', custom })).toEqual(custom.slice(0, 4));
  });
  it('same-lane notes never share a timing window', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 20)) {
        const song = makeLetterfall(s, l);
        for (let lane = 0; lane < song.lanes; lane++) {
          const ts = song.notes.filter((n) => n.lane === lane).map((n) => n.t);
          for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(320);
        }
      }
  });
  it('perfect presses score 0; a miss costs the window; strays are counted, not scored', () => {
    const song = makeLetterfall(SEEDS[3], 'hard');
    const perfect = song.notes.map((n) => ({ t: n.t, lane: n.lane }));
    expect(letterfallScore(song.notes, judge(song.notes, perfect))).toBe(0);
    const missOne = perfect.slice(1);
    expect(letterfallScore(song.notes, judge(song.notes, missOne))).toBeCloseTo(WINDOW / song.notes.length, 9);
    const j = judge(song.notes, [...perfect, { t: -5000, lane: 0 }]);
    expect(j.strays).toBe(1);
    expect(j.misses).toHaveLength(0);
    const late = judge(song.notes, perfect.map((p) => ({ ...p, t: p.t + 20 })));
    expect(letterfallScore(song.notes, late)).toBeCloseTo(20, 9);
  });
});

describe('Rule Hunter: transformations and unambiguous puzzles', () => {
  const g = [
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 0],
  ];
  it('rules transform as named', () => {
    expect(RULES.rot90.f(g)).toEqual([
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    expect(RULES.flipH.f(g)).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      [0, 0, 0],
    ]);
    expect(RULES.shiftR.f(g)[0]).toEqual([0, 1, 0]);
    expect(RULES.gravity.f(g)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ]);
    expect(RULES.inc3.f([[0, 1, 2]])).toEqual([[1, 2, 0]]);
    // A blinker oscillates under Life.
    const blink = [
      [0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    expect(RULES.life.f(RULES.life.f(blink))).toEqual(blink);
  });
  it('every generated puzzle has one consistent answer among the level’s rules', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 12)) {
        const ps = makeRules(s, l);
        expect(ps.length).toBe(4);
        for (const p of ps) {
          const [S0, S1, S2] = p.states;
          const eq = (a: number[][], b: number[][]) => gridError(a, b) === 0;
          // Same candidate set as the game: three-shade grids only admit three-shade rules.
          const fits = family(l).filter((c) => (p.values === 3 ? c.values === 3 : true)).filter((c) => eq(c.f(S0), S1) && eq(c.f(S1), S2));
          expect(fits.length).toBeGreaterThanOrEqual(1);
          for (const f of fits) expect(eq(f.f(S2), p.answer)).toBe(true);
        }
      }
  });
  it('grid error is the share of differing cells', () => {
    expect(gridError(g, g)).toBe(0);
    expect(gridError(g, RULES.invert.f(g))).toBe(100);
  });
});

describe('Difference Engine', () => {
  it('a tap on the changed element hits; a far tap misses; penalties are 0 / ½ / 1', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 15)) {
        const rounds = makeDiff(s, l);
        expect(rounds).toHaveLength(8);
        expect(makeDiff(s, l)).toEqual(rounds);
        for (const rd of rounds) {
          expect(rd.choices).toContain(rd.kind);
          const target = rd.points.length ? rd.after.pts[rd.points[0]] : { x: (rd.before.pts[rd.edges[0][0]].x + rd.before.pts[rd.edges[0][1]].x) / 2, y: (rd.before.pts[rd.edges[0][0]].y + rd.before.pts[rd.edges[0][1]].y) / 2 };
          expect(hitsChange(rd, target)).toBe(true);
          expect(hitsChange(rd, { x: 500, y: 500 })).toBe(false);
        }
      }
    expect(penalty(true, true)).toBe(0);
    expect(penalty(true, false)).toBe(0.5);
    expect(penalty(false, true)).toBe(1);
  });
});

describe('Quantity Sense', () => {
  it('counts are exact and the scoring separates absolute from relative error', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 15))
        for (const rd of makeQuantity(s, l)) {
          expect(rd.items.filter((i) => i.kind === 0)).toHaveLength(rd.a);
          expect(rd.share).toBeCloseTo(rd.a / (rd.a + rd.b), 12);
          if (l === 'hard') {
            // The bigger group has the smaller items.
            const mean = (k: 0 | 1) => rd.items.filter((i) => i.kind === k).reduce((x, i) => x + i.s, 0) / rd.items.filter((i) => i.kind === k).length;
            if (rd.a > rd.b) expect(mean(0)).toBeLessThan(mean(1));
            else expect(mean(1)).toBeLessThan(mean(0));
          }
        }
    const rd = makeQuantity(SEEDS[0], 'medium')[0];
    const e = quantityErrors(rd.share + 0.05, rd);
    expect(e.abs).toBeCloseTo(5, 9);
    expect(e.rel).toBeCloseTo((0.05 / rd.share) * 100, 9);
    expect(quantityErrors(rd.share, rd).abs).toBe(0);
  });
});

describe('Brake Point: deterministic motion', () => {
  const flat: Terrain = { h: new Array(11).fill(0), ice: [], drag: 0, brake: 50, fade: false, v0: 40, target: 70 };
  it('braking on flat ground matches v²/(2a)', () => {
    const d = stopFrom(flat, 0);
    expect(d).toBeCloseTo((40 * 40) / (2 * (50 + 1.2)), 0);
  });
  it('ice weakens the brake; a later brake stops further', () => {
    const icy = { ...flat, ice: [[0, 100]] as [number, number][] };
    expect(stopFrom(icy, 0)).toBeGreaterThan(stopFrom(flat, 0));
    expect(stopFrom(flat, 20)).toBeGreaterThan(stopFrom(flat, 10));
  });
  it('the object never moves backwards and holds at rest', () => {
    let s = { x: 0, v: 5, heat: 0 };
    for (let i = 0; i < 5000; i++) {
      const n = brakeStep(flat, s, true);
      expect(n.x).toBeGreaterThanOrEqual(s.x);
      s = n;
    }
    expect(s.v).toBe(0);
  });
  it('generated tracks are solvable: the ideal single brake stops on the line', () => {
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 6)) {
        for (const t of makeBrake(s, l)) {
          const on = idealOnset(t);
          // The onset is resolved to one 0.5 ms step (≈0.03 u at speed).
          expect(Math.abs(stopFrom(t, on) - t.target)).toBeLessThan(0.06);
        }
      }
  });
});

describe('Pendulum Catch: exact pendulum', () => {
  it('the exact period approaches the small-angle formula for small swings and exceeds it for large ones', () => {
    expect(exactPeriod(1, 0.01) / smallAnglePeriod(1)).toBeCloseTo(1, 4);
    // Known value: T(90°)/T₀ = 1.18034…
    expect(exactPeriod(1, Math.PI / 2) / smallAnglePeriod(1)).toBeCloseTo(1.18034, 4);
  });
  it('the RK4 simulation reproduces the exact period to within 2 ms', () => {
    for (const amp of [20, 60, 100]) {
      const th0 = (amp * Math.PI) / 180;
      const th = simulate(1.2, th0, 10);
      const xs = crossings(th, 0, -1);
      expect(xs.length).toBeGreaterThanOrEqual(2);
      expect(Math.abs(xs[1] - xs[0] - exactPeriod(1.2, th0))).toBeLessThan(0.002);
    }
  });
  it('a catch exactly at a crossing scores 0; direction is respected', () => {
    for (const rd of makePendulum(SEEDS[2], 'medium')) {
      const th = simulate(rd.L, rd.th0);
      const xs = crossings(th, rd.target, rd.dir).filter((x) => x > 0.25);
      expect(catchError(rd, th, xs[1]).err).toBeLessThan(1e-6);
      expect(catchError(rd, th, xs[1] + 0.05).signedErr).toBeCloseTo(50, 6);
    }
  });
});


describe('Settings and records', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  it('old or hand-edited settings load safely with the new keys defaulted', async () => {
    localStorage.setItem('eps:settings', JSON.stringify({ sound: false, volume: 7, textSize: 'huge' }));
    const { settings } = await import('../src/core/settings');
    expect(settings.sound).toBe(false);
    expect(settings.volume).toBe(1);
    expect(settings.textSize).toBe('normal');
    expect(settings.noFlash).toBe(false);
    expect(settings.sensitivity).toBe('normal');
  });
  it('backups keep records with a mode and an input condition', async () => {
    const { importAll, journal } = await import('../src/core/records');
    const data = { app: 'epsilon', v: 2, data: { 'eps:rec:letterfall~fast~touch': { runs: [{ s: 31, t: 1, k: 'ranked' }], n: 1, best: 31 } } };
    expect(importAll(JSON.stringify(data))).toBe(1);
    expect(journal().some((r) => r.recordId === 'letterfall~fast~touch')).toBe(true);
  });
});

describe('Generators never come up short', () => {
  it('every level of every retrying generator delivers its full set of rounds', () => {
    const want: Record<Level, number> = { easy: 4, medium: 5, hard: 5 };
    for (const l of LEVELS)
      for (const s of SEEDS.slice(0, 40)) {
        expect(makeBrake(s, l)).toHaveLength(3);
        expect(makeVessels(s, l)).toHaveLength(want[l]);
        expect(makeQuantity(s, l)).toHaveLength(6);
        expect(makeRules(s, l)).toHaveLength(4);
      }
  }, 120000);
});

describe('Volume helpers (shared)', () => {
  it('a cylinder is linear; a cone holds half its volume at ∛½ of its height', () => {
    const cyl = revolveTable(() => 10, 70);
    expect(cyl.total).toBeCloseTo(Math.PI * 100 * 70, 0);
    expect(levelFor(cyl, cyl.total / 2)).toBeCloseTo(35, 2);
    const cone = revolveTable((y) => (y / 70) * 20, 70);
    expect(levelFor(cone, cone.total / 2)).toBeCloseTo(70 * Math.cbrt(0.5), 1);
    for (const h of [3, 17.5, 40, 66]) expect(levelFor(cone, volumeAt(cone, h))).toBeCloseTo(h, 4);
  });
});
