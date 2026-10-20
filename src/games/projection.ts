// 48 · PROJECTION — rebuild a 3-D structure from its 2-D views.
// Structures are sets of unit cubes (voxels) in an n × n × n box (n = 3, 4 or 5). Above the onboarding
// level cubes may float: overhangs, bridges and hidden cavities are allowed, so a view no longer tells you
// how high a column is filled. Views are orthographic silhouettes computed from the voxels:
//   front F(x, z) = some cube at (x, ·, z)    side S(y, z) = some cube at (·, y, z)    top T(x, y) = some cube at (x, y, ·)
// At higher levels some views are given from the opposite side (back, left, bottom) — the same silhouette
// mirrored — and must be turned round mentally. You build layer by layer. Every target is generated as a
// voxel set first, so a solution exists, and any structure meeting every constraint is accepted.
// The fewest-cubes answer is exact: every view pixel needs a cube, a cube can only sit where all three views
// allow it and covers one pixel of each view; the minimum cover is found by branch and bound.
import { font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, shuffle } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

/** Voxel set: index (z·n + y)·n + x; z is height (0 = floor), y = 0 is the front row. */
export type Vox = number[];
const at = (n: number, x: number, y: number, z: number) => (z * n + y) * n + x;
export const count = (v: Vox) => v.reduce((a, b) => a + b, 0);

/** Silhouettes as n × n bit arrays: front[z·n + x], side[z·n + y], top[y·n + x]. */
export function views(v: Vox, n: number) {
  const F = Array(n * n).fill(0);
  const S = Array(n * n).fill(0);
  const T = Array(n * n).fill(0);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (v[at(n, x, y, z)]) {
          F[z * n + x] = 1;
          S[z * n + y] = 1;
          T[y * n + x] = 1;
        }
  return { F, S, T };
}
const eq = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);

export type ViewKind = 'F' | 'S' | 'T';
/** How a view is shown: from its usual side, or from the opposite side (mirrored). */
export interface ViewSpec {
  k: ViewKind;
  flip: boolean;
}
export const VIEW_NAME: Record<ViewKind, [string, string]> = { F: ['FRONT', 'BACK'], S: ['RIGHT SIDE', 'LEFT SIDE'], T: ['TOP', 'BOTTOM'] };

export interface ProjRound {
  kind: 'three' | 'missing' | 'minimum' | 'forbidden' | 'ambiguity';
  n: number;
  target: Vox;
  given: ViewSpec[];
  cubes?: number;
  forbidden?: number[];
  minCubes?: number;
  other?: Vox;
  probes?: { label: string; ok: boolean }[];
  /** 0: your projections shown with match colours · 1: shown without colours · 2: not shown. */
  feedback: 0 | 1 | 2;
}

export function violations(rd: ProjRound, v: Vox) {
  const out: string[] = [];
  const a = views(v, rd.n);
  const t = views(rd.target, rd.n);
  for (const g of rd.given) if (!eq(a[g.k], t[g.k])) out.push(`${VIEW_NAME[g.k][g.flip ? 1 : 0].toLowerCase()} view`);
  if (rd.cubes !== undefined && count(v) !== rd.cubes) out.push(`exactly ${rd.cubes} cubes`);
  if (rd.forbidden?.some((i) => v[i])) out.push('a forbidden position');
  return out;
}

/** Positions where a cube is allowed by all three views of t. */
export function allowed(t: Vox, n: number) {
  const { F, S, T } = views(t, n);
  const out: number[] = [];
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (F[z * n + x] && S[z * n + y] && T[y * n + x]) out.push(at(n, x, y, z));
  return out;
}

/** Exact minimum number of cubes reproducing all three views of t (branch and bound; null if too large). */
export function minimumCubes(t: Vox, n: number, nodeLimit = 400000): number | null {
  const { F, S, T } = views(t, n);
  const cand = allowed(t, n).map((i) => {
    const x = i % n;
    const y = Math.floor(i / n) % n;
    const z = Math.floor(i / (n * n));
    return [z * n + x, n * n + z * n + y, 2 * n * n + y * n + x];
  });
  const need = [...F, ...S, ...T];
  const covered = Array(need.length).fill(0);
  const byPix: number[][] = need.map(() => []);
  cand.forEach((c, k) => c.forEach((p) => byPix[p].push(k)));
  let best = count(t);
  let nodes = 0;
  const unc = () => {
    let a = 0,
      b = 0,
      c = 0;
    for (let p = 0; p < need.length; p++)
      if (need[p] && !covered[p]) {
        if (p < n * n) a++;
        else if (p < 2 * n * n) b++;
        else c++;
      }
    return Math.max(a, b, c);
  };
  const rec = (used: number) => {
    if (++nodes > nodeLimit) return;
    const lb = unc();
    if (lb === 0) {
      best = Math.min(best, used);
      return;
    }
    if (used + lb >= best) return;
    // Branch on the uncovered pixel with the fewest candidate cubes.
    let pix = -1;
    let fewest = Infinity;
    for (let p = 0; p < need.length; p++) if (need[p] && !covered[p] && byPix[p].length < fewest) [pix, fewest] = [p, byPix[p].length];
    for (const k of byPix[pix]) {
      for (const p of cand[k]) covered[p]++;
      rec(used + 1);
      for (const p of cand[k]) covered[p]--;
    }
  };
  rec(0);
  return nodes > nodeLimit ? null : best;
}

const SIZES = [3, 4, 4, 5];
const DENSITY = [0, 0.3, 0.27, 0.22];

function randVox(r: Rng, n: number, band: Band): Vox | null {
  const v = Array(n * n * n).fill(0);
  if (band === 0) {
    // Onboarding: stacks standing on the floor.
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const h = r.next() < 0.6 ? r.int(1, n) : 0;
        for (let z = 0; z < h; z++) v[at(n, x, y, z)] = 1;
      }
  } else for (let i = 0; i < v.length; i++) v[i] = r.next() < DENSITY[band] ? 1 : 0;
  const c = count(v);
  if (c < n + 2) return null;
  // Views that are completely full say nothing; require some empty pixels in every view.
  const { F, S, T } = views(v, n);
  if ([F, S, T].some((a) => a.every(Boolean))) return null;
  // Above onboarding there must be real ambiguity: cubes the views allow that the target does not use.
  if (band > 0 && allowed(v, n).length < c + n) return null;
  return v;
}

function givenViews(r: Rng, band: Band, kinds: ViewKind[]): ViewSpec[] {
  // From band 2 one view (band 3: two) is shown from the opposite side.
  const flips = band >= 3 ? 2 : band === 2 ? 1 : 0;
  const pick = new Set(shuffle([...kinds], r.next).slice(0, flips));
  return kinds.map((k) => ({ k, flip: pick.has(k) }));
}

const fb = (band: Band): 0 | 1 | 2 => (band <= 1 ? 0 : band === 2 ? 1 : 2);

function genThree(r: Rng, band: Band): ProjRound | null {
  const n = SIZES[band];
  const t = randVox(r, n, band);
  if (!t) return null;
  return { kind: 'three', n, target: t, given: givenViews(r, band, ['F', 'S', 'T']), feedback: fb(band) };
}

function genMissing(r: Rng, band: Band): ProjRound | null {
  const n = SIZES[band];
  const t = randVox(r, n, band);
  if (!t) return null;
  const drop = r.pick(['F', 'S', 'T'] as ViewKind[]);
  return { kind: 'missing', n, target: t, given: givenViews(r, band, (['F', 'S', 'T'] as ViewKind[]).filter((k) => k !== drop)), cubes: count(t), feedback: fb(band) };
}

function genMinimum(r: Rng, band: Band): ProjRound | null {
  const n = Math.min(SIZES[band], 4);
  const t = randVox(r, n, band);
  if (!t) return null;
  const m = minimumCubes(t, n);
  if (m === null || m >= count(t) - (band >= 2 ? 2 : 1)) return null;
  return { kind: 'minimum', n, target: t, given: givenViews(r, band, ['F', 'S', 'T']), minCubes: m, feedback: fb(band) };
}

function genForbidden(r: Rng, band: Band): ProjRound | null {
  const n = SIZES[band];
  const t = randVox(r, n, band);
  if (!t) return null;
  // Forbid positions the views allow but the target leaves empty — exactly where a careless build goes.
  const tempting = allowed(t, n).filter((i) => !t[i]);
  if (tempting.length < 3) return null;
  const forbidden = shuffle(tempting, r.next).slice(0, Math.min(tempting.length, [2, 3, 5, 7][band]));
  return { kind: 'forbidden', n, target: t, given: givenViews(r, band, ['F', 'S', 'T']), forbidden, feedback: fb(band) };
}

export const posName = (n: number, i: number) => {
  const x = i % n;
  const y = Math.floor(i / n) % n;
  const z = Math.floor(i / (n * n));
  return `${'ABCDE'[x]}${y + 1} level ${z + 1}`;
};

function genAmbiguity(r: Rng, band: Band): ProjRound | null {
  const n = Math.max(3, SIZES[band]);
  const t = randVox(r, n, Math.max(1, band) as Band);
  if (!t) return null;
  const V = views(t, n);
  // Another structure with identical views: remove cubes that no view depends on, and (from band 2) add
  // allowed ones — so the difference is not just "fewer cubes".
  const other = [...t];
  let changed = 0;
  for (const i of shuffle(
    t.map((_, i) => i),
    r.next,
  )) {
    if (!other[i]) continue;
    other[i] = 0;
    const w = views(other, n);
    if (eq(w.F, V.F) && eq(w.S, V.S) && eq(w.T, V.T)) changed++;
    else other[i] = 1;
    if (changed >= 2) break;
  }
  if (band >= 2) for (const i of shuffle(allowed(t, n).filter((i) => !t[i]), r.next).slice(0, 1)) other[i] = 1;
  if (!changed || eq(other, t)) return null;
  const diff = t.map((_, i) => (t[i] !== other[i] ? i : -1)).filter((i) => i >= 0);
  const same = t.map((_, i) => (t[i] === other[i] && allowed(t, n).includes(i) ? i : -1)).filter((i) => i >= 0);
  if (same.length < 2) return null;
  const yes = diff.map((i) => ({ label: `Is there a cube at ${posName(n, i)}?`, ok: true }));
  const no = [...shuffle(same, r.next).slice(0, 2).map((i) => ({ label: `Is there a cube at ${posName(n, i)}?`, ok: false })), { label: 'A view from the back', ok: false }, { label: 'A view from below', ok: false }];
  const probes = shuffle([r.pick(yes), ...shuffle(no, r.next).slice(0, 3)], r.next);
  return { kind: 'ambiguity', n, target: t, given: [{ k: 'F', flip: false }, { k: 'S', flip: false }, { k: 'T', flip: false }], other, probes, feedback: 1 };
}

export const FAMILIES: Family<ProjRound>[] = [
  { id: 'three', name: 'Three views', teach: 'Build layer by layer: pick a level, tap cells to place cubes. Match every view — at higher levels cubes may float.', bands: [0, 3], intro: true, gen: genThree, sig: (rd) => rd.target.join('') },
  { id: 'missing', name: 'Missing view', teach: 'One view is missing — but the number of cubes is fixed. Any structure that fits counts.', bands: [1, 3], gen: genMissing, sig: (rd) => `${rd.given.map((g) => g.k).join('')}|${rd.target.join('')}` },
  { id: 'minimum', name: 'Fewest cubes', teach: 'Match all three views with as few cubes as possible: place cubes where they cover a pixel of every view.', bands: [0, 3], gen: genMinimum, sig: (rd) => rd.target.join('') },
  { id: 'forbidden', name: 'Forbidden cells', teach: 'Match the views without using any crossed-out position.', bands: [1, 3], gen: genForbidden, sig: (rd) => `${rd.target.join('')}|${rd.forbidden}` },
  { id: 'ambiguity', name: 'Ambiguity', teach: 'Two different structures, identical views. Which measurement would tell them apart?', bands: [1, 3], gen: genAmbiguity, sig: (rd) => `${rd.target.join('')}|${rd.other!.join('')}` },
];

export const ROUNDS = 5;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<ProjRound>(api, 'projection', FAMILIES, ROUNDS);
  let rd: ProjRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let v: Vox = [];
  let layer = 0;
  let cursor = 0;
  let turn = 0;
  let pick = -1;
  let edits = 0;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    v = Array(rd.n ** 3).fill(0);
    layer = 0;
    cursor = 0;
    turn = 0;
    pick = -1;
    edits = 0;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const flipped = rd.given.some((g) => g.flip) ? ' Amber-labelled views are seen from the opposite side (mirrored left ↔ right).' : '';
    const ask = {
      three: 'Build a structure with these views.',
      missing: `Build a structure with these two views, using exactly ${rd.cubes} cubes.`,
      minimum: 'Match all three views with the fewest cubes.',
      forbidden: 'Match the views — crossed positions must stay empty.',
      ambiguity: 'Both structures have exactly these views. Which measurement would tell them apart?',
    }[rd.kind];
    api.prompt(ask + flipped, sess.teach || (rd.kind === 'ambiguity' ? 'Tap an option' : `Levels: [ ] or tabs · arrows + Space place · Enter check${rd.feedback === 2 ? ' · mastery: your own views are hidden' : ''}`));
    stage.request();
  }

  const n = () => rd.n;

  function toggle(i: number) {
    if (phase !== 'play' || rd.kind === 'ambiguity') return;
    if (rd.forbidden?.includes(i) && !v[i]) return;
    v[i] ^= 1;
    edits++;
    api.sfx.soft();
  }

  function check(choice?: number) {
    if (phase !== 'play') return;
    let pen = 1;
    let main = '';
    let sub = '';
    let note = '';
    if (rd.kind === 'ambiguity') {
      if (choice === undefined) return;
      pick = choice;
      const p = rd.probes![choice];
      pen = p.ok ? 0 : 1;
      main = p.ok ? 'Yes — that position differs between the two.' : `“${p.label}” would give the same answer for both.`;
      sub = 'Silhouettes record only whether a line of sight is blocked: cubes hidden behind others — and cavities inside — are invisible. A back or bottom view is just a mirrored front or top.';
      note = p.ok ? 'chose a distinguishing measurement' : 'chose an uninformative measurement';
    } else {
      const bad = violations(rd, v);
      if (!bad.length) {
        pen = 0;
        main = 'Every constraint satisfied.';
        if (rd.kind === 'minimum') {
          const extra = count(v) - rd.minCubes!;
          pen = Math.min(0.8, 0.15 * extra);
          main = extra ? `Valid, with ${count(v)} cubes — ${rd.minCubes} is the minimum.` : `Valid and minimal: ${count(v)} cubes.`;
        }
        sub = rd.kind === 'minimum' ? 'Each cube covers one pixel of each view: the best cubes sit where front, side and top pixels can all be served at once.' : 'Several structures fit; yours is one of them.';
        note = `valid · ${count(v)} cubes · ${edits} edits`;
      } else {
        main = `Not yet: the ${bad.join(', ')} ${bad.length > 1 ? 'do' : 'does'} not match.`;
        sub = 'The target is shown beside yours in the reveal; compare level by level.';
        const total = rd.given.length + (rd.cubes !== undefined ? 1 : 0) + (rd.forbidden ? 1 : 0);
        pen = Math.min(1, 0.45 + (0.55 * bad.length) / total);
        note = `failed: ${bad.join(', ')}`;
      }
    }
    phase = 'reveal';
    sess.done(pen, note, { x: stage.w / 2, y: 120 });
    api.sfx[pen < 0.5 ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per structure (unmet views, then extra cubes)', share: 'PROJECTION' });
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
    const N = n();
    const x = cursor % N;
    const y = Math.floor(cursor / N);
    if (rd.kind === 'ambiguity') {
      if (/^[1-4]$/.test(e.key)) check(Number(e.key) - 1);
      else return;
    } else if (e.key === 'ArrowLeft') cursor = y * N + ((x + N - 1) % N);
    else if (e.key === 'ArrowRight') cursor = y * N + ((x + 1) % N);
    else if (e.key === 'ArrowUp') cursor = ((y + 1) % N) * N + x;
    else if (e.key === 'ArrowDown') cursor = ((y + N - 1) % N) * N + x;
    else if (e.key === ']' || e.key === 'PageUp') layer = Math.min(N - 1, layer + 1);
    else if (e.key === '[' || e.key === 'PageDown') layer = Math.max(0, layer - 1);
    else if (e.code === 'Space') toggle(layer * N * N + cursor);
    else if (e.key === 'Enter') check();
    else return;
    e.preventDefault();
  };

  /** Isometric voxels, painter's order, turned by quarter turns. */
  function iso(c: CanvasRenderingContext2D, vx: Vox, N: number, cx: number, cy: number, s: number, hi = -1) {
    const rot = (x: number, y: number) => {
      let a = x;
      let b = y;
      for (let k = 0; k < turn; k++) [a, b] = [N - 1 - b, a];
      return [a, b];
    };
    const P = (x: number, y: number, z: number) => ({ x: cx + (x - y) * s * 0.87, y: cy + (x + y) * s * 0.5 - z * s });
    c.strokeStyle = pal.line2;
    for (let i = 0; i <= N; i++) {
      const a = P(i, 0, 0);
      const b = P(i, N, 0);
      const d = P(0, i, 0);
      const e = P(N, i, 0);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.moveTo(d.x, d.y);
      c.lineTo(e.x, e.y);
      c.stroke();
    }
    const cubes: { x: number; y: number; z: number; hl: boolean }[] = [];
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          if (vx[at(N, x, y, z)]) {
            const [a, b] = rot(x, N - 1 - y);
            cubes.push({ x: a, y: b, z, hl: z === hi });
          }
    cubes.sort((p, q) => p.x + p.y - (q.x + q.y) || p.z - q.z);
    for (const q of cubes) {
      const face = (pts: { x: number; y: number }[], k: number) => {
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.closePath();
        c.fillStyle = alpha(q.hl ? AMBER : pal.accent, k);
        c.fill();
        c.strokeStyle = alpha(pal.paper, 0.7);
        c.lineWidth = 1;
        c.stroke();
      };
      face([P(q.x, q.y + 1, q.z + 1), P(q.x + 1, q.y + 1, q.z + 1), P(q.x + 1, q.y + 1, q.z), P(q.x, q.y + 1, q.z)], 0.35);
      face([P(q.x + 1, q.y, q.z + 1), P(q.x + 1, q.y + 1, q.z + 1), P(q.x + 1, q.y + 1, q.z), P(q.x + 1, q.y, q.z)], 0.52);
      face([P(q.x, q.y, q.z + 1), P(q.x + 1, q.y, q.z + 1), P(q.x + 1, q.y + 1, q.z + 1), P(q.x, q.y + 1, q.z + 1)], 0.8);
    }
  }

  /** A silhouette panel: the target's (grey) and — depending on the level — yours over it. */
  function viewPanel(c: CanvasRenderingContext2D, x: number, y: number, s: number, g: ViewSpec, mine: Vox | null) {
    const N = n();
    const tv = views(rd.target, N)[g.k];
    const mv = mine ? views(mine, N)[g.k] : null;
    plate(c, x - 6, y - 18, N * s + 12, N * s + 30, 6);
    text(c, VIEW_NAME[g.k][g.flip ? 1 : 0], x, y - 6, font.mono(9, 600), g.flip ? AMBER : pal.ink3);
    for (let row = 0; row < N; row++)
      for (let col = 0; col < N; col++) {
        // Front / side: rows are heights (top row = highest). Top: rows are depth (top row = back).
        const a = g.flip ? N - 1 - col : col;
        const b = N - 1 - row;
        const idx = b * N + a;
        const cx = x + col * s;
        const cy = y + row * s;
        c.strokeStyle = pal.line2;
        c.strokeRect(cx + 0.5, cy + 0.5, s - 1, s - 1);
        if (tv[idx]) {
          c.fillStyle = alpha(pal.ink, 0.3);
          c.fillRect(cx + 2, cy + 2, s - 4, s - 4);
        }
        if (mv && mv[idx]) {
          c.fillStyle = rd.feedback === 0 || phase !== 'play' ? (tv[idx] ? pal.accent : pal.signal) : AMBER;
          c.fillRect(cx + s * 0.3, cy + s * 0.3, s * 0.4, s * 0.4);
        }
      }
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const N = n();
    const reveal = phase !== 'play';
    if (rd.kind === 'ambiguity') {
      const s = Math.min(30, W / 22);
      iso(c, rd.target, N, W * 0.3, 150, s);
      iso(c, rd.other!, N, W * 0.7, 150, s);
      const ly = 150 + N * s * 1.5 + 20;
      text(c, 'Structure A', W * 0.3, ly, font.mono(10, 600), pal.ink3, 'center');
      text(c, 'Structure B', W * 0.7, ly, font.mono(10, 600), pal.ink3, 'center');
      const vs = Math.min(20, W / 50);
      const vy = ly + 40;
      rd.given.forEach((g, i) => viewPanel(c, W / 2 + (i - 1.5) * (N * vs + 30), vy, vs, g, null));
      const items = rd.probes!.map((p, i) => ({ label: p.label, run: () => check(i), o: { key: String(i + 1), off: reveal, sel: reveal && (p.ok || i === pick), color: reveal ? (p.ok ? pal.accent : pal.signal) : undefined, px: 11 } }));
      bench.row(c, W / 2, vy + N * vs + 26, Math.min(980, W - 32), items, 46);
      roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
      return false;
    }
    const wide = W >= 860;
    // Layer editor (narrow screens: the left half, with the 3-D preview in the right half).
    const gs = wide ? Math.min(54, (W - 60) / (N + 4), (H - 330) / N) : Math.min(42, (W - 56) / 2 / N, (H - 400) / N);
    const gx = 24;
    const gy = 168;
    for (let z = 0; z < N; z++) bench.button(c, gx + z * 58, 116, 52, 30, `L${z + 1}`, () => (layer = z), { sel: z === layer, px: 11, off: reveal });
    plate(c, gx - 8, gy - 10, N * gs + 16, N * gs + 20, 8);
    for (let row = 0; row < N; row++)
      for (let x = 0; x < N; x++) {
        const y = N - 1 - row; // back row at the top, front row at the bottom
        const i = layer * N * N + y * N + x;
        const px = gx + x * gs;
        const py = gy + row * gs;
        const forb = rd.forbidden?.includes(i);
        const below = layer > 0 && v[i - N * N];
        rr(c, px + 2, py + 2, gs - 4, gs - 4, 5);
        c.fillStyle = v[i] ? alpha(pal.accent, 0.55) : forb ? alpha(pal.signal, 0.12) : below ? alpha(pal.ink, 0.08) : pal.paper2;
        c.fill();
        c.strokeStyle = y * N + x === cursor && !reveal ? pal.accent : pal.line;
        c.lineWidth = y * N + x === cursor ? 1.5 : 1;
        c.stroke();
        if (forb) text(c, '✕', px + gs / 2, py + gs / 2, font.mono(16, 600), pal.signal, 'center', 'middle');
        if (!reveal) bench.hit(px + 2, py + 2, gs - 4, gs - 4, () => ((cursor = y * N + x), toggle(i)));
      }
    for (let x = 0; x < N; x++) text(c, 'ABCDE'[x], gx + x * gs + gs / 2, gy + N * gs + 18, font.mono(9, 600), pal.ink3, 'center');
    for (let row = 0; row < N; row++) text(c, String(N - row), gx - 12, gy + row * gs + gs / 2 + 3, font.mono(9, 600), pal.ink3, 'center');
    text(c, `level ${layer + 1} · front row at the bottom · ${count(v)} cubes${rd.cubes !== undefined ? ` / ${rd.cubes}` : ''}`, gx, gy + N * gs + 36, font.mono(10, 500), pal.ink2);
    // Mini layer strip: a column beside the editor (wide) or a row under it (narrow).
    const ms = Math.max(5, Math.min(9, 60 / N, wide ? 9 : (W - 48) / (N * (N + 1.6))));
    const stripY = gy + N * gs + 48;
    for (let z = 0; z < N; z++) {
      const mx = wide ? gx + N * gs + 26 : gx + z * (N * ms + 10);
      const my = wide ? gy + (N - 1 - z) * (N * ms + 8) : stripY;
      if (!wide) text(c, `L${z + 1}`, mx, my + N * ms + 11, font.mono(8, 600), z === layer ? pal.accent : pal.ink3);
      for (let row = 0; row < N; row++)
        for (let x = 0; x < N; x++) {
          const i = z * N * N + (N - 1 - row) * N + x;
          c.fillStyle = v[i] ? pal.accent : z === layer ? alpha(pal.ink, 0.18) : alpha(pal.ink, 0.07);
          c.fillRect(mx + x * ms, my + row * ms, ms - 1, ms - 1);
        }
      if (!reveal) bench.hit(mx, my, N * ms, N * ms, () => (layer = z));
    }
    // 3-D preview (and the target beside it after the reveal). The cube stack rises up to N·s above its
    // anchor, so the anchor sits N·s below the top of the area.
    const right0 = gx + N * gs + (wide ? 60 + N * ms : 16);
    const s = wide ? Math.min(26, (W - 40) / 26) : Math.min(24, (W - right0 - 12) / (N * 1.8 * (reveal ? 2 : 1)));
    const ix = wide ? right0 + N * s : right0 + N * s * 0.9;
    const iy = gy + N * s + 2;
    iso(c, v, N, ix, iy, s, reveal ? -1 : layer);
    if (reveal) {
      iso(c, rd.target, N, ix + N * s * 1.85, iy, s);
      text(c, 'target', ix + N * s * 1.85, iy + N * s + 18, font.mono(9, 600), pal.ink3, 'center');
    } else bench.button(c, ix - 40, iy + N * s + 10, 80, 30, 'Turn ⟳', () => (turn = (turn + 1) % 4), { px: 11 });
    // The given views.
    const vs = Math.min(24, (W - 60) / (3 * N + 8));
    const vy = wide ? gy + N * gs + 76 : Math.max(stripY + N * ms + 40, iy + N * s + 64);
    rd.given.forEach((g, i) => viewPanel(c, gx + i * (N * vs + 34), vy, vs, g, rd.feedback === 2 && !reveal ? null : v));
    if (!reveal) {
      const by = vy + N * vs + 24;
      bench.button(c, gx, by, 100, 40, 'Clear level', () => {
        for (let k = 0; k < N * N; k++) v[layer * N * N + k] = 0;
        edits++;
      });
      bench.button(c, gx + 108, by, 130, 40, 'Check', () => check(), { primary: true, key: 'Enter' });
    }
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
