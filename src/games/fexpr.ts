// Function Path's mathematical engine: a safe expression language (tokenizer → recursive-descent parser →
// validated AST; no eval, no Function), a point evaluator and an interval evaluator with the same semantics,
// and a validator that proves — or honestly fails to prove — that a graph y = f(x) avoids every obstacle.
//
// Semantics (shared by the renderer and the validator): real numbers only. Division by zero, even roots and
// logs of out-of-range values, non-integer powers of negatives, overflow — all "undefined" (NaN).
// Comparisons exist only as conditions of `cond ? a : b`. `|e|` is abs(e). Implicit multiplication: 2x,
// 3sin(x), (x+1)(x-1), ax (single-letter parameters). `log(x)` is base 10, `log(x, b)` base b, `ln` natural.

export type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'par'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'cmp'; op: '<' | '<=' | '>' | '>='; a: Node; b: Node }
  | { k: 'if'; c: Node; a: Node; b: Node };

export class ParseError extends Error {
  constructor(
    msg: string,
    public at: number,
  ) {
    super(msg);
  }
}

/** Function name → allowed argument counts. */
export const FUNCS: Record<string, number[]> = {
  sin: [1],
  cos: [1],
  tan: [1],
  exp: [1],
  ln: [1],
  log: [1, 2],
  sqrt: [1],
  cbrt: [1],
  root: [2],
  abs: [1],
  sign: [1],
  atan: [1],
  asin: [1],
  acos: [1],
  sinh: [1],
  cosh: [1],
  tanh: [1],
  min: [2, 3, 4],
  max: [2, 3, 4],
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const isParam = (s: string) => /^[a-df-wyzA-Z]$/.test(s) && s !== 'x';

type Tok = { t: 'num'; v: number; at: number } | { t: 'id'; v: string; at: number } | { t: 'op'; v: string; at: number };

export function tokenize(src: string): Tok[] {
  const s = src
    .replace(/[−–]/g, '-')
    .replace(/[×·∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, ' pi ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/√/g, 'sqrt');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)/.exec(s.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=') {
      out.push({ t: 'op', v: two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/^(),|?:<>'.includes(ch)) {
      out.push({ t: 'op', v: ch, at: i });
      i++;
      continue;
    }
    throw new ParseError(`Unexpected “${ch}”`, i);
  }
  return out;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new ParseError('Type a formula, e.g. 0.5x^2 - 1', 0);
  let p = 0;
  let absDepth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string, what: string) => {
    if (!isOp(v)) throw new ParseError(`Expected ${what}`, peek()?.at ?? src.length);
    p++;
  };
  const startsPrimary = () => {
    const t = peek();
    if (!t) return false;
    if (t.t !== 'op') return true;
    return t.v === '(' || (t.v === '|' && absDepth === 0);
  };

  function ternary(): Node {
    const c = comparison();
    if (!isOp('?')) return c;
    if (c.k !== 'cmp') throw new ParseError('The part before ? must be a comparison, e.g. x < 1 ? … : …', peek()!.at);
    p++;
    const a = ternary();
    expect(':', '“:” (cond ? a : b)');
    const b = ternary();
    return { k: 'if', c, a, b };
  }
  function comparison(): Node {
    const a = additive();
    const t = peek();
    if (t?.t === 'op' && ['<', '<=', '>', '>='].includes(t.v)) {
      p++;
      return { k: 'cmp', op: t.v as '<', a, b: additive() };
    }
    return a;
  }
  function additive(): Node {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = peek()!.v as '+' | '-';
      p++;
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = peek()!.v as '*' | '/';
        p++;
        a = { k: 'bin', op, a, b: unary() };
      } else if (startsPrimary()) a = { k: 'bin', op: '*', a, b: power() };
      else return a;
    }
  }
  function unary(): Node {
    if (isOp('-')) {
      p++;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power(): Node {
    const base = primary();
    if (isOp('^')) {
      p++;
      return { k: 'bin', op: '^', a: base, b: unary() };
    }
    return base;
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw new ParseError('The formula ends too early', src.length);
    if (t.t === 'num') {
      p++;
      return { k: 'num', v: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      p++;
      const e = ternary();
      expect(')', 'a closing “)”');
      return e;
    }
    if (t.t === 'op' && t.v === '|') {
      p++;
      absDepth++;
      const e = ternary();
      absDepth--;
      expect('|', 'a closing “|”');
      return { k: 'call', fn: 'abs', args: [e] };
    }
    if (t.t === 'id') {
      p++;
      const name = t.v;
      if (FUNCS[name]) {
        if (!isOp('(')) throw new ParseError(`Write ${name}(…) with brackets`, t.at);
        p++;
        const args = [ternary()];
        while (isOp(',')) {
          p++;
          args.push(ternary());
        }
        expect(')', `“)” to close ${name}(`);
        if (!FUNCS[name].includes(args.length)) throw new ParseError(`${name} takes ${FUNCS[name].join(' or ')} argument${FUNCS[name][0] > 1 ? 's' : ''}`, t.at);
        return { k: 'call', fn: name, args };
      }
      if (name === 'x') return { k: 'x' };
      if (name in CONSTS) return { k: 'num', v: CONSTS[name] };
      if (isParam(name)) return { k: 'par', name };
      if (isOp('(') && name.length > 1) throw new ParseError(`Unknown function “${name}” — functions: ${Object.keys(FUNCS).join(', ')}`, t.at);
      // "ax", "kx": a run of single-letter parameters / x / e.
      if ([...name].every((ch) => ch === 'x' || ch === 'e' || isParam(ch))) {
        const parts: Node[] = [...name].map((ch) => (ch === 'x' ? { k: 'x' } : ch === 'e' ? { k: 'num', v: Math.E } : { k: 'par', name: ch }));
        return parts.reduce((acc, n) => ({ k: 'bin', op: '*', a: acc, b: n }));
      }
      throw new ParseError(`Unknown name “${name}” — functions: ${Object.keys(FUNCS).join(', ')}`, t.at);
    }
    throw new ParseError(`Unexpected “${t.v}”`, t.at);
  }

  const tree = ternary();
  if (p < toks.length) throw new ParseError(`Unexpected “${toks[p].v}”`, toks[p].at);
  if (tree.k === 'cmp') throw new ParseError('A comparison is not a number — use it as cond ? a : b', 0);
  checkNoBareCmp(tree);
  return tree;
}

function checkNoBareCmp(n: Node, allowed = false): void {
  if (n.k === 'cmp') {
    if (!allowed) throw new ParseError('Comparisons may only appear before “?”', 0);
    checkNoBareCmp(n.a);
    checkNoBareCmp(n.b);
  } else if (n.k === 'if') {
    checkNoBareCmp(n.c, true);
    checkNoBareCmp(n.a);
    checkNoBareCmp(n.b);
  } else if (n.k === 'neg') checkNoBareCmp(n.a);
  else if (n.k === 'bin') {
    checkNoBareCmp(n.a);
    checkNoBareCmp(n.b);
  } else if (n.k === 'call') n.args.forEach((a) => checkNoBareCmp(a));
}

/** Number of operations (operators, function calls, conditions). */
export function ops(n: Node): number {
  switch (n.k) {
    case 'num':
    case 'x':
    case 'par':
      return 0;
    case 'neg':
      return 1 + ops(n.a);
    case 'bin':
    case 'cmp':
      return 1 + ops(n.a) + ops(n.b);
    case 'call':
      return 1 + n.args.reduce((s, a) => s + ops(a), 0);
    case 'if':
      return 1 + ops(n.c) + ops(n.a) + ops(n.b);
  }
}

export function params(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === 'par') out.add(n.name);
  else if (n.k === 'neg') params(n.a, out);
  else if (n.k === 'bin' || n.k === 'cmp') {
    params(n.a, out);
    params(n.b, out);
  } else if (n.k === 'call') n.args.forEach((a) => params(a, out));
  else if (n.k === 'if') [n.c, n.a, n.b].forEach((a) => params(a, out));
  return out;
}

export type Params = Record<string, number>;
const fin = (v: number) => (Number.isFinite(v) ? v : NaN);

export function powReal(a: number, b: number) {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a < 0 && !Number.isInteger(b)) return NaN;
  if (a === 0 && b < 0) return NaN;
  return fin(Math.pow(a, b));
}

/** Point evaluation. NaN = undefined at x. */
export function evalAt(n: Node, x: number, P: Params): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'x':
      return x;
    case 'par':
      return P[n.name] ?? NaN;
    case 'neg':
      return -evalAt(n.a, x, P);
    case 'bin': {
      const a = evalAt(n.a, x, P);
      const b = evalAt(n.b, x, P);
      if (n.op === '+') return fin(a + b);
      if (n.op === '-') return fin(a - b);
      if (n.op === '*') return fin(a * b);
      if (n.op === '/') return b === 0 ? NaN : fin(a / b);
      return powReal(a, b);
    }
    case 'cmp':
      return NaN;
    case 'if': {
      const c = n.c as Extract<Node, { k: 'cmp' }>;
      const l = evalAt(c.a, x, P);
      const r = evalAt(c.b, x, P);
      if (Number.isNaN(l) || Number.isNaN(r)) return NaN;
      const t = c.op === '<' ? l < r : c.op === '<=' ? l <= r : c.op === '>' ? l > r : l >= r;
      return evalAt(t ? n.a : n.b, x, P);
    }
    case 'call': {
      const v = n.args.map((a) => evalAt(a, x, P));
      if (v.some(Number.isNaN)) return NaN;
      const a = v[0];
      switch (n.fn) {
        case 'sin':
          return Math.sin(a);
        case 'cos':
          return Math.cos(a);
        case 'tan':
          return fin(Math.tan(a));
        case 'exp':
          return fin(Math.exp(a));
        case 'ln':
          return a > 0 ? Math.log(a) : NaN;
        case 'log':
          if (v.length === 2) return a > 0 && v[1] > 0 && v[1] !== 1 ? Math.log(a) / Math.log(v[1]) : NaN;
          return a > 0 ? Math.log10(a) : NaN;
        case 'sqrt':
          return a >= 0 ? Math.sqrt(a) : NaN;
        case 'cbrt':
          return Math.cbrt(a);
        case 'root': {
          const k = v[1];
          if (!Number.isInteger(k) || k < 2) return NaN;
          if (a < 0) return k % 2 ? -Math.pow(-a, 1 / k) : NaN;
          return Math.pow(a, 1 / k);
        }
        case 'abs':
          return Math.abs(a);
        case 'sign':
          return Math.sign(a);
        case 'atan':
          return Math.atan(a);
        case 'asin':
          return a >= -1 && a <= 1 ? Math.asin(a) : NaN;
        case 'acos':
          return a >= -1 && a <= 1 ? Math.acos(a) : NaN;
        case 'sinh':
          return fin(Math.sinh(a));
        case 'cosh':
          return fin(Math.cosh(a));
        case 'tanh':
          return Math.tanh(a);
        case 'min':
          return Math.min(...v);
        case 'max':
          return Math.max(...v);
      }
      return NaN;
    }
  }
}

// ── Interval arithmetic ───────────────────────────────────────────────────────────
/** def: 0 defined on the whole interval, 1 maybe undefined somewhere, 2 undefined everywhere. cont: provably continuous. */
export interface Iv {
  lo: number;
  hi: number;
  def: 0 | 1 | 2;
  cont: boolean;
}
const iv = (lo: number, hi: number, def: 0 | 1 | 2 = 0, cont = true): Iv => ({ lo: Number.isNaN(lo) ? -Infinity : lo, hi: Number.isNaN(hi) ? Infinity : hi, def, cont: cont && def === 0 });
const UNDEF: Iv = { lo: NaN, hi: NaN, def: 2, cont: false };
const dd = (...a: Iv[]): 0 | 1 | 2 => (a.some((q) => q.def === 2) ? 2 : a.some((q) => q.def === 1) ? 1 : 0);
const cc = (...a: Iv[]) => a.every((q) => q.cont);
const mulp = (u: number, v: number) => (u === 0 || v === 0 ? 0 : u * v);
const contains = (lo: number, hi: number, off: number, per: number) => Math.floor((hi - off) / per) >= Math.ceil((lo - off) / per);

function mulI(a: Iv, b: Iv): Iv {
  const ps = [mulp(a.lo, b.lo), mulp(a.lo, b.hi), mulp(a.hi, b.lo), mulp(a.hi, b.hi)];
  if (ps.some(Number.isNaN)) return iv(-Infinity, Infinity, dd(a, b), cc(a, b));
  return iv(Math.min(...ps), Math.max(...ps), dd(a, b), cc(a, b));
}
function divI(a: Iv, b: Iv): Iv {
  if (a.def === 2 || b.def === 2) return UNDEF;
  if (b.lo === 0 && b.hi === 0) return UNDEF;
  if (b.lo > 0 || b.hi < 0) return mulI(a, iv(1 / b.hi, 1 / b.lo, b.def, b.cont));
  return iv(-Infinity, Infinity, 1, false);
}
function powIntI(a: Iv, n: number): Iv {
  if (n === 0) return iv(1, 1, a.def, a.cont);
  if (n < 0) return divI(iv(1, 1), powIntI(a, -n));
  const lo = Math.pow(a.lo, n);
  const hi = Math.pow(a.hi, n);
  if (n % 2 === 1) return iv(lo, hi, a.def, a.cont);
  if (a.lo >= 0) return iv(lo, hi, a.def, a.cont);
  if (a.hi <= 0) return iv(hi, lo, a.def, a.cont);
  return iv(0, Math.max(lo, hi), a.def, a.cont);
}
/** Monotone map over the part of [lo, hi] inside [dlo, dhi] (closed); outside parts are undefined. */
function domainMap(a: Iv, dlo: number, dhi: number, f: (v: number) => number, inc: boolean, openLo = false): Iv {
  if (a.def === 2) return UNDEF;
  const okLo = openLo ? a.lo > dlo : a.lo >= dlo;
  if (a.hi < dlo || (openLo && a.hi <= dlo) || a.lo > dhi) return UNDEF;
  const lo = Math.max(a.lo, dlo);
  const hi = Math.min(a.hi, dhi);
  const full = okLo && a.hi <= dhi;
  const y1 = f(lo);
  const y2 = f(hi);
  const r = inc ? iv(y1, y2) : iv(y2, y1);
  return { ...r, def: full ? a.def : 1, cont: full && a.cont };
}

export function evalI(n: Node, x0: number, x1: number, P: Params): Iv {
  switch (n.k) {
    case 'num':
      return iv(n.v, n.v);
    case 'x':
      return iv(x0, x1);
    case 'par': {
      const v = P[n.name];
      return v == null ? UNDEF : iv(v, v);
    }
    case 'neg': {
      const a = evalI(n.a, x0, x1, P);
      return a.def === 2 ? UNDEF : iv(-a.hi, -a.lo, a.def, a.cont);
    }
    case 'cmp':
      return UNDEF;
    case 'bin': {
      const a = evalI(n.a, x0, x1, P);
      const b = evalI(n.b, x0, x1, P);
      if (a.def === 2 || b.def === 2) return UNDEF;
      if (n.op === '+') return iv(a.lo + b.lo, a.hi + b.hi, dd(a, b), cc(a, b));
      if (n.op === '-') return iv(a.lo - b.hi, a.hi - b.lo, dd(a, b), cc(a, b));
      if (n.op === '*') return mulI(a, b);
      if (n.op === '/') return divI(a, b);
      // Power.
      if (b.lo === b.hi && Number.isInteger(b.lo)) {
        const r = powIntI(a, b.lo);
        return { ...r, def: dd(r, b), cont: r.cont && b.cont };
      }
      if (b.lo === b.hi) {
        const c = b.lo;
        const r = c > 0 ? domainMap(a, 0, Infinity, (v) => Math.pow(v, c), true) : domainMap(a, 0, Infinity, (v) => Math.pow(v, c), false, true);
        return r.def === 2 ? r : { ...r, def: dd(r, b) };
      }
      if (a.lo > 0) {
        const la = iv(Math.log(a.lo), Math.log(a.hi), a.def, a.cont);
        const m = mulI(b, la);
        return iv(Math.exp(m.lo), Math.exp(m.hi), dd(m), m.cont);
      }
      return iv(-Infinity, Infinity, 1, false);
    }
    case 'if': {
      const c = n.c as Extract<Node, { k: 'cmp' }>;
      const L = evalI(c.a, x0, x1, P);
      const R = evalI(c.b, x0, x1, P);
      if (L.def === 2 || R.def === 2) return UNDEF;
      const lt = c.op === '<' || c.op === '<=';
      const strict = c.op === '<' || c.op === '>';
      const [A, B] = lt ? [L, R] : [R, L]; // A op' B with op' ∈ {<, <=}
      const T = strict ? A.hi < B.lo : A.hi <= B.lo;
      const F = strict ? A.lo >= B.hi : A.lo > B.hi;
      const cd = dd(L, R);
      if (T || F) {
        const r = evalI(T ? n.a : n.b, x0, x1, P);
        if (r.def === 2) return UNDEF;
        return { ...r, def: (Math.max(r.def, cd) as 0 | 1), cont: r.cont && cd === 0 };
      }
      const a = evalI(n.a, x0, x1, P);
      const b = evalI(n.b, x0, x1, P);
      if (a.def === 2 && b.def === 2) return UNDEF;
      const lo = Math.min(a.def === 2 ? Infinity : a.lo, b.def === 2 ? Infinity : b.lo);
      const hi = Math.max(a.def === 2 ? -Infinity : a.hi, b.def === 2 ? -Infinity : b.hi);
      return iv(lo, hi, a.def === 2 || b.def === 2 ? 1 : (Math.max(a.def, b.def, cd, 0) as 0 | 1), false);
    }
    case 'call': {
      const A = n.args.map((a) => evalI(a, x0, x1, P));
      if (A.some((a) => a.def === 2)) return UNDEF;
      const a = A[0];
      const d = dd(...A);
      const ct = cc(...A);
      switch (n.fn) {
        case 'sin':
        case 'cos': {
          if (a.hi - a.lo >= 2 * Math.PI || !Number.isFinite(a.hi - a.lo)) return iv(-1, 1, d, ct);
          const f = n.fn === 'sin' ? Math.sin : Math.cos;
          const offMax = n.fn === 'sin' ? Math.PI / 2 : 0;
          const hi = contains(a.lo, a.hi, offMax, 2 * Math.PI) ? 1 : Math.max(f(a.lo), f(a.hi));
          const lo = contains(a.lo, a.hi, offMax + Math.PI, 2 * Math.PI) ? -1 : Math.min(f(a.lo), f(a.hi));
          return iv(lo, hi, d, ct);
        }
        case 'tan':
          if (!Number.isFinite(a.hi - a.lo) || contains(a.lo, a.hi, Math.PI / 2, Math.PI)) return iv(-Infinity, Infinity, 1, false);
          return iv(Math.tan(a.lo), Math.tan(a.hi), d, ct);
        case 'exp': {
          const hi = Math.exp(a.hi);
          return iv(Math.exp(a.lo), hi, Number.isFinite(hi) ? d : 1, ct && Number.isFinite(hi));
        }
        case 'ln':
          return domainMap(a, 0, Infinity, Math.log, true, true);
        case 'log': {
          if (A.length === 1) return domainMap(a, 0, Infinity, Math.log10, true, true);
          const num = domainMap(a, 0, Infinity, Math.log, true, true);
          const den = domainMap(A[1], 0, Infinity, Math.log, true, true);
          return divI(num, den);
        }
        case 'sqrt':
          return domainMap(a, 0, Infinity, Math.sqrt, true);
        case 'cbrt':
          return iv(Math.cbrt(a.lo), Math.cbrt(a.hi), d, ct);
        case 'root': {
          const k = A[1];
          if (k.lo !== k.hi || !Number.isInteger(k.lo) || k.lo < 2) return UNDEF;
          const m = k.lo;
          if (m % 2) return iv(Math.sign(a.lo) * Math.pow(Math.abs(a.lo), 1 / m), Math.sign(a.hi) * Math.pow(Math.abs(a.hi), 1 / m), d, ct);
          return domainMap(a, 0, Infinity, (v) => Math.pow(v, 1 / m), true);
        }
        case 'abs':
          if (a.lo >= 0) return iv(a.lo, a.hi, d, ct);
          if (a.hi <= 0) return iv(-a.hi, -a.lo, d, ct);
          return iv(0, Math.max(-a.lo, a.hi), d, ct);
        case 'sign':
          if (a.lo > 0) return iv(1, 1, d, ct);
          if (a.hi < 0) return iv(-1, -1, d, ct);
          if (a.lo === 0 && a.hi === 0) return iv(0, 0, d, ct);
          return iv(-1, 1, d, false);
        case 'atan':
          return iv(Math.atan(a.lo), Math.atan(a.hi), d, ct);
        case 'tanh':
          return iv(Math.tanh(a.lo), Math.tanh(a.hi), d, ct);
        case 'sinh': {
          const r = iv(Math.sinh(a.lo), Math.sinh(a.hi), d, ct);
          return Number.isFinite(r.lo) && Number.isFinite(r.hi) ? r : { ...r, def: 1, cont: false };
        }
        case 'cosh': {
          const hi = Math.max(Math.cosh(a.lo), Math.cosh(a.hi));
          const lo = a.lo <= 0 && a.hi >= 0 ? 1 : Math.min(Math.cosh(a.lo), Math.cosh(a.hi));
          return iv(lo, hi, Number.isFinite(hi) ? d : 1, ct && Number.isFinite(hi));
        }
        case 'asin':
          return domainMap(a, -1, 1, Math.asin, true);
        case 'acos':
          return domainMap(a, -1, 1, Math.acos, false);
        case 'min':
          return iv(Math.min(...A.map((q) => q.lo)), Math.min(...A.map((q) => q.hi)), d, ct);
        case 'max':
          return iv(Math.max(...A.map((q) => q.lo)), Math.max(...A.map((q) => q.hi)), d, ct);
      }
      return UNDEF;
    }
  }
}

// ── Levels, obstacles and validation ──────────────────────────────────────────────

export type XY = { x: number; y: number };
export type Obstacle = { kind: 'rect'; x0: number; y0: number; x1: number; y1: number } | { kind: 'circle'; cx: number; cy: number; r: number } | { kind: 'poly'; pts: XY[] };

export interface FLevel {
  id: string;
  name: string;
  brief: string;
  tier: 'easy' | 'medium' | 'hard';
  domain: [number, number];
  view: { x0: number; x1: number; y0: number; y1: number };
  start: XY;
  end: XY;
  checkpoints?: XY[];
  slopes?: { x: number; m: number }[];
  obstacles: Obstacle[];
  maxOps?: number;
  /** The graph must stay inside the view's vertical range on the domain. */
  bounded?: boolean;
  /** No discontinuity at all (otherwise finitely many are allowed). */
  continuous?: boolean;
  /** One known valid answer (tests only — never shown, never the only accepted answer). */
  ref: string;
}

export const TOL = 0.05; // value and slope tolerance
export const TOUCH = 1e-6; // boundary contact counts as a collision

/** Vertical extent of an obstacle over the slab x ∈ [x0, x1], or null if it misses the slab. */
export function slabY(o: Obstacle, x0: number, x1: number): [number, number] | null {
  if (o.kind === 'rect') return x1 < o.x0 || x0 > o.x1 ? null : [o.y0, o.y1];
  if (o.kind === 'circle') {
    if (x1 < o.cx - o.r || x0 > o.cx + o.r) return null;
    const xn = Math.max(x0, Math.min(x1, o.cx));
    const h = Math.sqrt(Math.max(0, o.r * o.r - (xn - o.cx) ** 2));
    return [o.cy - h, o.cy + h];
  }
  let lo = Infinity;
  let hi = -Infinity;
  const pts = o.pts;
  // Polygon ∩ slab: vertices inside the slab and edge crossings of the slab's two lines.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a.x >= x0 && a.x <= x1) {
      lo = Math.min(lo, a.y);
      hi = Math.max(hi, a.y);
    }
    for (const xs of [x0, x1]) {
      if ((a.x - xs) * (b.x - xs) < 0) {
        const y = a.y + ((b.y - a.y) * (xs - a.x)) / (b.x - a.x);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

const segD = (p: XY, a: XY, b: XY) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
/** Distance from p to the obstacle (0 inside or on the boundary). */
export function obstacleDist(o: Obstacle, p: XY) {
  if (o.kind === 'rect') return Math.hypot(Math.max(o.x0 - p.x, 0, p.x - o.x1), Math.max(o.y0 - p.y, 0, p.y - o.y1));
  if (o.kind === 'circle') return Math.max(0, Math.hypot(p.x - o.cx, p.y - o.cy) - o.r);
  let inside = false;
  let d = Infinity;
  const q = o.pts;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
    d = Math.min(d, segD(p, q[j], q[i]));
  }
  return inside ? 0 : d;
}

export type DiscKind = 'jump' | 'asymptote' | 'removable';
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface Verdict {
  ok: boolean;
  /** 'proven': interval arithmetic excluded every collision; 'numerical': some leaf could only be checked numerically. */
  status: 'proven' | 'numerical';
  checks: Check[];
  collisions: { x: number; o: number }[];
  discontinuities: { x: number; kind: DiscKind }[];
  undefinedOn: [number, number][];
  ops: number;
  params: number;
  error?: string;
}

const SPLIT_MIN = 1e-9;
const LEAF = 1e-7;
const MAX_EVALS = 300000;

export function classifyPoint(f: (x: number) => number, p: number): DiscKind | null {
  const L1 = f(p - 1e-4);
  const L2 = f(p - 1e-7);
  const R1 = f(p + 1e-4);
  const R2 = f(p + 1e-7);
  const f0 = f(p);
  const big = (v: number) => !Number.isFinite(v) || Math.abs(v) > 1e6;
  if ((big(L2) && Number.isFinite(L2)) || (big(R2) && Number.isFinite(R2)) || Math.abs(L2) > 20 * Math.abs(L1) + 50 || Math.abs(R2) > 20 * Math.abs(R1) + 50) return 'asymptote';
  if (Number.isNaN(L2) || Number.isNaN(R2)) return Number.isNaN(f0) ? 'removable' : 'jump';
  if (Math.abs(L2 - R2) > 1e-3) return 'jump';
  if (Number.isNaN(f0) || Math.abs(f0 - (L2 + R2) / 2) > 1e-3) return 'removable';
  // A single bad point (e.g. x/x at 0) sits on a round number near the cluster, not on the cluster itself.
  const q = Math.round(p * 1e6) / 1e6;
  if (Number.isNaN(f(q)) || Math.abs(f(q) - (L2 + R2) / 2) > 1e-3) return 'removable';
  return null;
}

export function validate(level: FLevel, src: string, P: Params = {}): Verdict {
  let ast: Node;
  try {
    ast = parse(src);
  } catch (e) {
    return { ok: false, status: 'proven', checks: [], collisions: [], discontinuities: [], undefinedOn: [], ops: 0, params: 0, error: (e as Error).message };
  }
  return validateAst(level, ast, P);
}

export function validateAst(level: FLevel, ast: Node, P: Params = {}): Verdict {
  const f = (x: number) => evalAt(ast, x, P);
  const [a, b] = level.domain;
  const collisions: { x: number; o: number }[] = [];
  const undef: [number, number][] = [];
  const sing: number[] = [];
  const outside: number[] = [];
  let unresolved = 0;
  let evals = 0;
  let capped = false;
  const { y0: vy0, y1: vy1 } = level.view;

  const stack: [number, number][] = [[a, b]];
  while (stack.length) {
    const [x0, x1] = stack.pop()!;
    if (++evals > MAX_EVALS) {
      capped = true;
      break;
    }
    const I = evalI(ast, x0, x1, P);
    const w = x1 - x0;
    const xm = (x0 + x1) / 2;
    if (I.def === 2) {
      const last = undef[undef.length - 1];
      if (last && Math.abs(last[0] - x1) < 1e-12) last[0] = x0;
      else if (last && Math.abs(last[1] - x0) < 1e-12) last[1] = x1;
      else undef.push([x0, x1]);
      continue;
    }
    if (!I.cont) {
      if (w > SPLIT_MIN) {
        stack.push([x0, xm], [xm, x1]);
        continue;
      }
      // A possible discontinuity or undefined point: record it and check the point itself.
      if (sing.length < 400) sing.push(xm);
      const ym = f(xm);
      if (Number.isFinite(ym)) level.obstacles.forEach((o, i) => obstacleDist(o, { x: xm, y: ym }) <= TOUCH && collisions.push({ x: xm, o: i }));
      continue;
    }
    // Defined and continuous here: which obstacles could the graph reach?
    const near: number[] = [];
    level.obstacles.forEach((o, i) => {
      const s = slabY(o, x0, x1);
      if (s && I.hi >= s[0] - TOUCH && I.lo <= s[1] + TOUCH) near.push(i);
    });
    const leaves = level.bounded && (I.lo < vy0 || I.hi > vy1);
    if (!near.length && !leaves) continue;
    const ym = f(xm);
    const hit = near.find((i) => obstacleDist(level.obstacles[i], { x: xm, y: ym }) <= TOUCH);
    if (hit != null) {
      collisions.push({ x: xm, o: hit });
      continue;
    }
    if (level.bounded && (ym < vy0 || ym > vy1)) {
      outside.push(xm);
      continue;
    }
    if (w < LEAF) {
      // Interval bounds are as tight as they will get: accept only with a clear margin.
      const margin = Math.min(...near.map((i) => obstacleDist(level.obstacles[i], { x: xm, y: ym })), level.bounded ? Math.min(ym - vy0, vy1 - ym) : Infinity);
      if (!(margin > I.hi - I.lo + w)) unresolved++;
      continue;
    }
    stack.push([x0, xm], [xm, x1]);
  }

  // Cluster and classify the possible discontinuities.
  sing.sort((p, q) => p - q);
  const clusters: number[] = [];
  for (const s of sing) if (!clusters.length || s - clusters[clusters.length - 1] > 1e-6) clusters.push(s);
  const discontinuities = clusters.map((x) => ({ x, kind: classifyPoint(f, x) })).filter((d): d is { x: number; kind: DiscKind } => d.kind !== null);
  const undefinedOn = undef.filter(([p, q]) => q - p > SPLIT_MIN * 4);

  const checks: Check[] = [];
  const near = (x: number, y: number, what: string) => {
    const v = f(x);
    checks.push({ name: what, ok: Number.isFinite(v) && Math.abs(v - y) <= TOL, detail: Number.isFinite(v) ? `f(${fmt(x)}) = ${fmt(v)}, needs ${fmt(y)} ± ${TOL}` : `f is undefined at x = ${fmt(x)}` });
  };
  near(level.start.x, level.start.y, 'start');
  near(level.end.x, level.end.y, 'end');
  (level.checkpoints ?? []).forEach((c, i) => near(c.x, c.y, `checkpoint ${i + 1}`));
  for (const s of level.slopes ?? []) {
    const h = 1e-5;
    const atA = Math.abs(s.x - a) < 1e-12;
    const atB = Math.abs(s.x - b) < 1e-12;
    const dl = (f(s.x) - f(s.x - h)) / h;
    const dr = (f(s.x + h) - f(s.x)) / h;
    const d = atA ? dr : atB ? dl : (f(s.x + h) - f(s.x - h)) / (2 * h);
    const corner = !atA && !atB && Math.abs(dl - dr) > TOL;
    checks.push({ name: `slope at x = ${fmt(s.x)}`, ok: Number.isFinite(d) && !corner && Math.abs(d - s.m) <= TOL, detail: corner ? 'f has a corner there (no single slope)' : Number.isFinite(d) ? `f′(${fmt(s.x)}) = ${fmt(d)}, needs ${fmt(s.m)} ± ${TOL}` : 'slope undefined' });
  }
  checks.push({ name: 'defined on the domain', ok: !undefinedOn.length, detail: undefinedOn.length ? `undefined on [${fmt(undefinedOn[0][0])}, ${fmt(undefinedOn[0][1])}]` : `defined on [${fmt(a)}, ${fmt(b)}] except at ${discontinuities.filter((d) => d.kind === 'removable').length} point(s)` });
  const many = discontinuities.length > 50 || sing.length >= 400;
  checks.push({
    name: 'continuity',
    ok: !many && !(level.continuous && discontinuities.length),
    detail: many ? 'too many discontinuities (possibly infinitely many)' : discontinuities.length ? `${discontinuities.length} discontinuit${discontinuities.length > 1 ? 'ies' : 'y'}: ${discontinuities.map((d) => `${d.kind} at ${fmt(d.x)}`).join(', ')}${level.continuous ? ' — this level allows none' : ''}` : 'continuous on the domain',
  });
  const hitObs = [...new Set(collisions.map((c) => c.o))];
  checks.push({ name: 'obstacles', ok: !collisions.length, detail: collisions.length ? `enters ${hitObs.length} obstacle${hitObs.length > 1 ? 's' : ''} (first at x ≈ ${fmt(Math.min(...collisions.map((c) => c.x)))})` : 'clear of every obstacle' });
  if (level.bounded) checks.push({ name: 'stays on the board', ok: !outside.length, detail: outside.length ? `leaves the board near x ≈ ${fmt(outside[0])}` : `stays within y ∈ [${level.view.y0}, ${level.view.y1}]` });
  const nOps = ops(ast);
  if (level.maxOps != null) checks.push({ name: 'operation limit', ok: nOps <= level.maxOps, detail: `${nOps} operations (limit ${level.maxOps})` });
  if (capped) checks.push({ name: 'checkable', ok: false, detail: 'too complex to verify — simplify the formula' });
  return {
    ok: checks.every((c) => c.ok),
    status: unresolved || capped ? 'numerical' : 'proven',
    checks,
    collisions,
    discontinuities,
    undefinedOn,
    ops: nOps,
    params: params(ast).size,
  };
}

export const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toFixed(3)).toString());
