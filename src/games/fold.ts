// 44 · FOLD — fold, punch, unfold: predict or construct the pattern.
// The sheet is an N × N grid of cells (N = 4, 6 or 8). A fold is an exact reflection of cell centres across
// a crease: any vertical or horizontal grid line inside the folded sheet (not only its midline — an
// off-centre fold leaves a flap that overhangs or a strip that stays single), or, when the folded sheet is
// square, one of its diagonals (always the last fold). Lines keep the numbers they had on the open sheet
// (0 … N from the left and from the top), even when a flap carries cells past the original edge.
// After the folds each folded position holds a stack of original cells — its fibre; a punch makes a hole in
// every cell of the fibre. Patterns are computed from this model, never drawn by hand. Construction accepts
// any procedure whose unfolded pattern equals the target; the minimum number of operations is found by
// searching every fold sequence (every crease position) and counting the fibres the target needs.
// The fold animation is the true projection of each cell rotating about the crease: p(t) = f + (p − f)·cos πt.
// Difficulty is structural: bigger sheets, off-centre creases, longer procedures, more punches, and at the
// highest level the procedure is only written down — no animation to watch.
import { clamp, font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip } from './kit';
import { famChip, para, Session, type Band, type Family } from './lab';

export type Dir = 'L' | 'R' | 'T' | 'B' | 'D' | 'A';
export interface Fold {
  d: Dir;
  /** Crease line (absolute grid coordinate) for L / R (vertical) and T / B (horizontal); 0 for diagonals. */
  c: number;
}
export const DIR_LABEL: Record<Dir, string> = { L: 'Left part →', R: '← Right part', T: 'Top part ↓', B: 'Bottom part ↑', D: 'Diagonal ⟍', A: 'Diagonal ⟋' };
export const DIRS: Dir[] = ['L', 'R', 'T', 'B', 'D', 'A'];

export function describeFold(f: Fold) {
  switch (f.d) {
    case 'L':
      return `fold everything left of line ${f.c} over to the right`;
    case 'R':
      return `fold everything right of line ${f.c} over to the left`;
    case 'T':
      return `fold everything above line ${f.c} down`;
    case 'B':
      return `fold everything below line ${f.c} up`;
    case 'D':
      return 'fold the lower-left triangle onto the upper-right (crease ⟍)';
    case 'A':
      return 'fold the lower-right triangle onto the upper-left (crease ⟋)';
  }
}

export interface Sheet {
  N: number;
  /** Folded position of every original cell centre (index j·N + i). */
  pos: { x: number; y: number }[];
  folds: Fold[];
  /** After a diagonal fold the sheet is a triangle: no further folds. */
  tri: boolean;
}

export function newSheet(N: number): Sheet {
  return { N, pos: Array.from({ length: N * N }, (_, k) => ({ x: (k % N) + 0.5, y: Math.floor(k / N) + 0.5 })), folds: [], tri: false };
}

/** The folded sheet's extent (cells occupy ±½ around their centres). */
export function bbox(s: Sheet) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of s.pos) {
    x0 = Math.min(x0, p.x - 0.5);
    x1 = Math.max(x1, p.x + 0.5);
    y0 = Math.min(y0, p.y - 0.5);
    y1 = Math.max(y1, p.y + 0.5);
  }
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
}

/** Valid crease positions for a direction (empty if that fold is impossible now). */
export function creases(s: Sheet, d: Dir): number[] {
  if (s.tri) return [];
  const b = bbox(s);
  if (d === 'L' || d === 'R') return Array.from({ length: Math.max(0, b.w - 1) }, (_, i) => b.x0 + 1 + i);
  if (d === 'T' || d === 'B') return Array.from({ length: Math.max(0, b.h - 1) }, (_, i) => b.y0 + 1 + i);
  return b.w === b.h && b.w >= 2 ? [0] : [];
}
export const canFold = (s: Sheet, f: Fold) => creases(s, f.d).includes(f.c);
/** The crease nearest the middle of the folded sheet. */
export const midCrease = (s: Sheet, d: Dir) => {
  const cs = creases(s, d);
  const b = bbox(s);
  const mid = d === 'L' || d === 'R' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
  return cs.length ? cs.reduce((a, c) => (Math.abs(c - mid) < Math.abs(a - mid) ? c : a)) : 0;
};

/** Where a point goes under fold f of sheet s (identity on the staying side). */
export function foldPoint(s: Sheet, f: Fold, p: { x: number; y: number }) {
  const b = bbox(s);
  switch (f.d) {
    case 'L':
      return p.x < f.c ? { x: 2 * f.c - p.x, y: p.y } : p;
    case 'R':
      return p.x > f.c ? { x: 2 * f.c - p.x, y: p.y } : p;
    case 'T':
      return p.y < f.c ? { x: p.x, y: 2 * f.c - p.y } : p;
    case 'B':
      return p.y > f.c ? { x: p.x, y: 2 * f.c - p.y } : p;
    case 'D':
      return p.y - b.y0 > p.x - b.x0 ? { x: b.x0 + (p.y - b.y0), y: b.y0 + (p.x - b.x0) } : p;
    case 'A':
      return p.x - b.x0 + (p.y - b.y0) > b.w ? { x: b.x0 + b.w - (p.y - b.y0), y: b.y0 + b.h - (p.x - b.x0) } : p;
  }
}

export function applyFold(s: Sheet, f: Fold): Sheet {
  return { ...s, pos: s.pos.map((p) => foldPoint(s, f, p)), folds: [...s.folds, f], tri: s.tri || f.d === 'D' || f.d === 'A' };
}

const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
/** Distinct folded positions (where a punch can go), each with its fibre. */
export function fibres(s: Sheet) {
  const m = new Map<string, number[]>();
  s.pos.forEach((p, i) => m.set(key(p), [...(m.get(key(p)) ?? []), i]));
  return m;
}
export const holesOf = (s: Sheet, punches: { x: number; y: number }[]) => {
  const f = fibres(s);
  const out = new Set<number>();
  for (const p of punches) for (const i of f.get(key(p)) ?? []) out.add(i);
  return out;
};

export function foldSeq(N: number, folds: Fold[]) {
  let s = newSheet(N);
  for (const f of folds) {
    if (!canFold(s, f)) return null;
    s = applyFold(s, f);
  }
  return s;
}

/** Fewest folds + punches that produce exactly `target`, over every fold sequence of the allowed directions. */
export function minOps(N: number, target: Set<number>, allowed: Dir[], maxFolds: number, upper?: { ops: number; folds: Fold[] }) {
  // A known procedure (upper bound) lets the search prune every branch that cannot beat it.
  let best: { ops: number; folds: Fold[] } | null = upper ?? null;
  const seen = new Map<string, number>();
  const visit = (s: Sheet) => {
    const fb = fibres(s);
    // Partition signature: each cell labelled by the first cell of its stack (cheap and canonical).
    const first = new Map<string, number>();
    const sig =
      s.pos
        .map((p, i) => {
          const k = key(p);
          if (!first.has(k)) first.set(k, i);
          return first.get(k);
        })
        .join(',') + (s.tri ? 't' : '');
    // The same partition reached with fewer folds dominates.
    if ((seen.get(sig) ?? Infinity) <= s.folds.length) return;
    seen.set(sig, s.folds.length);
    let punches = 0;
    let ok = true;
    for (const cells of fb.values()) {
      const inT = cells.filter((c) => target.has(c)).length;
      if (inT === cells.length) punches++;
      else if (inT) ok = false;
    }
    if (ok && (!best || s.folds.length + punches < best.ops)) best = { ops: s.folds.length + punches, folds: s.folds };
    if (s.folds.length < maxFolds && (!best || s.folds.length + 2 < best.ops))
      for (const d of allowed) for (const c of creases(s, d)) visit(applyFold(s, { d, c }));
  };
  visit(newSheet(N));
  return best as { ops: number; folds: Fold[] } | null;
}

export interface FoldRound {
  kind: 'single' | 'multi' | 'construct' | 'restricted' | 'minimal';
  N: number;
  /** Predict: the folds and punches shown. Construct: one witness procedure. */
  folds: Fold[];
  punches: { x: number; y: number }[];
  target: number[];
  allowed: Dir[];
  maxFolds: number;
  maxPunches: number;
  minOps: number;
  /** How a prediction is presented: 0 animated with replay, 1 animated once, 2 written procedure only. */
  show: 0 | 1 | 2;
}

const SIZES = [4, 6, 8, 8];

function randomProc(r: Rng, N: number, nFolds: number, allowed: Dir[], nPunch: number, offCentre: boolean) {
  let s = newSheet(N);
  for (let i = 0; i < nFolds; i++) {
    // Diagonals only as the last fold.
    const dirs = allowed.filter((d) => creases(s, d).length && (i === nFolds - 1 || (d !== 'D' && d !== 'A')));
    if (!dirs.length) return null;
    const d = r.pick(dirs);
    const c = offCentre && d !== 'D' && d !== 'A' ? r.pick(creases(s, d)) : midCrease(s, d);
    s = applyFold(s, { d, c });
  }
  const fb = [...fibres(s).keys()];
  if (fb.length < nPunch) return null;
  const punches: { x: number; y: number }[] = [];
  while (punches.length < nPunch) {
    const k = r.pick(fb);
    if (punches.some((p) => key(p) === k)) continue;
    const [x, y] = k.split(',').map(Number);
    punches.push({ x, y });
  }
  return { s, punches, target: [...holesOf(s, punches)].sort((a, b) => a - b) };
}

function genPredict(r: Rng, band: Band, multi: boolean): FoldRound | null {
  const N = SIZES[band];
  const nF = multi ? [2, 3, 4, 5][band] : 1;
  const allowed: Dir[] = band === 0 ? ['L', 'R', 'T', 'B'] : DIRS;
  const nP = multi ? [1, 2, 2, 3][band] : [1, 2, 2, 3][band];
  const p = randomProc(r, N, nF, allowed, nP, band >= 1);
  if (!p || p.target.length < 2 + band) return null;
  // At least one punch must go through several layers, or nothing was learned.
  if (!p.punches.some((q) => (fibres(p.s).get(key(q))?.length ?? 0) > 1)) return null;
  return { kind: multi ? 'multi' : 'single', N, folds: p.s.folds, punches: p.punches, target: p.target, allowed, maxFolds: nF, maxPunches: nP, minOps: 0, show: band <= 1 ? 0 : band === 2 ? 1 : 2 };
}

function genConstruct(r: Rng, band: Band, kind: 'construct' | 'restricted' | 'minimal'): FoldRound | null {
  const N = SIZES[band];
  const maxFolds = kind === 'minimal' ? [2, 3, 3, 3][band] : [2, 3, 4, 4][band];
  let allowed: Dir[] = DIRS;
  if (kind === 'restricted') {
    const sets: Dir[][] = [
      ['T', 'B', 'D'],
      ['L', 'R', 'A'],
      ['L', 'T'],
      ['B', 'R', 'D', 'A'],
      ['R', 'T', 'A'],
    ];
    allowed = r.pick(sets);
  }
  const nF = r.int(Math.min(2, maxFolds), maxFolds);
  const p = randomProc(r, N, nF, allowed, r.int([1, 1, 2, 2][band], [2, 3, 3, 4][band]), band >= 1);
  if (!p || p.target.length < 3 + band) return null;
  // Construction must not be solvable as cheaply by punching every hole flat: the witness procedure
  // already proves folding saves work when its operations are fewer than the holes.
  const witness = { ops: p.s.folds.length + p.punches.length, folds: p.s.folds };
  if (witness.ops >= p.target.length) return null;
  // Fewest moves needs the exact minimum (searched below the witness); the others use the witness.
  const best = kind === 'minimal' ? minOps(N, new Set(p.target), allowed, maxFolds, witness)! : witness;
  const maxPunches = (kind === 'minimal' ? best.ops - best.folds.length + 1 : p.punches.length + 1) + (band === 0 ? 1 : 0);
  return { kind, N, folds: p.s.folds, punches: p.punches, target: p.target, allowed, maxFolds, maxPunches: Math.max(maxPunches, p.punches.length), minOps: best.ops, show: 0 };
}

export const FAMILIES: Family<FoldRound>[] = [
  { id: 'single', name: 'One fold', teach: 'Watch the fold and the punch. Then mark every cell that will have a hole when the sheet opens.', bands: [0, 3], intro: true, gen: (r, b) => genPredict(r, b, false), sig: (rd) => `${rd.N}|${JSON.stringify(rd.folds)}|${rd.target.join('.')}` },
  { id: 'multi', name: 'Several folds', teach: 'Each fold mirrors everything that is already folded. Creases need not be in the middle: overhanging flaps make uneven stacks.', bands: [0, 3], gen: (r, b) => genPredict(r, b, true), sig: (rd) => `${rd.N}|${JSON.stringify(rd.folds)}|${rd.target.join('.')}` },
  { id: 'construct', name: 'Construct', teach: 'Make the target: pick a fold direction, move the crease to any line, Fold; tap the folded sheet to punch; Unfold to check.', bands: [0, 3], gen: (r, b) => genConstruct(r, b, 'construct'), sig: (rd) => `${rd.N}|${rd.target.join('.')}` },
  { id: 'restricted', name: 'Restricted creases', teach: 'Only some fold directions are allowed this time. The target can still be made with them.', bands: [1, 3], gen: (r, b) => genConstruct(r, b, 'restricted'), sig: (rd) => `${rd.N}|${rd.allowed.join('')}|${rd.target.join('.')}` },
  { id: 'minimal', name: 'Fewest moves', teach: 'Make the target with as few folds plus punches as possible — every crease that lines holes up saves punches.', bands: [1, 3], gen: (r, b) => genConstruct(r, b, 'minimal'), sig: (rd) => `${rd.N}|${rd.minOps}|${rd.target.join('.')}` },
];

export const ROUNDS = 5;
const STEP_MS = 520;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<FoldRound>(api, 'fold', FAMILIES, ROUNDS);
  let rd: FoldRound;
  let phase: 'watch' | 'mark' | 'build' | 'reveal' | 'done' = 'watch';
  let sheet: Sheet = newSheet(4);
  let history: Sheet[] = [];
  let punched: { x: number; y: number }[] = [];
  let marks = new Set<number>();
  let anim: { from: Sheet; f: Fold; t0: number } | null = null;
  let queue: Fold[] = [];
  let made: Set<number> | null = null;
  let pending: Fold | null = null;
  let replays = 0;
  let geo = { ox: 0, oy: 0, c: 40, area: { x: 0, y: 0, s: 1 } };

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  const predict = () => rd.kind === 'single' || rd.kind === 'multi';

  function begin() {
    rd = sess.next().rd;
    sheet = newSheet(rd.N);
    history = [];
    punched = [];
    marks = new Set();
    made = null;
    anim = null;
    pending = null;
    replays = 0;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    if (predict()) {
      if (rd.show === 2) {
        // Mastery: no animation — the written procedure and the folded result only.
        sheet = foldSeq(rd.N, rd.folds)!;
        punched = [...rd.punches];
        phase = 'mark';
        api.prompt('Read the procedure. Where are the holes?', sess.teach || 'No animation at this level · lines are numbered from the open sheet’s left and top edges · Check when done');
      } else {
        phase = 'watch';
        queue = [...rd.folds];
        api.prompt('Watch the folds and the punches.', sess.teach || (rd.show === 1 ? 'Shown once — no replay at this level' : 'Then mark where the holes will be'));
        nextAnim();
      }
    } else {
      phase = 'build';
      const lim = `≤ ${rd.maxFolds} folds, ≤ ${rd.maxPunches} punches`;
      api.prompt(rd.kind === 'minimal' ? 'Make the target with the fewest folds + punches.' : 'Make the target pattern.', sess.teach || `${lim} · direction → crease → Fold · tap to punch · Unfold checks`);
    }
    stage.request();
  }

  function nextAnim() {
    const f = queue.shift();
    if (!f) {
      punched = [...rd.punches];
      api.sfx.thud();
      bench.later(() => {
        if (phase === 'watch') {
          api.prompt('Where are the holes?', `Tap cells on the open sheet${rd.show === 0 ? ' · Replay shows the folds again' : ''} · Check when done`);
          phase = 'mark';
          stage.request();
        }
      }, 900);
      stage.request();
      return;
    }
    anim = { from: sheet, f, t0: performance.now() };
    api.sfx.whoosh();
  }

  function pick(d: Dir) {
    if (phase !== 'build' || anim || punched.length || sheet.folds.length >= rd.maxFolds || !rd.allowed.includes(d) || !creases(sheet, d).length) return;
    pending = { d, c: midCrease(sheet, d) };
  }

  function nudge(k: number) {
    if (!pending || pending.d === 'D' || pending.d === 'A') return;
    const cs = creases(sheet, pending.d);
    const i = clamp(cs.indexOf(pending.c) + k, 0, cs.length - 1);
    pending = { ...pending, c: cs[i] };
  }

  function confirm() {
    if (phase !== 'build' || anim || !pending || !canFold(sheet, pending)) return;
    history.push(sheet);
    anim = { from: sheet, f: pending, t0: performance.now() };
    pending = null;
    api.sfx.whoosh();
    stage.request();
  }

  function undo() {
    if (phase !== 'build' || anim) return;
    if (pending) pending = null;
    else if (punched.length) punched.pop();
    else if (history.length) sheet = history.pop()!;
  }

  function restart() {
    if (phase !== 'build' || anim) return;
    sheet = newSheet(rd.N);
    history = [];
    punched = [];
    pending = null;
  }

  function replay() {
    if (phase !== 'mark' || rd.show !== 0) return;
    replays++;
    sheet = newSheet(rd.N);
    punched = [];
    queue = [...rd.folds];
    phase = 'watch';
    nextAnim();
  }

  function check() {
    if (phase !== 'mark' && phase !== 'build') return;
    if (phase === 'build' && (!punched.length || anim)) return;
    const target = new Set(rd.target);
    const got = phase === 'mark' ? marks : holesOf(sheet, punched);
    made = got;
    let fp = 0;
    let fn = 0;
    for (const i of got) if (!target.has(i)) fp++;
    for (const i of target) if (!got.has(i)) fn++;
    const exact = fp + fn === 0;
    let pen = Math.min(1, (fp + fn) / target.size);
    const ops = sheet.folds.length + punched.length;
    let main = exact ? 'Exactly the target pattern.' : `${fn} hole${fn === 1 ? '' : 's'} missing, ${fp} extra.`;
    let sub = '';
    if (predict()) {
      if (exact && replays) pen = Math.min(1, pen + 0.05 * replays);
      sub = `Procedure: ${rd.folds.map((f, i) => `${i + 1}. ${describeFold(f)}`).join('; ')}. Each hole reappears mirrored in every crease that covered it.`;
    } else {
      if (exact && rd.kind === 'minimal') {
        pen = Math.min(0.6, 0.15 * Math.max(0, ops - rd.minOps));
        main = `Made it with ${ops} operations (fewest possible: ${rd.minOps}).`;
      } else if (exact) main = `Made it — ${sheet.folds.length} fold${sheet.folds.length === 1 ? '' : 's'}, ${punched.length} punch${punched.length === 1 ? '' : 'es'}.`;
      sub = `One way: ${rd.folds.map((f) => describeFold(f)).join(', then ')}, then ${rd.punches.length} punch${rd.punches.length > 1 ? 'es' : ''}.`;
    }
    phase = 'reveal';
    pending = null;
    sess.done(pen, predict() ? `${fn} missed · ${fp} extra` : exact ? `made in ${ops} ops (min ${rd.minOps})` : `${fn} missing · ${fp} extra`, { x: stage.w / 2, y: 120 });
    api.sfx[exact ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per sheet (wrong holes, then extra operations)', share: 'FOLD' });
      if (r) bench.finish(r);
    }
  }

  /** Grid coordinate under a stage point. */
  const toGrid = (p: { x: number; y: number }) => ({ x: (p.x - geo.ox) / geo.c, y: (p.y - geo.oy) / geo.c });

  bench.onTap = (p) => {
    if (phase === 'reveal') return begin();
    const g = toGrid(p);
    if (phase === 'mark') {
      // Marks go on the open sheet (drawn in the same place for every presentation).
      const i = Math.floor(g.x);
      const j = Math.floor(g.y);
      if (i >= 0 && j >= 0 && i < rd.N && j < rd.N && openShown()) {
        const k = j * rd.N + i;
        marks.has(k) ? marks.delete(k) : marks.add(k);
        api.sfx.soft();
      }
    } else if (phase === 'build' && !anim) {
      if (pending && pending.d !== 'D' && pending.d !== 'A') {
        // Tap near a grid line to put the crease there.
        const v = pending.d === 'L' || pending.d === 'R' ? g.x : g.y;
        const cs = creases(sheet, pending.d);
        const c = cs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), cs[0]);
        pending = { ...pending, c };
        return;
      }
      const q = { x: Math.floor(g.x) + 0.5, y: Math.floor(g.y) + 0.5 };
      if (!fibres(sheet).has(key(q))) return;
      if (punched.some((x) => key(x) === key(q))) punched = punched.filter((x) => key(x) !== key(q));
      else if (punched.length < rd.maxPunches) {
        punched.push(q);
        api.sfx.thud();
      }
    }
  };
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (pending && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) nudge(-1);
    else if (pending && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) nudge(1);
    else if (pending && e.key === 'Enter') confirm();
    else if (e.key === 'Enter') check();
    else if (e.key === 'Backspace' || e.key === 'u' || e.key === 'U') undo();
    else return;
    e.preventDefault();
  };

  /** In mark phase the open sheet is shown for marking (the folded result sits beside it at mastery). */
  const openShown = () => phase === 'mark' || phase === 'reveal' || phase === 'done';

  function hole(c: CanvasRenderingContext2D, x: number, y: number, col: string, r = geo.c * 0.22) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = pal.paper;
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.stroke();
  }

  /** Draw a folded sheet (stacks darker where thicker) with its own origin; returns that origin. */
  function drawFolded(c: CanvasRenderingContext2D, s: Sheet, cx: number, cy: number, cs: number, labels: boolean, counts: boolean) {
    const b = bbox(s);
    const ox = cx - ((b.x0 + b.x1) / 2) * cs;
    const oy = cy - ((b.y0 + b.y1) / 2) * cs;
    for (const [k, cells] of fibres(s)) {
      const [x, y] = k.split(',').map(Number);
      const px = ox + (x - 0.5) * cs;
      const py = oy + (y - 0.5) * cs;
      rr(c, px + 1, py + 1, cs - 2, cs - 2, 3);
      c.fillStyle = alpha(pal.ink, Math.min(0.6, 0.1 + 0.07 * cells.length));
      c.fill();
      if (counts && cells.length > 1) text(c, `×${cells.length}`, px + cs - 4, py + 10, font.mono(8, 500), pal.ink3, 'right');
    }
    if (labels) {
      for (let v = Math.ceil(b.x0); v <= b.x1; v++) text(c, String(v), ox + v * cs, oy + b.y0 * cs - 8, font.mono(8, 500), pal.ink3, 'center');
      for (let v = Math.ceil(b.y0); v <= b.y1; v++) text(c, String(v), ox + b.x0 * cs - 8, oy + v * cs + 3, font.mono(8, 500), pal.ink3, 'right');
    }
    return { ox, oy };
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const N = rd.N;
    const wide = W >= 760;
    // Narrow screens stack the controls under the sheet, so the sheet leaves them room.
    const below = wide ? 146 : predict() ? (rd.show === 2 ? 330 : 80) : 300;
    const size = Math.max(160, Math.min(wide ? W * 0.4 : W - 40, H - 124 - below, 400));
    const cs = size / N;
    const area = { x: wide ? W * 0.27 : W / 2, y: 124 + size / 2, s: size };
    geo = { ox: area.x - size / 2, oy: area.y - size / 2, c: cs, area };
    let more = false;
    plate(c, area.x - size / 2 - 12, area.y - size / 2 - 12, size + 24, size + 24, 8);
    if (anim) {
      const t = clamp((now - anim.t0) / (api.motion() ? STEP_MS : 80), 0, 1);
      const from = anim.from;
      const to = applyFold(from, anim.f);
      // Centre on the union of the two extents so the motion does not jump.
      const b0 = bbox(from);
      const b1 = bbox(to);
      const ox = area.x - ((Math.min(b0.x0, b1.x0) + Math.max(b0.x1, b1.x1)) / 2) * cs;
      const oy = area.y - ((Math.min(b0.y0, b1.y0) + Math.max(b0.y1, b1.y1)) / 2) * cs;
      from.pos.forEach((p, i) => {
        const q = to.pos[i];
        let x = p.x;
        let y = p.y;
        let back = false;
        if (p.x !== q.x || p.y !== q.y) {
          const fx = (p.x + q.x) / 2;
          const fy = (p.y + q.y) / 2;
          const k = Math.cos(Math.PI * t);
          x = fx + (p.x - fx) * k;
          y = fy + (p.y - fy) * k;
          back = k < 0;
        }
        c.fillStyle = back ? alpha(AMBER, 0.32) : alpha(pal.ink, 0.13);
        c.fillRect(ox + (x - 0.5) * cs + 1, oy + (y - 0.5) * cs + 1, cs - 2, cs - 2);
      });
      if (t >= 1) {
        sheet = to;
        anim = null;
        if (phase === 'watch') bench.later(nextAnim, 160);
      }
      more = true;
    } else if (openShown()) {
      for (let k = 0; k < N * N; k++) {
        rr(c, geo.ox + (k % N) * cs + 1, geo.oy + Math.floor(k / N) * cs + 1, cs - 2, cs - 2, 3);
        c.fillStyle = alpha(pal.ink, 0.1);
        c.fill();
      }
      for (let v = 0; v <= N; v++) {
        text(c, String(v), geo.ox + v * cs, geo.oy - 6, font.mono(8, 500), pal.ink3, 'center');
        text(c, String(v), geo.ox - 6, geo.oy + v * cs + 3, font.mono(8, 500), pal.ink3, 'right');
      }
      const target = new Set(rd.target);
      for (let k = 0; k < N * N; k++) {
        const x = geo.ox + ((k % N) + 0.5) * cs;
        const y = geo.oy + (Math.floor(k / N) + 0.5) * cs;
        if (phase === 'mark') {
          if (marks.has(k)) hole(c, x, y, AMBER);
        } else {
          const mine = made?.has(k);
          if (target.has(k)) hole(c, x, y, mine ? pal.accent : pal.signal);
          else if (mine) {
            hole(c, x, y, pal.signal);
            c.strokeStyle = pal.signal;
            c.beginPath();
            c.moveTo(x - cs * 0.3, y - cs * 0.3);
            c.lineTo(x + cs * 0.3, y + cs * 0.3);
            c.stroke();
          }
        }
      }
    } else {
      const o = drawFolded(c, sheet, area.x, area.y, cs, true, sess.curBand < 2);
      geo.ox = o.ox;
      geo.oy = o.oy;
      for (const p of punched) hole(c, o.ox + p.x * cs, o.oy + p.y * cs, pal.accent);
      if (pending) {
        c.save();
        c.strokeStyle = pal.accent;
        c.setLineDash([6, 4]);
        c.lineWidth = 2;
        const b = bbox(sheet);
        c.beginPath();
        if (pending.d === 'L' || pending.d === 'R') {
          c.moveTo(o.ox + pending.c * cs, o.oy + b.y0 * cs - 14);
          c.lineTo(o.ox + pending.c * cs, o.oy + b.y1 * cs + 14);
        } else if (pending.d === 'T' || pending.d === 'B') {
          c.moveTo(o.ox + b.x0 * cs - 14, o.oy + pending.c * cs);
          c.lineTo(o.ox + b.x1 * cs + 14, o.oy + pending.c * cs);
        } else if (pending.d === 'D') {
          c.moveTo(o.ox + b.x0 * cs, o.oy + b.y0 * cs);
          c.lineTo(o.ox + b.x1 * cs, o.oy + b.y1 * cs);
        } else {
          c.moveTo(o.ox + b.x1 * cs, o.oy + b.y0 * cs);
          c.lineTo(o.ox + b.x0 * cs, o.oy + b.y1 * cs);
        }
        c.stroke();
        c.restore();
      }
    }
    // Side panel.
    const px = wide ? W * 0.52 : 16;
    let py = wide ? 124 : area.y + size / 2 + 26;
    const pw = wide ? W - px - 20 : W - 32;
    if (predict()) {
      if (phase === 'mark' && rd.show === 2) {
        // Mastery: the written procedure and the folded result with its punches.
        text(c, 'PROCEDURE', px, py, font.mono(10, 600), pal.ink3);
        py += 8;
        rd.folds.forEach((f, i) => {
          py += para(c, `${i + 1}. ${describeFold(f)}`, px, py + 14, pw, font.mono(11, 500), pal.ink, 15);
        });
        py += para(c, `${rd.folds.length + 1}. punch the ${rd.punches.length} marked spot${rd.punches.length > 1 ? 's' : ''}:`, px, py + 14, pw, font.mono(11, 500), pal.ink, 15) + 6;
        const fs = Math.min(150, pw * 0.5);
        const f = foldSeq(rd.N, rd.folds)!;
        const fb = bbox(f);
        const fcs = fs / Math.max(fb.w, fb.h);
        const o = drawFolded(c, f, px + fs / 2 + 20, py + fs / 2 + 14, fcs, true, false);
        for (const p of rd.punches) hole(c, o.ox + p.x * fcs, o.oy + p.y * fcs, pal.accent, fcs * 0.22);
        py += fs + 40;
      }
      if (phase === 'mark') {
        if (rd.show === 0) bench.button(c, px, py, 120, 40, 'Replay', replay);
        bench.button(c, px + (rd.show === 0 ? 130 : 0), py, 150, 40, `Check · ${marks.size}`, check, { primary: true, key: 'Enter' });
      }
    } else {
      const ts = wide ? Math.min(170, pw * 0.4) : 92;
      const tc = ts / N;
      text(c, 'TARGET', px, py - 6, font.mono(10, 600), pal.ink3);
      for (let k = 0; k < N * N; k++) {
        const x = px + (k % N) * tc;
        const y = py + Math.floor(k / N) * tc;
        c.fillStyle = alpha(pal.ink, 0.1);
        c.fillRect(x + 1, y + 1, tc - 2, tc - 2);
        if (rd.target.includes(k)) {
          c.beginPath();
          c.arc(x + tc / 2, y + tc / 2, tc * 0.26, 0, Math.PI * 2);
          c.fillStyle = pal.accent;
          c.fill();
        }
      }
      // Wide: buttons under the target. Narrow: buttons beside it.
      const bx = wide ? px : px + ts + 12;
      if (wide) py += ts + 22;
      if (phase === 'build') {
        const bw = Math.min(112, (pw - (bx - px) - 12) / 3);
        DIRS.forEach((d, i) => {
          const ok = rd.allowed.includes(d) && creases(sheet, d).length > 0 && !anim && sheet.folds.length < rd.maxFolds && !punched.length;
          bench.button(c, bx + (i % 3) * (bw + 6), py + Math.floor(i / 3) * 44, bw, 38, DIR_LABEL[d], () => pick(d), { off: !ok, sel: pending?.d === d, px: 11 });
        });
        py += wide ? 96 : Math.max(ts, 82) + 18;
        if (pending) {
          text(c, pending.d === 'D' || pending.d === 'A' ? 'diagonal crease' : `crease at line ${pending.c}`, px, py + 4, font.mono(11, 600), pal.accent);
          if (pending.d !== 'D' && pending.d !== 'A') {
            bench.button(c, px, py + 14, 46, 36, '◀', () => nudge(-1));
            bench.button(c, px + 52, py + 14, 46, 36, '▶', () => nudge(1));
          }
          bench.button(c, px + 106, py + 14, 100, 36, 'Fold', confirm, { primary: true, key: 'Enter' });
          bench.button(c, px + 212, py + 14, 90, 36, 'Cancel', () => (pending = null));
          py += 60;
        }
        text(c, `folds ${sheet.folds.length}/${rd.maxFolds} · punches ${punched.length}/${rd.maxPunches}${rd.kind === 'minimal' ? ` · ops ${sheet.folds.length + punched.length}` : ''}`, px, py + 4, font.mono(11, 500), pal.ink2);
        bench.button(c, px, py + 14, 96, 38, 'Undo', undo, { key: 'U', off: !history.length && !punched.length && !pending });
        bench.button(c, px + 102, py + 14, 96, 38, 'Reset', restart, { off: !history.length && !punched.length });
        bench.button(c, px + 204, py + 14, 120, 38, 'Unfold', check, { primary: !pending, off: !punched.length || !!anim || !!pending });
      }
    }
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return more;
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
