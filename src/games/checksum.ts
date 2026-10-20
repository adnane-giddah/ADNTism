// 46 · CHECKSUM — repair corrupted data from its redundancy.
// Every puzzle is a formal code whose constraints the engine checks:
//   single   a bit grid whose last row and column are parity bits: every row and column has an even
//            number of 1s. One bit (data or parity) is flipped: its row and column checks fail.
//   counts   the number of 1s in every row and column is known; k bits are flipped. Parity alone could
//            not locate two errors; counts can — but only some patterns. Every round is verified by brute
//            force over all k-subsets to have exactly one repair.
//   hamming  a Hamming word (7 or 15 bits): check g covers the positions whose index has bit g set. The
//            failed checks spell the position of a single flipped bit in binary (0 = intact).
//   erasure  some cells are unreadable (?), the parity checks are intact: the missing bits are the unique
//            solution of a linear system over GF(2) (verified: rank = number of unknowns).
//   mixed    erasures and one wrong-but-readable bit; verified by solving the erasures for every possible
//            error position: exactly one combination satisfies every check.
//   digits   digits 0–9 with their row and column sums; one or two digits are wrong (verified unique).
// Score per puzzle: wrong cells / cells that needed repair (capped at 1), plus a little for edits that were
// undone and for checks read beyond what the deduction needed.
import { font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, shuffle } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

export interface CheckRound {
  kind: 'single' | 'counts' | 'hamming' | 'erasure' | 'mixed' | 'digits';
  R: number;
  C: number;
  orig: number[];
  /** Initial display (null = erased). */
  shown: (number | null)[];
  /** counts / digits: the true row and column totals. */
  rowT?: number[];
  colT?: number[];
  /** Number of wrong (k) cells, announced for counts and digits. */
  k: number;
  /** Checks must be tapped to be read (counted). */
  hidden: boolean;
}

const idx = (rd: { C: number }, r: number, c: number) => r * rd.C + c;

export function parityGrid(r: Rng, R: number, C: number) {
  const g = Array.from({ length: R * C }, () => 0);
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) g[i * C + j] = r.int(0, 1);
  for (let i = 0; i < R - 1; i++) g[i * C + C - 1] = g.slice(i * C, i * C + C - 1).reduce((a, b) => a ^ b, 0);
  for (let j = 0; j < C; j++) {
    let s = 0;
    for (let i = 0; i < R - 1; i++) s ^= g[i * C + j];
    g[(R - 1) * C + j] = s;
  }
  return g;
}

export const rowSum = (g: number[], C: number, r: number) => g.slice(r * C, r * C + C).reduce((a, b) => a + b, 0);
export const colSum = (g: number[], R: number, C: number, c: number) => Array.from({ length: R }, (_, i) => g[i * C + c]).reduce((a, b) => a + b, 0);

/** Solutions of the erasure system: x over GF(2) with every row and column even. Returns the count (capped) and one solution. */
export function solveErasures(vals: (number | null)[], R: number, C: number) {
  const unk = vals.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const eqs: { m: number; rhs: number }[] = [];
  const add = (cells: number[]) => {
    let m = 0;
    let rhs = 0;
    for (const i of cells) {
      const u = unk.indexOf(i);
      if (u >= 0) m |= 1 << u;
      else rhs ^= vals[i]!;
    }
    eqs.push({ m, rhs });
  };
  for (let r = 0; r < R; r++) add(Array.from({ length: C }, (_, c) => r * C + c));
  for (let c = 0; c < C; c++) add(Array.from({ length: R }, (_, r) => r * C + c));
  // Gaussian elimination over GF(2).
  const rows = eqs.map((e) => ({ ...e }));
  let rank = 0;
  const pivots: number[] = [];
  for (let b = 0; b < unk.length; b++) {
    const p = rows.findIndex((e, i) => i >= rank && (e.m >> b) & 1);
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p], rows[rank]];
    for (let i = 0; i < rows.length; i++)
      if (i !== rank && (rows[i].m >> b) & 1) {
        rows[i].m ^= rows[rank].m;
        rows[i].rhs ^= rows[rank].rhs;
      }
    pivots.push(b);
    rank++;
  }
  if (rows.some((e) => e.m === 0 && e.rhs === 1)) return { count: 0, sol: null as number[] | null };
  const sol = Array(unk.length).fill(0);
  pivots.forEach((b, i) => (sol[b] = rows[i].rhs));
  return { count: 2 ** (unk.length - rank), sol, unk };
}

function genSingle(r: Rng, band: Band): CheckRound {
  const n = [6, 7, 8, 9][band];
  const orig = parityGrid(r, n, n);
  const shown: number[] = [...orig];
  const e = r.int(0, n * n - 1);
  shown[e] ^= 1;
  return { kind: 'single', R: n, C: n, orig, shown, k: 1, hidden: band >= 1 };
}

/** All k-subsets whose flipping makes every row and column count match. */
export function countRepairs(g: number[], R: number, C: number, rowT: number[], colT: number[], k: number, limit = 2) {
  const out: number[][] = [];
  const N = R * C;
  const rd = Array.from({ length: R }, (_, i) => rowT[i] - rowSum(g, C, i));
  const cd = Array.from({ length: C }, (_, j) => colT[j] - colSum(g, R, C, j));
  const pick: number[] = [];
  const rec = (start: number) => {
    if (out.length >= limit) return;
    if (pick.length === k) {
      const rr2 = Array(R).fill(0);
      const cc2 = Array(C).fill(0);
      for (const i of pick) {
        const d = g[i] ? -1 : 1;
        rr2[Math.floor(i / C)] += d;
        cc2[i % C] += d;
      }
      if (rr2.every((v, i) => v === rd[i]) && cc2.every((v, j) => v === cd[j])) out.push([...pick]);
      return;
    }
    for (let i = start; i < N; i++) {
      pick.push(i);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return out;
}

function genCounts(r: Rng, band: Band): CheckRound | null {
  const n = [5, 5, 6, 7][band];
  const k = band >= 2 ? 3 : 2;
  const orig = Array.from({ length: n * n }, () => r.int(0, 1));
  const rowT = Array.from({ length: n }, (_, i) => rowSum(orig, n, i));
  const colT = Array.from({ length: n }, (_, j) => colSum(orig, n, n, j));
  const cells = shuffle(
    Array.from({ length: n * n }, (_, i) => i),
    r.next,
  ).slice(0, k);
  const shown = [...orig];
  for (const i of cells) shown[i] ^= 1;
  const reps = countRepairs(shown, n, n, rowT, colT, k);
  if (reps.length !== 1) return null;
  return { kind: 'counts', R: n, C: n, orig, shown, rowT, colT, k, hidden: false };
}

/** Hamming code over positions 1..n (n = 2^m − 1), even parity: syndrome = position of a single error. */
export function hammingEncode(r: Rng, n: number) {
  const w = Array(n + 1).fill(0);
  for (let p = 1; p <= n; p++) if (p & (p - 1)) w[p] = r.int(0, 1);
  for (let g = 1; g <= n; g <<= 1) {
    let s = 0;
    for (let p = 1; p <= n; p++) if (p & g && p !== g) s ^= w[p];
    w[g] = s;
  }
  return w.slice(1);
}
export const groupOK = (bits: number[], g: number) => bits.reduce((s, b, i) => s ^ ((i + 1) & g ? b : 0), 0) === 0;
export const syndrome = (bits: number[]) => {
  let s = 0;
  for (let g = 1; g <= bits.length; g <<= 1) if (!groupOK(bits, g)) s |= g;
  return s;
};

function genHamming(r: Rng, band: Band): CheckRound {
  const n = band === 0 ? 7 : 15;
  const orig = hammingEncode(r, n);
  const shown = [...orig];
  // From band 2 the word may be intact (syndrome 0): the checks must say so.
  const intact = band >= 2 && r.next() < 0.2;
  if (!intact) shown[r.int(0, n - 1)] ^= 1;
  return { kind: 'hamming', R: 1, C: n, orig, shown, k: intact ? 0 : 1, hidden: true };
}

function genErasure(r: Rng, band: Band): CheckRound | null {
  const n = [6, 6, 7, 8][band];
  const m = [4, 6, 8, 10][band];
  const orig = parityGrid(r, n, n);
  const er = shuffle(
    Array.from({ length: n * n }, (_, i) => i),
    r.next,
  ).slice(0, m);
  const shown: (number | null)[] = orig.map((v, i) => (er.includes(i) ? null : v));
  const s = solveErasures(shown, n, n);
  if (s.count !== 1) return null;
  return { kind: 'erasure', R: n, C: n, orig, shown, k: m, hidden: band >= 2 };
}

/** Number of (error position, erasure values) completions that satisfy every check, for exactly one error. */
export function mixedSolutions(shown: (number | null)[], R: number, C: number) {
  let total = 0;
  for (let p = 0; p < shown.length; p++) {
    if (shown[p] === null) continue;
    const t = [...shown];
    t[p] = 1 - (t[p] as number);
    total += solveErasures(t, R, C).count;
    if (total > 1) return total;
  }
  return total;
}

function genMixed(r: Rng, band: Band): CheckRound | null {
  const n = [6, 6, 7, 8][band];
  const m = [2, 3, 4, 6][band];
  const orig = parityGrid(r, n, n);
  const cells = shuffle(
    Array.from({ length: n * n }, (_, i) => i),
    r.next,
  );
  const er = cells.slice(0, m);
  const e = cells[m];
  const shown: (number | null)[] = orig.map((v, i) => (er.includes(i) ? null : i === e ? 1 - v : v));
  if (mixedSolutions(shown, n, n) !== 1) return null;
  return { kind: 'mixed', R: n, C: n, orig, shown, k: m + 1, hidden: false };
}

/** Digit grids: repairs of size k (changes to digits) consistent with the sums. */
export function digitRepairs(g: number[], R: number, C: number, rowT: number[], colT: number[], k: number, limit = 2) {
  const rd = Array.from({ length: R }, (_, i) => rowT[i] - rowSum(g, C, i));
  const cd = Array.from({ length: C }, (_, j) => colT[j] - colSum(g, R, C, j));
  const out: [number, number][][] = [];
  const N = R * C;
  const test = (ch: [number, number][]) => {
    const r2 = Array(R).fill(0);
    const c2 = Array(C).fill(0);
    for (const [i, d] of ch) {
      r2[Math.floor(i / C)] += d;
      c2[i % C] += d;
    }
    return r2.every((v, i) => v === rd[i]) && c2.every((v, j) => v === cd[j]);
  };
  const deltas = (i: number) => Array.from({ length: 10 }, (_, v) => v - g[i]).filter((d) => d !== 0);
  if (k === 1) {
    for (let i = 0; i < N && out.length < limit; i++) for (const d of deltas(i)) if (test([[i, d]])) out.push([[i, d]]);
  } else
    for (let i = 0; i < N && out.length < limit; i++)
      for (let j = i + 1; j < N && out.length < limit; j++)
        for (const a of deltas(i))
          for (const b of deltas(j))
            if (test([
              [i, a],
              [j, b],
            ]))
              out.push([
                [i, a],
                [j, b],
              ]);
  return out;
}

function genDigits(r: Rng, band: Band): CheckRound | null {
  const n = [4, 4, 5, 6][band];
  const k = band >= 1 ? 2 : 1;
  const orig = Array.from({ length: n * n }, () => r.int(0, 9));
  const rowT = Array.from({ length: n }, (_, i) => rowSum(orig, n, i));
  const colT = Array.from({ length: n }, (_, j) => colSum(orig, n, n, j));
  const shown = [...orig];
  const cells = shuffle(
    Array.from({ length: n * n }, (_, i) => i),
    r.next,
  ).slice(0, k);
  for (const i of cells) {
    let v = r.int(0, 9);
    if (v === orig[i]) v = (v + r.int(1, 9)) % 10;
    shown[i] = v;
  }
  if (digitRepairs(shown, n, n, rowT, colT, k).length !== 1) return null;
  return { kind: 'digits', R: n, C: n, orig, shown, rowT, colT, k, hidden: false };
}

export const FAMILIES: Family<CheckRound>[] = [
  { id: 'single', name: 'Single flip', teach: 'Each row and column must hold an even number of 1s. One bit is flipped: tap it to flip it back, then Verify.', bands: [0, 3], intro: true, gen: genSingle, sig: (rd) => `${rd.R}|${rd.shown.findIndex((v, i) => v !== rd.orig[i])}` },
  { id: 'counts', name: 'Counts', teach: 'Row and column counts of 1s are known, and the number of flipped bits is given. Find exactly those bits.', bands: [0, 3], gen: genCounts, sig: (rd) => `${rd.R}|${rd.k}|${rd.shown.map((v, i) => (v !== rd.orig[i] ? i : '')).join('')}` },
  { id: 'hamming', name: 'Hamming', teach: 'Each check covers the positions whose number contains its bit. Read the checks: the failing ones add up to the wrong position.', bands: [1, 3], gen: genHamming, sig: (rd) => `${rd.C}|${rd.shown.findIndex((v, i) => v !== rd.orig[i])}` },
  { id: 'erasure', name: 'Erasures', teach: 'Some bits are unreadable (?). The parity checks are intact — work out each missing bit. Tap a ? to set it.', bands: [0, 3], gen: genErasure, sig: (rd) => `${rd.R}|${rd.shown.map((v, i) => (v === null ? i : '')).join('.')}` },
  { id: 'mixed', name: 'Error + erasure', teach: 'Unreadable bits AND one readable bit that is wrong. Erasures are honest about being unknown; the error is not.', bands: [1, 3], gen: genMixed, sig: (rd) => `${rd.R}|${rd.shown.map((v, i) => (v === null ? 'e' + i : v !== rd.orig[i] ? 'x' + i : '')).join('')}` },
  { id: 'digits', name: 'Digit sums', teach: 'The sums at the ends of each row and column are true. Find the wrong digit and type its value.', bands: [0, 3], gen: genDigits, sig: (rd) => `${rd.R}|${rd.k}|${rd.shown.map((v, i) => (v !== rd.orig[i] ? i : '')).join('.')}` },
];

export const ROUNDS = 5;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<CheckRound>(api, 'checksum', FAMILIES, ROUNDS);
  let rd: CheckRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let cur: (number | null)[] = [];
  let edits = 0;
  let read = new Set<string>();
  let selCell = -1;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    cur = [...rd.shown];
    edits = 0;
    read = new Set();
    selCell = -1;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const ask = {
      single: 'One bit is wrong. Find it and flip it back.',
      counts: `${rd.k} bits are flipped. The counts at the edges are the true counts. Repair them.`,
      hamming: 'At most one bit of this word is flipped. Read the checks and repair it.',
      erasure: `Fill in the ${rd.k} unreadable bits.`,
      mixed: `Fill in the ${rd.k - 1} unreadable bits and fix the one wrong bit.`,
      digits: `${rd.k === 1 ? 'One digit is' : 'Two digits are'} wrong. The sums are true. Repair ${rd.k === 1 ? 'it' : 'them'}.`,
    }[rd.kind];
    api.prompt(ask, sess.teach || (rd.hidden ? 'Tap a check to read it · reading checks is counted' : 'Tap cells to change them · Verify when every check passes'));
    stage.request();
  }

  const isParity = () => rd.kind === 'single' || rd.kind === 'erasure' || rd.kind === 'mixed';

  /** Status of a row / column check: true ok, false failed, null unknown (erasure inside). */
  function check(kind: 'r' | 'c', i: number): boolean | null {
    const cells = kind === 'r' ? Array.from({ length: rd.C }, (_, j) => idx(rd, i, j)) : Array.from({ length: rd.R }, (_, j) => idx(rd, j, i));
    if (cells.some((k) => cur[k] === null)) return null;
    const s = cells.reduce((a, k) => a + (cur[k] as number), 0);
    if (isParity()) return s % 2 === 0;
    return s === (kind === 'r' ? rd.rowT![i] : rd.colT![i]);
  }

  function edit(i: number) {
    if (phase !== 'play') return;
    if (rd.kind === 'digits') {
      selCell = selCell === i ? -1 : i;
      return;
    }
    const v = cur[i];
    cur[i] = v === null ? 0 : 1 - v;
    edits++;
    api.sfx.soft();
  }

  function setDigit(d: number) {
    if (phase !== 'play' || selCell < 0) return;
    if (cur[selCell] !== d) {
      cur[selCell] = d;
      edits++;
    }
  }

  function verify() {
    if (phase !== 'play') return;
    const need = rd.shown.reduce<number>((a, v, i) => a + (v !== rd.orig[i] ? 1 : 0), 0);
    const wrong = cur.reduce<number>((a, v, i) => a + (v !== rd.orig[i] ? 1 : 0), 0);
    const extraEdits = Math.max(0, edits - need);
    // Checks the deduction needs: Hamming — every group (the syndrome has that many bits); a hidden grid —
    // all but one row and one column (if those all pass, the unread ones are the failing ones).
    const neededReads = rd.kind === 'hamming' ? Math.log2(rd.C + 1) : rd.hidden ? rd.R + rd.C - 2 : 0;
    const extraReads = Math.max(0, read.size - neededReads);
    let pen = wrong ? Math.min(1, wrong / Math.max(1, need)) : 0;
    if (!wrong) pen = Math.min(0.3, 0.03 * extraEdits + 0.03 * extraReads);
    let main = '';
    let sub = '';
    if (!wrong) main = need ? `Repaired — ${need} cell${need > 1 ? 's' : ''} restored.` : 'Right: the word was intact.';
    else main = `${wrong} cell${wrong > 1 ? 's' : ''} still wrong (shown in coral).`;
    if (rd.kind === 'single') sub = 'A single flip breaks exactly one row and one column: they cross at the culprit.';
    else if (rd.kind === 'counts') sub = 'A count that is too high means a 0 became 1; too low, a 1 became 0. The signs pin the pattern down.';
    else if (rd.kind === 'hamming') {
      const s = syndrome(rd.shown as number[]);
      sub = s ? `The failing checks were ${[1, 2, 4, 8].filter((g) => s & g).join(' + ')} = position ${s}.` : 'All checks passed: syndrome 0, nothing to repair.';
    } else if (rd.kind === 'erasure') sub = 'A row or column with one unknown fixes it directly; filling it can unlock the next.';
    else if (rd.kind === 'mixed') sub = 'Erasures you solve; the error you must locate. Solve the erasures in the rows that have them, then the checks still failing point at the error.';
    else sub = 'The wrong digit sits where a row’s and a column’s shortfall agree; its true value corrects both.';
    if (extraEdits) sub += ` ${extraEdits} edit${extraEdits > 1 ? 's' : ''} beyond what was needed.`;
    if (extraReads) sub += ` ${extraReads} check reading${extraReads > 1 ? 's' : ''} beyond the minimum.`;
    phase = 'reveal';
    sess.done(pen, `${wrong ? `${wrong} wrong` : 'repaired'} · ${edits} edits${rd.hidden ? ` · ${read.size} checks read` : ''}`, { x: stage.w / 2, y: 120 });
    api.sfx[wrong ? 'release' : 'press']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per block (wrong cells, then wasted edits and checks)', share: 'CHECKSUM' });
      if (r) bench.finish(r);
    }
  }

  bench.onTap = () => phase === 'reveal' && begin();
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase !== 'play') return;
    if (e.key === 'Enter') verify();
    else if (rd.kind === 'digits' && /^[0-9]$/.test(e.key)) setDigit(Number(e.key));
    else return;
    e.preventDefault();
  };

  function statusMark(c: CanvasRenderingContext2D, x: number, y: number, st: boolean | null, label?: string) {
    const col = st === null ? pal.ink3 : st ? pal.accent : pal.signal;
    text(c, label ?? (st === null ? '?' : st ? '✓' : '✗'), x, y, font.mono(12, 700), col, 'center', 'middle');
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const reveal = phase !== 'play';
    if (rd.kind === 'hamming') {
      const n = rd.C;
      const cw = Math.min(46, (W - 48) / n);
      const x0 = W / 2 - (n * cw) / 2;
      const y0 = 190;
      plate(c, x0 - 10, y0 - 70, n * cw + 20, 210, 8);
      const groups = [1, 2, 4, 8].filter((g) => g <= n);
      groups.forEach((g, gi) => {
        // Bracket marks over the covered positions.
        const yy = y0 - 18 - gi * 12;
        for (let p = 1; p <= n; p++) if (p & g) {
          c.fillStyle = alpha([pal.accent, AMBER, '#A88BFF', '#6FA8FF'][gi], 0.75);
          c.fillRect(x0 + (p - 1) * cw + 4, yy, cw - 8, 4);
        }
      });
      for (let p = 1; p <= n; p++) {
        const x = x0 + (p - 1) * cw;
        const v = cur[p - 1] as number;
        const bad = reveal && v !== rd.orig[p - 1];
        rr(c, x + 2, y0, cw - 4, cw - 4, 5);
        c.fillStyle = bad ? alpha(pal.signal, 0.25) : (p & (p - 1)) === 0 ? alpha(pal.ink, 0.1) : pal.paper2;
        c.fill();
        c.strokeStyle = bad ? pal.signal : pal.line;
        c.stroke();
        text(c, String(v), x + cw / 2, y0 + (cw - 4) / 2 + 1, font.mono(16, 600), pal.ink, 'center', 'middle');
        text(c, String(p), x + cw / 2, y0 + cw + 10, font.mono(9, 500), pal.ink3, 'center');
        if (!reveal) bench.hit(x + 2, y0, cw - 4, cw - 4, () => edit(p - 1));
      }
      const by = y0 + cw + 36;
      groups.forEach((g, gi) => {
        const isRead = read.has('g' + g) || reveal;
        const ok = groupOK(cur as number[], g);
        const lab = `check ${g}: ${isRead ? (ok ? 'pass ✓' : 'FAIL ✗') : 'read'}`;
        const gw = Math.min(128, (W - 24) / groups.length);
        bench.button(c, W / 2 - (groups.length * gw) / 2 + gi * gw, by, gw - 8, 38, lab, () => read.add('g' + g), { off: reveal, sel: isRead, color: isRead ? (ok ? pal.accent : pal.signal) : [pal.accent, AMBER, '#A88BFF', '#6FA8FF'][gi], px: 11 });
      });
      if (!reveal) bench.button(c, W / 2 - 80, by + 54, 160, 40, 'Verify', verify, { primary: true, key: 'Enter' });
      roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
      return false;
    }
    const n = rd.R;
    const avail = Math.min(W - 120, H - 260);
    const cs = Math.max(28, Math.min(56, avail / n));
    const gx = W / 2 - (n * cs) / 2 - 20;
    const gy = 124;
    plate(c, gx - 10, gy - 10, n * cs + 80, n * cs + 70, 8);
    for (let r = 0; r < n; r++)
      for (let k = 0; k < rd.C; k++) {
        const i = idx(rd, r, k);
        const x = gx + k * cs;
        const y = gy + r * cs;
        const v = cur[i];
        const parityCell = isParity() && (r === n - 1 || k === rd.C - 1);
        const bad = reveal && v !== rd.orig[i];
        const changed = !reveal && v !== rd.shown[i];
        rr(c, x + 2, y + 2, cs - 4, cs - 4, 5);
        c.fillStyle = bad ? alpha(pal.signal, 0.25) : selCell === i ? alpha(pal.accent, 0.2) : parityCell ? alpha(pal.ink, 0.1) : pal.paper2;
        c.fill();
        c.strokeStyle = bad ? pal.signal : changed ? AMBER : rd.shown[i] === null ? alpha(pal.accent, 0.5) : pal.line;
        c.lineWidth = changed || bad ? 1.5 : 1;
        c.stroke();
        const s = v === null ? '?' : String(v);
        text(c, s, x + cs / 2, y + cs / 2 + 1, font.mono(Math.min(20, cs * 0.42), 600), v === null ? pal.accent : rd.kind !== 'digits' && v === 0 ? pal.ink3 : pal.ink, 'center', 'middle');
        if (!reveal) bench.hit(x + 2, y + 2, cs - 4, cs - 4, () => edit(i));
      }
    // Row and column checks (counts / sums shown with the target).
    const showCheck = (key: string) => !rd.hidden || read.has(key) || reveal;
    for (let r = 0; r < n; r++) {
      const key = 'r' + r;
      const x = gx + rd.C * cs + 26;
      const y = gy + r * cs + cs / 2;
      if (showCheck(key)) statusMark(c, x, y, check('r', r), rd.rowT ? `${rowSum(cur.map((v) => v ?? 0), rd.C, r)}/${rd.rowT[r]}` : undefined);
      else bench.button(c, x - 18, y - 12, 36, 24, 'read', () => read.add(key), { px: 9 });
      if (rd.rowT && showCheck(key)) {
        const st = check('r', r);
        c.fillStyle = st ? pal.accent : pal.signal;
        c.fillRect(x + 22, y - 3, 6, 6);
      }
    }
    for (let k = 0; k < rd.C; k++) {
      const key = 'c' + k;
      const x = gx + k * cs + cs / 2;
      const y = gy + n * cs + 20;
      if (showCheck(key)) statusMark(c, x, y, check('c', k), rd.colT ? `${colSum(cur.map((v) => v ?? 0), rd.R, rd.C, k)}/${rd.colT[k]}` : undefined);
      else bench.button(c, x - 18, y - 12, 36, 24, 'read', () => read.add(key), { px: 9 });
    }
    const by = gy + n * cs + 56;
    if (rd.kind === 'digits' && !reveal) {
      const kw = Math.min(40, (W - 32) / 10 - 4);
      for (let d = 0; d <= 9; d++) bench.button(c, W / 2 - 5 * (kw + 4) + d * (kw + 4), by, kw, 36, String(d), () => setDigit(d), { off: selCell < 0 });
    }
    if (!reveal) bench.button(c, W / 2 - 80, by + (rd.kind === 'digits' ? 46 : 0), 160, 40, 'Verify', verify, { primary: true, key: 'Enter' });
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return false;
  };

  return {
    reset,
    destroy: () => {
      api.ownKeys(false);
      bench.destroy();
    },
  };
};

export default factory;
