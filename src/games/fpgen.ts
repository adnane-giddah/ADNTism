// Function Path course generator. A course is built around a hidden witness function (a random member of
// a family suited to the tier). Obstacles are then placed: "blockers" on the straight chord from start to
// end (so the obvious line fails), and "pinchers" just above or below the witness (so the corridor is
// tight). Every obstacle keeps a clearance from the witness graph. A course is accepted only if the
// validator proves the witness valid AND the straight line invalid — so every generated course is solvable,
// and not trivially. The witness is never the only answer; it is shown only after a skip.
import { rng, type Rng } from '../core/rng';
import { evalAt, fmt, obstacleDist, ops, parse, validate, type FLevel, type Obstacle, type XY } from './fexpr';

/** Courses per tier on top of the hand-made ones. */
export const GENERATED = 1000;

/** The straight line through start and end. */
export function straightFormula(lv: Pick<FLevel, 'start' | 'end'>) {
  const m = (lv.end.y - lv.start.y) / (lv.end.x - lv.start.x);
  const c = lv.start.y - m * lv.start.x;
  const mm = Math.abs(m) < 1e-9 ? '' : `${fmt(m)}x`;
  const cc = Math.abs(c) < 1e-9 ? '' : c > 0 ? `${mm ? ' + ' : ''}${fmt(c)}` : ` - ${fmt(-c)}`;
  return mm + cc || '0';
}

const q = (v: number, d = 2) => Number(v.toFixed(d));
/** "a·body" terms joined with proper signs; zero coefficients dropped. */
function terms(list: [number, string][]) {
  let s = '';
  for (const [c, body] of list) {
    if (Math.abs(c) < 1e-9) continue;
    const mag = Math.abs(c);
    const coef = body && mag === 1 ? '' : String(mag);
    const t = coef + body;
    s += s ? (c < 0 ? ` - ${t}` : ` + ${t}`) : c < 0 ? `-${t}` : t;
  }
  return s || '0';
}

type Tier = 'easy' | 'medium' | 'hard';
interface Witness {
  f: string;
  family: string;
}

function witness(r: Rng, tier: Tier, a: number): Witness {
  const m = q(r.range(-0.7, 0.7));
  const c = q(r.range(-1.5, 1.5));
  const sgn = r.sign();
  const pick = r.next();
  if (tier === 'easy') {
    const k = q((sgn * r.range(1.4, 3)) / (a * a), 3);
    return { f: terms([[m, 'x'], [c, ''], [k, `(${a * a} - x^2)`]]), family: 'parabola' };
  }
  if (tier === 'medium') {
    if (pick < 0.34) {
      const k = q((sgn * r.range(1.2, 2.4)) / ((2 * a ** 3) / (3 * Math.sqrt(3))), 4);
      return { f: terms([[m, 'x'], [c, ''], [k, `x(x^2 - ${a * a})`]]), family: 'cubic' };
    }
    if (pick < 0.68) {
      const n = r.int(1, 3);
      const A = q(sgn * r.range(1, 2));
      return { f: terms([[m, 'x'], [c, ''], [A, `sin(${n === 1 ? '' : n}pi(x + ${a})/${2 * a})`]]), family: 'sine' };
    }
    const A = q(sgn * r.range(1.5, 2.8));
    const p = q(r.range(-a * 0.5, a * 0.5), 1);
    const w = q(r.range(0.8, 2.5), 1);
    return { f: terms([[m, 'x'], [c, ''], [A, `e^(-(x ${p < 0 ? '+' : '-'} ${Math.abs(p)})^2/${w})`]]), family: 'bell' };
  }
  if (pick < 0.25) {
    const A = q(sgn * r.range(1.5, 2.8));
    const p = q(r.range(-a * 0.5, a * 0.5), 1);
    const k = q(r.range(0.8, 3), 1);
    const rest = terms([[m, 'x'], [c, '']]);
    const bump = `${A}/(1 + ${k}(x ${p < 0 ? '+' : '-'} ${Math.abs(p)})^2)`;
    return { f: rest === '0' ? bump : `${bump} ${rest.startsWith('-') ? `- ${rest.slice(1)}` : `+ ${rest}`}`, family: 'rational' };
  }
  if (pick < 0.5) {
    const A = q(sgn * r.range(1.8, 3));
    const k = q(r.range(0.6, 1.6), 1);
    return { f: terms([[A, `(1 - e^(-${k}(x + ${a})))`], [c, '']]), family: 'saturation' };
  }
  if (pick < 0.75) {
    const A = q(sgn * r.range(1, 1.8));
    const w = q(r.range(0.9, 1.6), 1);
    const k = q(r.range(0.6, 1.5), 3);
    return { f: terms([[A, `sin(${w}x)`], [k, `(x^2 - ${a * a})/${a}`], [m, 'x']]), family: 'wave+bowl' };
  }
  const A = q(sgn * r.range(0.5, 1));
  const p = q(r.range(-a * 0.5, a * 0.5), 1);
  return { f: terms([[A, `|x ${p < 0 ? '+' : '-'} ${Math.abs(p)}|`], [m, 'x'], [c, '']]), family: 'kink' };
}

const CFG: Record<Tier, { blockers: [number, number]; pinchers: [number, number]; margin: number; r: [number, number] }> = {
  easy: { blockers: [1, 2], pinchers: [0, 1], margin: 0.6, r: [0.5, 1.5] },
  medium: { blockers: [1, 2], pinchers: [2, 3], margin: 0.42, r: [0.4, 1.2] },
  hard: { blockers: [2, 3], pinchers: [2, 4], margin: 0.3, r: [0.35, 1] },
};

function shape(r: Rng, cx: number, cy: number, size: number, tier: Tier): Obstacle {
  const k = r.next();
  if (k < 0.5) return { kind: 'circle', cx: q(cx), cy: q(cy), r: q(size) };
  if (k < 0.85 || tier === 'easy') {
    const w = size * r.range(0.8, 1.6);
    const h = size * r.range(0.8, 1.6);
    return { kind: 'rect', x0: q(cx - w), y0: q(cy - h), x1: q(cx + w), y1: q(cy + h) };
  }
  const t = r.range(0, Math.PI * 2);
  const pts = [0, 1, 2].map((i) => ({ x: q(cx + size * 1.4 * Math.cos(t + (i * 2 * Math.PI) / 3)), y: q(cy + size * 1.4 * Math.sin(t + (i * 2 * Math.PI) / 3)) }));
  return { kind: 'poly', pts };
}

/** Course n of a tier (n ≥ 1). Deterministic. */
export function generateLevel(tier: Tier, n: number): FLevel {
  const r = rng(Math.imul(n, 2654435761) ^ { easy: 0x1e1, medium: 0x2e2, hard: 0x3e3 }[tier]);
  for (let attempt = 0; attempt < 200; attempt++) {
    const a = r.pick([4, 5, 6]);
    const W = witness(r, tier, a);
    const ast = parse(W.f);
    const F = (x: number) => evalAt(ast, x, {});
    const pts: XY[] = [];
    for (let i = 0; i <= 1200; i++) {
      const x = -a + (2 * a * i) / 1200;
      pts.push({ x, y: F(x) });
    }
    if (pts.some((p) => !Number.isFinite(p.y))) continue;
    const ys = pts.map((p) => p.y);
    const y0 = Math.floor(Math.min(...ys) - 2);
    const y1 = Math.ceil(Math.max(...ys) + 2);
    if (y1 - y0 > 14) continue;
    const start = { x: -a, y: q(F(-a)) };
    const end = { x: a, y: q(F(a)) };
    const cfg = CFG[tier];
    const clear = (o: Obstacle) => Math.min(...pts.map((p) => obstacleDist(o, p)));
    const keyPts = [start, end];
    const obstacles: Obstacle[] = [];
    const fits = (o: Obstacle) =>
      clear(o) >= cfg.margin &&
      keyPts.every((p) => obstacleDist(o, p) >= 0.6) &&
      obstacles.every((b) => obstacleDist(b, o.kind === 'circle' ? { x: o.cx, y: o.cy } : o.kind === 'rect' ? { x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2 } : o.pts[0]) > 0.3);
    // Blockers: on the straight chord.
    const nb = r.int(cfg.blockers[0], cfg.blockers[1]);
    for (let t = 0; t < 80 && obstacles.length < nb; t++) {
      const s = r.range(0.2, 0.8);
      const cx = start.x + (end.x - start.x) * s;
      const cy = start.y + (end.y - start.y) * s;
      const dw = Math.abs(F(cx) - cy);
      const size = Math.min(cfg.r[1] * 1.4, dw - cfg.margin - 0.1);
      if (size < cfg.r[0]) continue;
      const o = shape(r, cx, cy, size, tier);
      if (fits(o)) obstacles.push(o);
    }
    if (!obstacles.length) continue;
    // Pinchers: just above or below the witness.
    const np = r.int(cfg.pinchers[0], cfg.pinchers[1]);
    for (let t = 0, placed = 0; t < 120 && placed < np; t++) {
      const x = r.range(-a + 0.8, a - 0.8);
      const size = r.range(cfg.r[0], cfg.r[1]);
      const off = (cfg.margin + size + r.range(0.05, 0.6)) * r.sign();
      const o = shape(r, x, F(x) + off, size, tier);
      if (fits(o)) {
        obstacles.push(o);
        placed++;
      }
    }
    const lv: FLevel = {
      id: `${tier[0].toUpperCase()}${n}`,
      name: `Course ${n}`,
      tier,
      brief: `${obstacles.length} obstacles`,
      domain: [-a, a],
      view: { x0: -a - 1, x1: a + 1, y0, y1 },
      start,
      end,
      obstacles,
      bounded: true,
      ref: W.f,
    };
    // Hard extras: a slope at an end, a checkpoint, or an operation limit — all read off the witness.
    if (tier === 'hard') {
      const extra = r.int(0, 2);
      if (extra === 0) {
        const xs = r.pick([-a, a]);
        const h = 1e-5;
        const d = xs < 0 ? (F(xs + h) - F(xs)) / h : (F(xs) - F(xs - h)) / h;
        lv.slopes = [{ x: xs, m: q(d) }];
        lv.brief += ` · slope ${q(d)} at x = ${xs}`;
      } else if (extra === 1) {
        const xc = q(r.range(-a * 0.6, a * 0.6), 1);
        const cp = { x: xc, y: q(F(xc)) };
        if (obstacles.some((o) => obstacleDist(o, cp) < 0.6)) continue;
        lv.checkpoints = [cp];
        lv.brief += ' · through the checkpoint';
      } else {
        lv.maxOps = ops(ast) + 2;
        lv.brief += ` · at most ${lv.maxOps} operations`;
      }
    }
    if (!validate(lv, W.f).ok) continue;
    if (validate(lv, straightFormula(lv)).ok) continue;
    lv.brief = `${W.family === 'parabola' ? 'Bend around' : 'Thread'} ${lv.brief}.`;
    return lv;
  }
  throw new Error(`generateLevel: no course for ${tier} ${n}`);
}
