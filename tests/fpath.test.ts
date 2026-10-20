import { describe, expect, it } from 'vitest';
import { evalAt, evalI, ops, parse, ParseError, validate, type FLevel } from '../src/games/fexpr';
import { course, courseCount, LEVELS, pickLevels, startFormula } from '../src/games/fpath';
import { generateLevel, GENERATED } from '../src/games/fpgen';

const at = (s: string, x: number, P = {}) => evalAt(parse(s), x, P);

describe('expression language', () => {
  it('respects precedence and associativity', () => {
    expect(at('1 + 2 * 3', 0)).toBe(7);
    expect(at('2^3^2', 0)).toBe(512);
    expect(at('-x^2', 3)).toBe(-9);
    expect(at('2^-1', 0)).toBe(0.5);
    expect(at('1/2x', 4)).toBe(2); // (1/2)·x
    expect(at('(x+1)(x-1)', 3)).toBe(8);
    expect(at('2x^2', 3)).toBe(18);
    expect(at('3sin(0)+cos(0)', 0)).toBe(1);
  });
  it('supports constants, parameters, abs bars, composition and piecewise', () => {
    expect(at('pi', 0)).toBeCloseTo(Math.PI);
    expect(at('e^(-x^2)', 0)).toBe(1);
    expect(at('ax + b', 2, { a: 3, b: 1 })).toBe(7);
    expect(at('|x^2 - 1|', 0)).toBe(1);
    expect(at('2|x|', -3)).toBe(6);
    expect(at('sin(x^2)', 2)).toBeCloseTo(Math.sin(4));
    expect(at('(x^2+1)/(x^2+2)', 0)).toBe(0.5);
    expect(at('x < 0 ? -1 : 1', -2)).toBe(-1);
    expect(at('x < 0 ? -1 : x < 2 ? 0 : 1', 1)).toBe(0);
    expect(at('log(100)', 0)).toBeCloseTo(2);
    expect(at('log(8, 2)', 0)).toBeCloseTo(3);
    expect(at('root(-8, 3)', 0)).toBeCloseTo(-2);
    expect(at('min(x, 2, 5)', 9)).toBe(2);
    expect(at('2πx', 1)).toBeCloseTo(2 * Math.PI);
  });
  it('makes domain violations undefined, never a number', () => {
    expect(at('1/x', 0)).toBeNaN();
    expect(at('sqrt(x)', -1)).toBeNaN();
    expect(at('ln(x)', 0)).toBeNaN();
    expect(at('log(x)', -2)).toBeNaN();
    expect(at('x^0.5', -4)).toBeNaN();
    expect(at('root(x, 2)', -4)).toBeNaN();
    expect(at('asin(2)', 0)).toBeNaN();
    expect(at('exp(1000)', 0)).toBeNaN();
    expect(at('(-8)^(1/3)', 0)).toBeNaN(); // a real cube root is cbrt or root(x, 3)
  });
  it('rejects malformed input with useful messages', () => {
    for (const s of ['', '2 +', '(x', 'sin x', 'foo(x)', 'x <', 'x < 1', '1 ? 2 : 3', 'sin()', 'root(x)', '|x', '3 $ 4', 'xsin(x)'])
      expect(() => parse(s), s).toThrow(ParseError);
  });
  it('counts operations', () => {
    expect(ops(parse('x'))).toBe(0);
    expect(ops(parse('x^3/32 - x/2'))).toBe(4);
    expect(ops(parse('x < 0 ? -2 : 2'))).toBe(3);
  });
});

describe('interval evaluation', () => {
  it('encloses the true range and flags poles', () => {
    const n = parse('sin(x) + x^2');
    for (const [a, b] of [
      [-1, 2],
      [0.3, 0.31],
      [-5, -4],
    ]) {
      const I = evalI(n, a, b, {});
      for (let i = 0; i <= 200; i++) {
        const y = evalAt(n, a + ((b - a) * i) / 200, {});
        expect(y).toBeGreaterThanOrEqual(I.lo - 1e-12);
        expect(y).toBeLessThanOrEqual(I.hi + 1e-12);
      }
      expect(I.cont).toBe(true);
    }
    expect(evalI(parse('1/x'), -1, 1, {}).cont).toBe(false);
    expect(evalI(parse('tan(x)'), 1, 2, {}).cont).toBe(false);
    expect(evalI(parse('sqrt(x)'), -2, -1, {}).def).toBe(2);
    expect(evalI(parse('sqrt(x)'), -1, 1, {}).def).toBe(1);
    expect(evalI(parse('x < 0 ? 1 : 2'), -1, 1, {}).cont).toBe(false);
    expect(evalI(parse('x < 0 ? 1 : 2'), 0.5, 1, {}).cont).toBe(true);
  });
});

const box = (extra: Partial<FLevel> = {}): FLevel => ({
  id: 't',
  name: 't',
  brief: '',
  tier: 'easy',
  domain: [-5, 5],
  view: { x0: -6, x1: 6, y0: -6, y1: 6 },
  start: { x: -5, y: 0 },
  end: { x: 5, y: 0 },
  obstacles: [],
  ref: '0',
  ...extra,
});

describe('validator', () => {
  it('checks endpoints with the stated tolerance', () => {
    expect(validate(box(), '0').ok).toBe(true);
    expect(validate(box(), '0.04').ok).toBe(true);
    expect(validate(box(), '0.06').ok).toBe(false);
  });
  it('finds a collision that coarse sampling misses', () => {
    // A needle of width 0.002 between sample points of a 1000-sample scan of [-5, 5] (spacing 0.01).
    const lv = box({ obstacles: [{ kind: 'rect', x0: 0.0031, y0: -1, x1: 0.0051, y1: 1 }] });
    for (let i = 0; i <= 1000; i++) {
      const x = -5 + i * 0.01;
      expect(x > 0.0031 && x < 0.0051).toBe(false);
    }
    const v = validate(lv, '0');
    expect(v.ok).toBe(false);
    expect(v.collisions.length).toBeGreaterThan(0);
  });
  it('counts touching the boundary as a collision', () => {
    const lv = box({ obstacles: [{ kind: 'circle', cx: 0, cy: 2, r: 1 }] });
    expect(validate(lv, '0').ok).toBe(true);
    expect(validate(lv, '0.04(25 - x^2)').ok).toBe(false); // f(0) = 1: touches the circle's bottom
    expect(validate(lv, '0.03(25 - x^2)').ok).toBe(true); // f(0) = 0.75
  });
  it('accepts alternative valid solutions and rejects invalid ones', () => {
    const lv = box({ obstacles: [{ kind: 'circle', cx: 0, cy: 0, r: 1 }] });
    for (const s of ['0.1(25 - x^2)', '-0.1(25 - x^2)', '2cos(pi x/10)', 'max(0, 2 - 0.4|x|)', 'a(25 - x^2)']) expect(validate(lv, s, { a: 0.08 }).ok, s).toBe(true);
    for (const s of ['0', 'sin(x)', '0.01(25 - x^2)']) expect(validate(lv, s).ok, s).toBe(false);
  });
  it('handles domain restrictions and discontinuities', () => {
    expect(validate(box(), 'sqrt(x)').checks.find((c) => c.name === 'defined on the domain')!.ok).toBe(false);
    // A finite jump is allowed unless the level demands continuity.
    const jump = box({ start: { x: -5, y: -1 }, end: { x: 5, y: 1 } });
    const v = validate(jump, 'x < 0 ? -1 : 1');
    expect(v.ok).toBe(true);
    expect(v.discontinuities.map((d) => d.kind)).toEqual(['jump']);
    expect(validate({ ...jump, continuous: true }, 'x < 0 ? -1 : 1').ok).toBe(false);
    // A pole is a discontinuity, and the graph through it must still avoid obstacles and the board edge.
    const pole = validate(box({ bounded: true }), '0.001/x');
    expect(pole.discontinuities.some((d) => d.kind === 'asymptote')).toBe(true);
    expect(pole.ok).toBe(false);
    // Removable: x²/x is undefined at 0 only.
    const rem = validate(box({ start: { x: -5, y: -5 }, end: { x: 5, y: 5 } }), 'x^2/x');
    expect(rem.discontinuities.some((d) => d.kind === 'removable')).toBe(true);
  });
  it('checks slopes, checkpoints and operation limits', () => {
    const lv = box({ slopes: [{ x: -5, m: 1 }], checkpoints: [{ x: 0, y: 0 }], maxOps: 3 });
    // f′(−5) = (3·25 − 25)/50 = 1 and f(0) = 0, but 4 operations > 3.
    expect(validate(lv, 'x(x^2-25)/50').ok).toBe(false);
    expect(validate({ ...lv, maxOps: 6 }, 'x(x^2-25)/50').ok).toBe(true);
    expect(validate({ ...lv, maxOps: 6 }, '0').ok).toBe(false);
  });
});

describe('levels', () => {
  it('every hand-made level is solvable by its reference and not by the straight line', () => {
    for (const lv of LEVELS) {
      const v = validate(lv, lv.ref);
      expect(v.ok, `${lv.id} ${JSON.stringify(v.checks.filter((c) => !c.ok))}`).toBe(true);
      expect(validate(lv, startFormula(lv)).ok, `${lv.id} straight`).toBe(false);
    }
  });
  it('generates solvable, non-trivial courses deterministically', () => {
    for (const tier of ['easy', 'medium', 'hard'] as const)
      for (let n = 20; n < 45; n++) {
        const lv = generateLevel(tier, n);
        expect(validate(lv, lv.ref).ok, `${tier} ${n} ${lv.ref}`).toBe(true);
        expect(validate(lv, startFormula(lv)).ok).toBe(false);
        expect(JSON.stringify(generateLevel(tier, n))).toBe(JSON.stringify(lv));
      }
  });
  it('picks three distinct courses from a large pool', () => {
    expect(courseCount('medium')).toBeGreaterThan(GENERATED);
    const ls = pickLevels(12345, 'hard');
    expect(new Set(ls.map((l) => l.name)).size).toBe(3);
    expect(course('easy', 1).name).toContain('Course 1');
  });
});
