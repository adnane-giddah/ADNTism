// The twelve cognitive games (41–52): the variation scheduler, and for every game many seeded challenges
// over its whole band range — each must generate in bounded time, satisfy its declared constraints, have
// a valid solution that the game's own evaluator accepts, and keep its free parameters actually varying.
import { describe, expect, it } from 'vitest';
import { rng } from '../src/core/rng';
import { chooseFamily, emptyHistory, generate, nextBand, pushHistory, type Band, type Family } from '../src/games/lab';
import * as fovea from '../src/games/fovea';
import * as alias from '../src/games/alias';
import * as lag from '../src/games/lag';
import * as fold from '../src/games/fold';
import * as look from '../src/games/lastlook';
import * as cks from '../src/games/checksum';
import * as desc from '../src/games/descent';
import * as proj from '../src/games/projection';
import * as jnd from '../src/games/jnd';
import * as regime from '../src/games/regime';
import * as bif from '../src/games/bifurcation';
import * as cp from '../src/games/counterpoint';
import { byId, games } from '../src/games/registry';
import { previews } from '../src/pages/previews';

const seeds = (n: number, salt = 1) => Array.from({ length: n }, (_, i) => (rng(i * 7919 + salt).next() * 0xffffffff) >>> 0);

/** Every family, every band it allows, many seeds: generation never fails and the check passes. */
function sweep<R>(fams: Family<R>[], n: number, check: (rd: R, fam: string, band: Band) => void) {
  for (const f of fams)
    for (let b = f.bands[0]; b <= f.bands[1]; b++)
      for (const s of seeds(n, b + 31 * f.id.length)) {
        const g = generate(f, b as Band, emptyHistory(), rng(s));
        check(g.rd, f.id, g.band);
      }
}

describe('variation scheduler', () => {
  const fams: Family<number>[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: id, teach: '', bands: [0, 3], gen: (r) => r.int(0, 1000) + i * 0, sig: (x) => String(x) }));
  it('never repeats the previous family when another is eligible, and stays balanced', () => {
    let h = emptyHistory();
    const r = rng(5);
    const count: Record<string, number> = {};
    let prev = '';
    for (let i = 0; i < 500; i++) {
      const f = chooseFamily(fams, 1, h, r);
      expect(f.id).not.toBe(prev);
      prev = f.id;
      count[f.id] = (count[f.id] ?? 0) + 1;
      h = pushHistory(h, f.id, String(i));
    }
    for (const id of 'abcde') expect(count[id]).toBeGreaterThan(80); // 100 ± 20
    for (const id of 'abcde') expect(count[id]).toBeLessThan(120);
  });
  it('respects band eligibility and falls back when none is eligible', () => {
    const mixed: Family<number>[] = [
      { ...fams[0], bands: [0, 1] },
      { ...fams[1], bands: [2, 3] },
    ];
    for (let i = 0; i < 50; i++) expect(chooseFamily(mixed, 3, emptyHistory(), rng(i)).id).toBe('b');
  });
  it('avoids configurations seen recently, with a bounded fallback', () => {
    const f: Family<number> = { id: 'x', name: 'x', teach: '', bands: [0, 0], gen: (r) => r.int(0, 3), sig: String };
    let h = emptyHistory();
    for (const v of [0, 1, 2]) h = pushHistory(h, 'x', String(v));
    for (let i = 0; i < 40; i++) expect(generate(f, 0, h, rng(i)).rd).toBe(3);
    h = pushHistory(h, 'x', '3');
    expect(() => generate(f, 0, h, rng(1))).not.toThrow(); // everything seen: fall back, never hang
  });
  it('adapts the band within the level, up after a clean round and down after a poor one', () => {
    expect(nextBand(1, 0.05, [1, 2])).toBe(2);
    expect(nextBand(2, 0.05, [1, 2])).toBe(2);
    expect(nextBand(2, 0.8, [1, 2])).toBe(1);
    expect(nextBand(1, 0.8, [1, 2])).toBe(1);
    expect(nextBand(1, 0.4, [1, 2])).toBe(1);
  });
});

describe('registry integration', () => {
  const ids = ['fovea', 'alias', 'lag', 'fold', 'lastlook', 'checksum', 'descent', 'projection', 'jnd', 'regime', 'bifurcation', 'counterpoint'];
  it('all twelve are registered in order 41–52, with previews, stars and loaders', async () => {
    ids.forEach((id, i) => {
      const g = byId(id)!;
      expect(g, id).toBeDefined();
      expect(g.no).toBe(String(41 + i));
      expect(previews[id], id).toBeTypeOf('function');
      expect(g.stars).toBeDefined();
    });
    expect(new Set(games.map((g) => g.id)).size).toBe(games.length);
    for (const id of ids) expect(typeof (await byId(id)!.load()).default).toBe('function');
  });
  it('every game has at least five real variation families', () => {
    for (const fams of [fovea.FAMILIES, alias.FAMILIES, lag.FAMILIES, fold.FAMILIES, look.FAMILIES, cks.FAMILIES, desc.FAMILIES, proj.FAMILIES, jnd.FAMILIES, regime.FAMILIES, bif.FAMILIES, cp.FAMILIES]) {
      expect(fams.length).toBeGreaterThanOrEqual(5);
      expect(fams.filter((f) => f.intro)).toHaveLength(1);
      expect(fams.some((f) => f.bands[0] === 0)).toBe(true);
    }
  });
});

describe('Fovea', () => {
  it('the target exists, is the only match, and is not given away by the low-detail field', () => {
    const where = new Set<string>();
    sweep(fovea.FAMILIES, 40, (rd) => {
      for (const it of [...rd.items, ...(rd.items2 ?? [])]) {
        expect(it.x).toBeGreaterThanOrEqual(0);
        expect(it.y).toBeGreaterThanOrEqual(0);
        expect(it.y).toBeLessThanOrEqual(fovea.FH);
      }
      if (rd.kind === 'target' || rd.kind === 'clues' || rd.kind === 'multi') {
        const fit = rd.items.map((_, i) => i).filter((i) => fovea.fits(rd.items[i], rd.want!));
        expect(fit).toEqual(rd.answer);
      }
      if (rd.kind === 'target') {
        const t = rd.items[rd.answer[0]];
        expect(rd.items.filter((x) => x.tint === t.tint && x.big === t.big).length).toBeGreaterThanOrEqual(3);
        where.add(`${Math.floor(t.x / 0.54)}${Math.floor(t.y / 0.34)}`);
      }
      if (rd.kind === 'clues') for (const c of rd.clues!) expect(rd.items.filter((x) => fovea.fits(x, { [c.key]: rd.want![c.key] })).length).toBeGreaterThanOrEqual(3);
      if (rd.kind === 'compare') {
        const diffs = rd.items.map((x, i) => (JSON.stringify(x) !== JSON.stringify(rd.items2![i]) ? i : -1)).filter((i) => i >= 0);
        expect(diffs).toEqual(rd.answer);
      }
    });
    expect(where.size).toBeGreaterThanOrEqual(8); // target location is not fixed
  });
  it('comparison rounds are sometimes identical and sometimes not', () => {
    const f = fovea.FAMILIES.find((x) => x.id === 'compare')!;
    const kinds = seeds(60).map((s) => generate(f, 1, emptyHistory(), rng(s)).rd.answer.length);
    expect(kinds).toContain(0);
    expect(kinds).toContain(1);
  });
});

describe('Alias', () => {
  it('samples come from the signal; every observationally equivalent candidate is marked correct', () => {
    sweep(alias.FAMILIES, 40, (rd) => {
      if (rd.ys.length) expect(alias.maxDev(rd.truth, rd.fs, rd.ys)).toBeLessThanOrEqual(rd.noise + 1e-9);
      if (rd.kind === 'identify') {
        rd.cands!.forEach((c, i) => expect(rd.ok![i]).toBe(alias.maxDev(c, rd.fs, rd.ys) <= rd.noise + 1e-6));
        expect(rd.ok!.some(Boolean)).toBe(true);
      }
      if (rd.kind === 'freqs') {
        rd.chips!.forEach((f, i) => {
          expect(rd.ok![i]).toBe(alias.isAlias(f, rd.truth.f, rd.fs) || alias.isAlias(f, Math.abs(alias.apparentRate(rd.truth.f, rd.fs, 1)), rd.fs));
          if (!rd.ok![i]) expect(alias.fitFreq(f, rd.fs, rd.ys).rms).toBeGreaterThan(rd.noise);
          else if (!rd.noise) expect(alias.fitFreq(f, rd.fs, rd.ys).max).toBeLessThan(1e-6);
        });
      }
      if (rd.kind === 'resample') {
        const [a, b] = rd.pair!;
        expect(alias.maxDev(b, rd.fs, alias.sample(a, rd.fs, 0))).toBeLessThan(1e-9); // identical at the old rate
        expect(rd.ok!.some(Boolean)).toBe(true);
        expect(rd.ok!.some((x) => !x)).toBe(true);
      }
      if (rd.kind === 'wheel') {
        const w = rd.wheel!;
        if (w.inverse) w.options.forEach((x, i) => expect(w.ok[i]).toBe(Math.abs(alias.apparentRate(x, rd.fs, w.spokes) - w.apparent) < 0.06));
        else expect(w.ok.filter(Boolean)).toHaveLength(1);
      }
      if (rd.kind === 'recon') {
        // The slowest fit is unique and passes through every sample.
        const fa = Math.abs(alias.apparentRate(rd.truth.f, rd.fs, 1));
        expect(fa).toBeLessThan(rd.fs / 2);
        expect(alias.fitFreq(fa, rd.fs, rd.ys).max).toBeLessThan(1e-6);
      }
    });
  });
});

describe('Lag', () => {
  it('applies each command exactly D steps later, in order', () => {
    const spec = lag.FAMILIES[0].gen(rng(3), 1)!;
    const sim = new lag.LagSim(spec);
    const D = sim.D;
    const applied: number[] = [];
    for (let i = 0; i < D + 40; i++) {
      sim.advance([i >= 10 && i < 20 ? 1 : 0, 0]);
      applied.push(sim.hist[sim.step - 1 - D]?.[0] ?? 0);
    }
    expect(applied.indexOf(1)).toBe(10 + D);
    expect(applied.lastIndexOf(1)).toBe(19 + D);
  });
  it('every generated system is controllable', () => {
    sweep(lag.FAMILIES, 40, (s) => {
      expect(s.tau).toBeGreaterThan(0.15);
      if (s.kind === 'brake') expect(lag.stopDist(s.v0!, s.decel!, s.tau)).toBeLessThan(s.line!);
      if (s.kind === 'stabilize') expect(s.lambda! * s.tau).toBeLessThanOrEqual(0.6 + 1e-9);
      if (s.kind === 'reach') {
        expect(Math.abs(s.target!.x)).toBeLessThanOrEqual(0.85);
        expect(Math.abs(s.target!.y)).toBeLessThanOrEqual(0.85);
      }
      if (s.kind === 'steer') for (let i = 1; i < s.gates!.length; i++) expect(Math.abs(s.gates![i].y - s.gates![i - 1].y)).toBeLessThanOrEqual(0.35);
    });
  });
  it('a perfectly delay-aware brake stops on the line', () => {
    const s = lag.FAMILIES.find((f) => f.id === 'brake')!.gen(rng(9), 2)!;
    // Press when the remaining distance equals the delayed stopping distance.
    const sim = new lag.LagSim(s);
    let pressed = false;
    for (let i = 0; i < 4000 && (sim.vx > 0 || sim.step < 2); i++) {
      if (!pressed && s.line! - sim.x <= lag.stopDist(s.v0!, s.decel!, s.tau)) pressed = true;
      sim.advance([pressed ? 1 : 0, 0]);
    }
    expect(Math.abs(sim.x - s.line!)).toBeLessThan(0.02);
  });
});

describe('Fold', () => {
  it('the transformation model reproduces every target; the witness procedure fits the limits', () => {
    let offCentre = 0;
    sweep(fold.FAMILIES, 12, (rd, _f, band) => {
      const s = fold.foldSeq(rd.N, rd.folds)!;
      expect(s).not.toBeNull();
      expect([...fold.holesOf(s, rd.punches)].sort((a, b) => a - b)).toEqual(rd.target);
      if (rd.minOps) {
        expect(rd.minOps).toBeLessThan(rd.target.length); // folding must save punches
        expect(rd.punches.length).toBeLessThanOrEqual(rd.maxPunches);
      }
      for (const f of rd.folds) expect(rd.allowed).toContain(f.d);
      if (band >= 2) expect(rd.N).toBe(8);
      offCentre += rd.folds.filter((f, i) => f.d !== 'D' && f.d !== 'A' && f.c !== fold.midCrease(fold.foldSeq(rd.N, rd.folds.slice(0, i))!, f.d)).length;
    });
    expect(offCentre).toBeGreaterThan(50); // off-centre creases really occur
  }, 120000);
  it('a fold is a reflection across any crease; overhanging flaps extend the sheet', () => {
    const s = fold.newSheet(6);
    for (const d of ['L', 'R', 'T', 'B'] as fold.Dir[])
      for (const c of fold.creases(s, d))
        for (const p of s.pos) {
          const q = fold.foldPoint(s, { d, c }, p);
          // Moved points land on the staying side, and folding them again leaves them there.
          expect(fold.foldPoint(s, { d, c }, q)).toEqual(q);
          const v = d === 'L' || d === 'R' ? 'x' : 'y';
          expect(Math.abs(q[v] - c)).toBe(Math.abs(p[v] - c));
        }
    // Folding the left 5 columns of 6 over line 5 carries cells out to x = 10.
    const t = fold.applyFold(s, { d: 'L', c: 5 });
    expect(fold.bbox(t)).toMatchObject({ x0: 5, x1: 10, w: 5 });
    expect(Math.max(...[...fold.fibres(t).values()].map((f) => f.length))).toBe(2);
  });
  it('the minimum search finds the classic two-fold, one-punch pattern', () => {
    // Four holes mirrored in both midlines of a 4 × 4 sheet: 2 folds + 1 punch.
    const target = new Set([5, 6, 9, 10]);
    expect(fold.minOps(4, target, fold.DIRS, 2)!.ops).toBe(3);
  });
});

describe('Last Look', () => {
  it('the optimal policy has zero regret; the forced last offer costs nothing', () => {
    sweep(look.FAMILIES, 30, (rd) => {
      const N = rd.vals.length;
      // Play the reference policy: accept when accepting is at least as good as passing.
      let at = N - 1;
      for (let k = 0; k < N - 1; k++) {
        const a = look.actionValues(rd, k, rd.vals);
        if (a.accept >= a.pass) {
          at = k;
          break;
        }
      }
      expect(look.regretOf(rd, at).reg).toBeCloseTo(0, 9);
      expect(look.regretOf(rd, N - 1).per[N - 1]).toBe(0);
    });
  });
  it('the secretary values match the classical ≈ 1/e result', () => {
    expect(look.secretaryV(10)[0]).toBeCloseTo(0.3987, 3);
    expect(look.secretaryV(100)[0]).toBeCloseTo(0.371, 2);
  });
  it('the position of the best offer is not biased', () => {
    const f = look.FAMILIES.find((x) => x.id === 'best')!;
    const pos = Array(18).fill(0);
    for (const s of seeds(900)) {
      const rd = generate(f, 3, emptyHistory(), rng(s)).rd;
      pos[rd.vals.indexOf(Math.max(...rd.vals))]++;
    }
    for (const n of pos) expect(n).toBeGreaterThan(25); // ≈ 50 each
  });
});

describe('Checksum', () => {
  it('every corruption pattern has exactly one repair under the given checks', () => {
    sweep(cks.FAMILIES, 25, (rd) => {
      if (rd.kind === 'single') {
        const e = rd.shown.findIndex((v, i) => v !== rd.orig[i]);
        const r = Math.floor(e / rd.C);
        const c = e % rd.C;
        for (let i = 0; i < rd.R; i++) expect(cks.rowSum(rd.shown as number[], rd.C, i) % 2 === 1).toBe(i === r);
        for (let j = 0; j < rd.C; j++) expect(cks.colSum(rd.shown as number[], rd.R, rd.C, j) % 2 === 1).toBe(j === c);
      }
      if (rd.kind === 'counts') {
        const reps = cks.countRepairs(rd.shown as number[], rd.R, rd.C, rd.rowT!, rd.colT!, rd.k);
        expect(reps).toHaveLength(1);
        expect(reps[0]).toEqual(rd.shown.map((v, i) => (v !== rd.orig[i] ? i : -1)).filter((i) => i >= 0));
      }
      if (rd.kind === 'hamming') {
        const e = rd.shown.findIndex((v, i) => v !== rd.orig[i]);
        expect(cks.syndrome(rd.shown as number[])).toBe(e + 1);
      }
      if (rd.kind === 'erasure') {
        const s = cks.solveErasures(rd.shown, rd.R, rd.C);
        expect(s.count).toBe(1);
        s.unk!.forEach((cell, k) => expect(s.sol![k]).toBe(rd.orig[cell]));
      }
      if (rd.kind === 'mixed') expect(cks.mixedSolutions(rd.shown, rd.R, rd.C)).toBe(1);
      if (rd.kind === 'digits') expect(cks.digitRepairs(rd.shown as number[], rd.R, rd.C, rd.rowT!, rd.colT!, rd.k)).toHaveLength(1);
    });
  });
});

describe('Descent', () => {
  it('the declared global minimum is the true one (finer grid), unique by a margin', () => {
    sweep(desc.FAMILIES, 15, (rd) => {
      const N = rd.land.dim === 1 ? 6000 : 300;
      let lo = Infinity;
      if (rd.land.dim === 1) for (let i = 0; i <= N; i++) lo = Math.min(lo, desc.fOf(rd.land, [i / N]));
      else for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) lo = Math.min(lo, desc.fOf(rd.land, [i / N, j / N]));
      expect(rd.fBest).toBeLessThanOrEqual(lo + 1e-6);
      expect(desc.descentPen(rd, rd.best).pen).toBe(0);
      // Committing at any other local minimum is clearly penalised.
      for (const m of desc.minima(rd.land).mins.slice(1)) if (Math.hypot(...m.p.map((v, i) => v - rd.best[i])) > 0.05) expect(desc.descentPen(rd, m.p).pen).toBeGreaterThan(0.3);
    });
  });
});

describe('Projection', () => {
  it('targets satisfy their own views; minimum, forbidden and ambiguity rounds are consistent', () => {
    let floating = 0;
    sweep(proj.FAMILIES, 15, (rd, _f, band) => {
      const n = rd.n;
      expect(proj.violations(rd, rd.target)).toEqual([]);
      if (rd.kind === 'minimum') expect(rd.minCubes).toBeLessThan(proj.count(rd.target));
      if (rd.kind === 'forbidden') for (const i of rd.forbidden!) expect(rd.target[i]).toBe(0);
      if (rd.kind === 'ambiguity') {
        const a = proj.views(rd.target, n);
        const b = proj.views(rd.other!, n);
        expect(b).toEqual(a);
        expect(rd.other).not.toEqual(rd.target);
        expect(rd.probes!.filter((p) => p.ok)).toHaveLength(1);
        expect(rd.probes!).toHaveLength(4);
      }
      if (band >= 1)
        for (let i = n * n; i < rd.target.length; i++) if (rd.target[i] && !rd.target[i - n * n]) floating++;
    });
    expect(floating).toBeGreaterThan(50); // overhangs and floating cubes really occur
  }, 120000);
  it('the exact minimum matches brute force on small structures', () => {
    const r = rng(11);
    for (let k = 0; k < 15; k++) {
      const n = 3;
      const t = Array.from({ length: 27 }, () => (r.next() < 0.35 ? 1 : 0));
      const al = proj.allowed(t, n);
      if (al.length > 16) continue;
      let best = Infinity;
      for (let m = 0; m < 1 << al.length; m++) {
        const v = Array(27).fill(0);
        al.forEach((i, j) => ((m >> j) & 1 ? (v[i] = 1) : 0));
        if (JSON.stringify(proj.views(v, n)) === JSON.stringify(proj.views(t, n))) best = Math.min(best, proj.count(v));
      }
      expect(proj.minimumCubes(t, n)).toBe(best);
    }
  });
});

describe('JND', () => {
  it('2-down / 1-up: two right make it harder, one wrong makes it easier', () => {
    let s = jnd.newStair('length');
    const d0 = s.delta;
    s = jnd.stairStep(s, true);
    expect(s.delta).toBe(d0);
    s = jnd.stairStep(s, true);
    expect(s.delta).toBeLessThan(d0);
    const d1 = s.delta;
    s = jnd.stairStep(s, false);
    expect(s.delta).toBeGreaterThan(d1);
    expect(s.reversals).toHaveLength(1);
  });
  it('the correct side is balanced and never runs more than three', () => {
    for (const sd of seeds(200)) {
      const sides = jnd.balancedSides(rng(sd), 11);
      expect(Math.abs(sides.filter((x) => x === 0).length - sides.filter((x) => x === 1).length)).toBeLessThanOrEqual(1);
      expect(sides.join('')).not.toMatch(/0000|1111/);
    }
  });
  it('plans interleave distinct types, and types rotate between runs', () => {
    let h = emptyHistory();
    const seen = new Set<string>();
    for (const sd of seeds(12)) {
      const { plan, hist } = jnd.makePlan(sd, 'medium', h);
      h = hist;
      expect(new Set(plan.specs.map((s) => s.type)).size).toBe(plan.specs.length);
      plan.specs.forEach((_, i) => expect(plan.order.filter((x) => x === i)).toHaveLength(12));
      plan.specs.forEach((sp) => seen.add(sp.type));
    }
    expect(seen.size).toBe(6);
  });
  it('a simulated observer with a known threshold is estimated near it', () => {
    const r = rng(77);
    let s = jnd.newStair('length');
    for (let i = 0; i < 60; i++) {
      // Psychometric function: 50% at tiny differences, rising to 100%, 75% at 0.04.
      const p = 0.5 + 0.5 * (1 - Math.exp(-((s.delta / 0.04) ** 2) * Math.LN2));
      s = jnd.stairStep(s, r.next() < p);
    }
    expect(jnd.threshold(s)).toBeGreaterThan(0.02);
    expect(jnd.threshold(s)).toBeLessThan(0.08);
  });
});

describe('Regime', () => {
  it('change points are scheduled fairly with enough evidence', () => {
    const lens = new Set<number>();
    sweep(regime.FAMILIES, 30, (rd) => {
      expect(rd.segs[0].len).toBeGreaterThanOrEqual(8);
      for (let i = 1; i < rd.segs.length; i++) {
        expect(rd.segs[i].rule.map.join()).not.toBe(rd.segs[i - 1].rule.map.join());
        expect(rd.segs[i].len).toBeGreaterThanOrEqual(8);
      }
      lens.add(rd.segs[0].len);
      if (rd.lieRate) expect(rd.lieRate).toBeLessThanOrEqual(0.2);
    });
    expect(lens.size).toBeGreaterThanOrEqual(5); // the first change is not always at the same trial
  });
  it('scoring separates slow adaptation from isolated slips', () => {
    const rd = regime.FAMILIES.find((f) => f.id === 'reversal')!.gen(rng(3), 1)!;
    const n = rd.stims.length;
    const c = rd.segs[0].len;
    const perfect = Array.from({ length: n }, (_, t) => !(t === c)); // one error right at the change
    const slow = Array.from({ length: n }, (_, t) => !(t >= c && t < c + 7));
    const slip = Array.from({ length: n }, (_, t) => !(t === c + 10 || t === 5 || t === c));
    const a = regime.analyse(rd, perfect);
    const b = regime.analyse(rd, slow);
    const d = regime.analyse(rd, slip);
    expect(a.delays[0]).toBe(1);
    expect(b.delays[0]).toBe(7);
    expect(b.pen).toBeGreaterThan(a.pen);
    expect(d.slips).toBe(2);
    expect(d.delays[0]).toBe(1);
  });
});

describe('Bifurcation', () => {
  it('classifies known logistic behaviour and locates known transitions', () => {
    expect(bif.classify('logistic', 2.8).period).toBe(1);
    expect(bif.classify('logistic', 3.2).period).toBe(2);
    expect(bif.classify('logistic', 3.5).period).toBe(4);
    expect(bif.classify('logistic', 3.835).period).toBe(3);
    expect(bif.isChaotic(bif.classify('logistic', 3.9))).toBe(true);
    expect(bif.boundary('logistic', 1, 2.9, 3.1)).toBeCloseTo(3, 2);
    expect(Math.abs(bif.boundary('logistic', 2, 3.2, 3.5) - (1 + Math.sqrt(6)))).toBeLessThan(0.003);
    expect(bif.boundary('ricker', 1, 1.8, 2.2)).toBeCloseTo(2, 2);
  });
  it('every task is solvable with the generated intervals and tolerances', () => {
    sweep(bif.FAMILIES, 12, (rd) => {
      if (rd.kind === 'stable') {
        const r = 1 / (1 - rd.level!);
        expect(r).toBeGreaterThan(rd.lo);
        expect(r).toBeLessThan(3);
        expect(Math.abs(bif.classify('logistic', r).pts[0] - rd.level!)).toBeLessThan(rd.levelTol!);
      }
      if (rd.kind === 'cycle') {
        const w = rd.wins![0];
        expect(bif.classify(rd.model, (w.lo + w.hi) / 2).period).toBe(rd.period);
      }
      if (rd.kind === 'robust') {
        const w = rd.wins![0];
        const mid = (w.lo + w.hi) / 2;
        for (const x of [mid - rd.delta!, mid, mid + rd.delta!]) expect(bif.classify(rd.model, x).period).toBe(rd.period);
      }
      if (rd.kind === 'edge') {
        expect(bif.classify(rd.model, rd.edge! - 0.01).period).toBe(rd.from);
        expect(bif.classify(rd.model, rd.edge! + 0.01).period).not.toBe(rd.from);
      }
      if (rd.kind === 'sensitive') expect([0, 1, 2, 3]).toContain(rd.answer);
    });
  });
});

describe('Counterpoint', () => {
  it('generated machines have valid, non-trivial solutions that need the shared gates', () => {
    sweep(cp.FAMILIES, 20, (rd) => {
      expect(rd.solutions.length).toBeGreaterThan(0);
      for (const s of rd.solutions) {
        const o = cp.simulate(rd.m, s);
        expect(cp.meets(rd.m, rd.goal, o)).toBe(true);
        expect(o.interact).toBe(true);
      }
      const all = cp.configs(rd.m);
      expect(rd.solutions.length).toBeLessThan(all.length);
      // Every configuration that works is listed (so any of them is accepted).
      expect(all.filter((c) => cp.meets(rd.m, rd.goal, cp.simulate(rd.m, c))).length).toBe(rd.solutions.length);
      if (rd.kind === 'minimal') expect(rd.minFlips).toBeGreaterThan(0);
    });
  });
  it('A follows and flips, B goes against and leaves the gate', () => {
    const m: cp.Machine = { gates: [{ out: [-1, -2], layer: 0, col: 0 }], bins: 2, srcA: 0, srcB: 0, order: ['A', 'B', 'A', 'B'] };
    const o = cp.simulate(m, [0]);
    expect(o.out.map((t) => t.bin)).toEqual([0, 0, 1, 1]);
    expect(o.final).toEqual([0]);
  });
});
