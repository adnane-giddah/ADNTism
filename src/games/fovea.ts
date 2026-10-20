// 41 · FOVEA — search a scene through a small sharp lens.
// Outside the lens the scene is a low-detail field: every ring's position, size and tint survive, but the
// details that decide the answer — which way its gap opens, whether it has a centre dot, what a clue card
// says — are visible only under the lens. The scene is laid out in field units (1.6 × 1, uniform scale), so
// directions such as "towards the centre" mean the same on every screen. Every board is generated with its
// answer and checked: exactly the intended items satisfy the request, and the low-detail field never gives
// the answer away on its own (at least three items share the target's size and tint). Scoring rewards the
// right answer first, then a short search: the lens travel is compared with a full raster sweep of the field.
import { clamp, font, pal, text, TAU } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, BLUE, Bench, roundStrip, shuffle, type Pt } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

export const FW = 1.6;
export const FH = 1;
export const DIRS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
const TINTS = ['ink', 'amber', 'blue'] as const;

export interface Item {
  x: number;
  y: number;
  /** Gap direction 0–7 (45° steps clockwise from →); −1 for a closed ring. */
  gap: number;
  dot: boolean;
  /** A dot near the rim instead of the centre (a look-alike, not a centre dot). */
  od?: boolean;
  tint: 0 | 1 | 2;
  big: boolean;
}
export interface Want {
  gap?: number;
  dot?: boolean;
  tint?: 0 | 1 | 2;
  big?: boolean;
}
export interface Clue {
  key: keyof Want;
  label: string;
  x: number;
  y: number;
}
export interface FoveaRound {
  kind: 'target' | 'anomaly' | 'clues' | 'multi' | 'compare';
  items: Item[];
  /** Compare: the right panel (same layout, offset by PANEL_DX). */
  items2?: Item[];
  /** Indices of the correct items (compare: the differing pair, or none when identical). */
  answer: number[];
  want?: Want;
  cue?: string;
  clues?: Clue[];
  rule?: string;
  /** Lens radius in field units. */
  lens: number;
}

export const PANEL_DX = 0.84;
const R_BIG = 0.034;
const R_SMALL = 0.024;

export function fits(it: Item, w: Want) {
  return (w.gap === undefined || it.gap === w.gap) && (w.dot === undefined || (it.dot && !it.od) === w.dot) && (w.tint === undefined || it.tint === w.tint) && (w.big === undefined || it.big === w.big);
}

const gapDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 8;
  return Math.min(d, 8 - d);
};

/** n distinct jittered lattice positions inside [x0, x1] × [y0, y1] (spacing ≥ ~0.7 cell). */
function lattice(r: Rng, n: number, x0: number, x1: number, y0: number, y1: number, jitter = 0.28) {
  const area = (x1 - x0) * (y1 - y0);
  const cell = Math.sqrt(area / (n * 1.45));
  const cols = Math.max(1, Math.floor((x1 - x0) / cell));
  const rows = Math.max(1, Math.floor((y1 - y0) / cell));
  const cw = (x1 - x0) / cols;
  const ch = (y1 - y0) / rows;
  const cells = shuffle(
    Array.from({ length: cols * rows }, (_, i) => i),
    r.next,
  ).slice(0, n);
  return cells.map((i) => ({ x: x0 + ((i % cols) + 0.5 + r.range(-jitter, jitter)) * cw, y: y0 + (Math.floor(i / cols) + 0.5 + r.range(-jitter, jitter)) * ch }));
}

/** Coarse region (3 × 3) of a point: used in signatures so the target's place varies. */
const cellOf = (p: { x: number; y: number }, w = FW) => `${Math.min(2, Math.floor((p.x / w) * 3))}${Math.min(2, Math.floor((p.y / FH) * 3))}`;
const LENS = [0.19, 0.155, 0.13, 0.11];

function randItem(r: Rng, p: { x: number; y: number }, gaps: number[], pBig = 0.35): Item {
  return { x: p.x, y: p.y, gap: r.pick(gaps), dot: false, tint: r.int(0, 2) as 0 | 1 | 2, big: r.next() < pBig };
}

const lowTwins = (items: Item[], t: Item) => items.filter((x) => x.tint === t.tint && x.big === t.big).length;

function genTarget(r: Rng, band: Band): FoveaRound | null {
  const n = [18, 30, 42, 56][band];
  const g = r.int(0, 7);
  const gaps = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => k !== g && (band > 0 || gapDist(k, g) >= 2));
  const pos = lattice(r, n, 0.06, FW - 0.06, 0.06, FH - 0.06);
  const items = pos.map((p) => randItem(r, p, gaps));
  const t = r.int(0, n - 1);
  items[t].gap = g;
  const want: Want = { gap: g };
  let cue: string | undefined;
  if (band === 0) {
    items[t].big = true;
    want.big = true;
    cue = 'It is one of the large rings.';
  } else if (band === 1) {
    items[t].tint = 1;
    want.tint = 1;
    cue = 'It is amber.';
  }
  if (band >= 2) {
    // Look-alikes: the target's gap, but with a centre dot (the request says "no dot").
    want.dot = false;
    for (let k = 0; k < (band === 3 ? 6 : 3); k++) {
      const j = r.int(0, n - 1);
      if (j !== t) Object.assign(items[j], { gap: g, dot: true });
    }
  }
  if (items.filter((x) => fits(x, want)).length !== 1) return null;
  if (lowTwins(items, items[t]) < (band === 0 ? 3 : 4)) return null;
  return { kind: 'target', items, answer: [t], want, cue, lens: LENS[band] };
}

function genAnomaly(r: Rng, band: Band): FoveaRound | null {
  const rule = r.pick(['same', 'radial', 'alt'] as const);
  const dev = band === 0 ? 4 : band === 1 ? 2 : r.pick(band === 2 ? [2, 1] : [1, 1, 2]);
  let items: Item[];
  if (rule === 'alt') {
    const cols = [5, 6, 7, 8][band];
    const rows = [3, 3, 4, 4][band];
    items = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) items.push({ x: 0.1 + ((i + 0.5) / cols) * (FW - 0.2), y: 0.08 + ((j + 0.5) / rows) * (FH - 0.16), gap: -1, dot: (i + j) % 2 === 0, tint: band >= 2 ? (r.int(0, 2) as 0 | 1 | 2) : 0, big: true });
  } else {
    const n = [16, 24, 32, 40][band];
    const pos = lattice(r, n, 0.07, FW - 0.07, 0.07, FH - 0.07);
    const g0 = r.int(0, 7);
    items = [];
    for (const p of pos) {
      let gap = g0;
      if (rule === 'radial') {
        const dx = FW / 2 - p.x;
        const dy = FH / 2 - p.y;
        if (Math.hypot(dx, dy) < 0.16) continue;
        const a = Math.atan2(dy, dx) / (Math.PI / 4);
        // Keep away from the boundary between two directions, so the rule is never ambiguous.
        if (Math.abs(a - Math.round(a)) > 0.36) continue;
        gap = ((Math.round(a) % 8) + 8) % 8;
      }
      items.push({ x: p.x, y: p.y, gap, dot: false, tint: band >= 1 ? (r.int(0, 2) as 0 | 1 | 2) : 0, big: r.next() < 0.5 });
    }
    if (items.length < n * 0.7) return null;
  }
  const a = r.int(0, items.length - 1);
  if (rule === 'alt') items[a].dot = !items[a].dot;
  else items[a].gap = (items[a].gap + r.sign() * dev + 8) % 8;
  const ruleText = { same: 'every gap opens the same way', radial: 'every gap opens towards the centre', alt: 'centre dots alternate like a chessboard' }[rule];
  return { kind: 'anomaly', items, answer: [a], rule: ruleText, lens: LENS[band] };
}

function genClues(r: Rng, band: Band): FoveaRound | null {
  const n = [20, 28, 36, 44][band];
  const pos = lattice(r, n + 3, 0.07, FW - 0.07, 0.07, FH - 0.07);
  const cardPos = pos.splice(0, 3);
  const items = pos.map((p) => {
    const it = randItem(r, p, [0, 1, 2, 3, 4, 5, 6, 7], 0.5);
    it.dot = r.next() < 0.5;
    return it;
  });
  const t = r.int(0, n - 1);
  const coarse = r.pick(['tint', 'big'] as const);
  const keys: (keyof Want)[] = band <= 1 ? [coarse, r.pick(['gap', 'dot'] as const)] : [coarse, 'gap', 'dot'];
  const T = items[t];
  const want: Want = {};
  for (const k of keys) (want as Record<string, unknown>)[k] = T[k as keyof Item];
  // Break accidental full matches by turning their gap (or toggling the dot).
  items.forEach((it, i) => {
    if (i === t || !fits(it, want)) return;
    if (keys.includes('gap')) it.gap = (it.gap + 1 + r.int(0, 6)) % 8;
    else it.dot = !it.dot;
  });
  if (items.filter((x) => fits(x, want)).length !== 1) return null;
  // Every clue is needed: each one alone, and each pair, leaves several candidates.
  for (const k of keys) if (items.filter((x) => fits(x, { [k]: want[k] })).length < 3) return null;
  if (keys.length === 3)
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        if (items.filter((x) => fits(x, { [keys[i]]: want[keys[i]], [keys[j]]: want[keys[j]] })).length < 2) return null;
  const label = (k: keyof Want) => (k === 'tint' ? TINTS[want.tint!].toUpperCase() : k === 'big' ? (want.big ? 'LARGE' : 'SMALL') : k === 'gap' ? `GAP ${DIRS[want.gap!]}` : want.dot ? 'CENTRE DOT' : 'NO DOT');
  const clues = shuffle(keys.map((k, i) => ({ key: k, label: label(k), x: cardPos[i].x, y: cardPos[i].y })), r.next);
  return { kind: 'clues', items, answer: [t], want, clues, lens: LENS[band] };
}

function genMulti(r: Rng, band: Band): FoveaRound | null {
  const K = [3, 3, 4, 5][band];
  const n = [20, 30, 38, 48][band];
  const pos = lattice(r, n, 0.06, FW - 0.06, 0.06, FH - 0.06);
  const byDot = r.next() < 0.5;
  const g = r.int(0, 7);
  const items = pos.map((p) => randItem(r, p, [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => byDot || gapDist(k, g) >= (band >= 2 ? 1 : 2))));
  const idx = shuffle(
    items.map((_, i) => i),
    r.next,
  );
  const tg = idx.slice(0, K);
  const want: Want = byDot ? { dot: true } : { gap: g };
  for (const i of tg) byDot ? (items[i].dot = true) : (items[i].gap = g);
  // Look-alikes from band 2: a dot near the rim, or a gap one step away.
  if (band >= 2)
    for (const i of idx.slice(K, K + 3)) {
      if (byDot) Object.assign(items[i], { dot: true, od: true });
      else items[i].gap = (g + r.sign() + 8) % 8;
    }
  const answer = items.map((_, i) => i).filter((i) => fits(items[i], want));
  if (answer.length !== K) return null;
  return { kind: 'multi', items, answer, want, lens: LENS[band] };
}

function genCompare(r: Rng, band: Band): FoveaRound | null {
  const m = [10, 14, 18, 24][band];
  const pos = lattice(r, m, 0.06, PANEL_DX - 0.1, 0.07, FH - 0.07, 0.2);
  const items = pos.map((p) => {
    const it = randItem(r, p, [0, 1, 2, 3, 4, 5, 6, 7]);
    it.dot = r.next() < 0.3;
    return it;
  });
  const items2 = items.map((x) => ({ ...x }));
  const differ = r.next() < 0.5;
  const answer: number[] = [];
  if (differ) {
    const d = r.int(0, m - 1);
    const tgt = r.next() < 0.5 ? items : items2;
    if (band >= 2 && r.next() < 0.4) tgt[d].dot = !tgt[d].dot;
    else tgt[d].gap = (tgt[d].gap + r.sign() * (band === 0 ? 4 : band === 1 ? 2 : 1) + 8) % 8;
    answer.push(d);
  }
  return { kind: 'compare', items, items2, answer, lens: LENS[band] };
}

const sigItems = (rd: FoveaRound) => rd.answer.map((i) => cellOf(rd.items[i], rd.kind === 'compare' ? PANEL_DX : FW)).sort().join('');

export const FAMILIES: Family<FoveaRound>[] = [
  { id: 'target', name: 'Target search', teach: 'Move the lens (pointer or arrows) to see detail; tap the ring whose gap matches.', bands: [0, 3], intro: true, gen: genTarget, sig: (rd) => `${rd.items.length}|${rd.want!.gap}|${rd.cue ?? ''}|${sigItems(rd)}` },
  { id: 'anomaly', name: 'Anomaly', teach: 'The scene follows one regularity. Inspect a few rings to learn it, then find the one that breaks it.', bands: [0, 3], gen: genAnomaly, sig: (rd) => `${rd.rule}|${rd.items.length}|${sigItems(rd)}` },
  { id: 'clues', name: 'Clue search', teach: 'The small cards are clues. Read them with the lens; only one ring satisfies all of them.', bands: [1, 3], gen: genClues, sig: (rd) => `${rd.clues!.map((c) => c.label).sort().join('+')}|${sigItems(rd)}` },
  { id: 'multi', name: 'Multi-target', teach: 'Several rings match. Tap every one of them (tap again to unmark), then Done.', bands: [0, 3], gen: genMulti, sig: (rd) => `${JSON.stringify(rd.want)}|${rd.answer.length}|${sigItems(rd)}` },
  { id: 'compare', name: 'Compare', teach: 'Two panels with the same layout. Tap the ring that differs — or say they are identical.', bands: [0, 3], gen: genCompare, sig: (rd) => `${rd.items.length}|${rd.answer.length ? rd.answer[0] : 'same'}` },
];

export const ROUNDS = 5;

/** Length of a raster sweep that covers the whole field with a lens of radius L (field units). */
export const sweepLength = (L: number) => (FW * FH) / (2 * L) + FH;

export function describe(w: Want) {
  const parts: string[] = [];
  if (w.big !== undefined) parts.push(w.big ? 'large' : 'small');
  if (w.tint !== undefined) parts.push(TINTS[w.tint]);
  parts.push('ring');
  if (w.gap !== undefined) parts.push(`with its gap ${DIRS[w.gap]}`);
  if (w.dot !== undefined) parts.push(w.dot ? 'with a centre dot' : w.gap !== undefined ? 'and no dot' : 'with no dot');
  return parts.join(' ');
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<FoveaRound>(api, 'fovea', FAMILIES, ROUNDS);
  let rd: FoveaRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let lens = { x: FW / 2, y: FH / 2 };
  let travel = 0;
  let marked = new Set<number>();
  let picked = -2; // −2 none, −1 "identical"
  let geo = { ox: 0, oy: 0, s: 1 };
  let hover = false;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    lens = { x: FW / 2, y: FH / 2 };
    travel = 0;
    marked = new Set();
    picked = -2;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const ask =
      rd.kind === 'target'
        ? `Find the ${describe(rd.want!)}.`
        : rd.kind === 'anomaly'
          ? 'One ring breaks the scene’s regularity. Find it.'
          : rd.kind === 'clues'
            ? `Read the ${rd.clues!.length} clue cards; find the one ring that fits them all.`
            : rd.kind === 'multi'
              ? `Mark all ${rd.answer.length} rings ${rd.want!.dot ? 'with a centre dot' : `with the gap ${DIRS[rd.want!.gap!]}`}, then Done.`
              : 'Do the two panels differ? Tap the differing ring, or Identical.';
    api.prompt(ask, sess.teach || (rd.cue ?? 'Detail only shows under the lens · a short search scores better'));
    stage.request();
  }

  const toStage = (x: number, y: number) => ({ x: geo.ox + x * geo.s, y: geo.oy + y * geo.s });
  const toField = (p: Pt) => ({ x: (p.x - geo.ox) / geo.s, y: (p.y - geo.oy) / geo.s });

  function moveLens(f: { x: number; y: number }) {
    const nx = clamp(f.x, 0, FW);
    const ny = clamp(f.y, 0, FH);
    if (phase === 'play') travel += Math.hypot(nx - lens.x, ny - lens.y);
    lens = { x: nx, y: ny };
  }

  /** All selectable rings with their field positions (compare: both panels, same index). */
  function rings() {
    const out: { i: number; x: number; y: number; it: Item }[] = rd.items.map((it, i) => ({ i, x: it.x, y: it.y, it }));
    if (rd.items2) rd.items2.forEach((it, i) => out.push({ i, x: it.x + PANEL_DX, y: it.y, it }));
    return out;
  }

  function ringAt(f: { x: number; y: number }, maxD: number) {
    let best: { i: number; d: number } | null = null;
    for (const g of rings()) {
      const d = Math.hypot(g.x - f.x, g.y - f.y);
      if (d <= maxD && (!best || d < best.d)) best = { i: g.i, d };
    }
    return best?.i ?? -1;
  }

  function choose(i: number) {
    if (phase !== 'play' || i < 0) return;
    if (rd.kind === 'multi') {
      marked.has(i) ? marked.delete(i) : marked.add(i);
      api.sfx.soft();
      return;
    }
    picked = i;
    judge();
  }

  function judge() {
    if (phase !== 'play') return;
    const eff = clamp(travel / sweepLength(rd.lens), 0, 1);
    const effNote = `${Math.round(eff * 100)}% of a full sweep`;
    let pen = 0;
    let main = '';
    let sub = '';
    const ans = rd.answer;
    if (rd.kind === 'multi') {
      const hits = [...marked].filter((i) => ans.includes(i)).length;
      const fa = marked.size - hits;
      const miss = ans.length - hits;
      pen = Math.min(1, (miss + fa) / ans.length + (miss + fa ? 0 : 0.35 * eff));
      main = miss + fa ? `Found ${hits} of ${ans.length}${fa ? ` · ${fa} false mark${fa > 1 ? 's' : ''}` : ''}.` : `All ${ans.length} found, nothing else marked.`;
      const lure = [...marked].find((i) => !ans.includes(i));
      sub = lure !== undefined ? `A false mark: ${rd.items[lure].od ? 'its dot sits near the rim, not the centre' : `its gap is ${DIRS[rd.items[lure].gap]}`}. ` : '';
      sub += `Search: ${effNote}.`;
    } else if (rd.kind === 'compare') {
      const right = ans.length ? picked === ans[0] : picked === -1;
      pen = right ? 0.35 * eff : 1;
      if (!ans.length) main = right ? 'Right — the panels were identical.' : 'The panels were identical; nothing differed.';
      else {
        const a = rd.items[ans[0]];
        const b = rd.items2![ans[0]];
        const what = a.dot !== b.dot ? 'one has a centre dot' : `gap ${DIRS[a.gap]} vs ${DIRS[b.gap]}`;
        main = right ? `Right — ${what}.` : `They differed: ${what} (highlighted).`;
      }
      sub = `Search: ${effNote}. A difference can only be ruled out by inspecting every pair.`;
    } else {
      const right = picked === ans[0];
      pen = right ? 0.35 * eff : 1;
      const it = picked >= 0 ? rd.items[picked] : null;
      if (right) main = `Found it — ${effNote}.`;
      else if (rd.kind === 'anomaly') main = `That ring follows the rule (${rd.rule}). The odd one is highlighted.`;
      else if (rd.kind === 'clues' && it) {
        const bad = rd.clues!.find((c) => !fits(it, { [c.key]: rd.want![c.key] }));
        main = bad ? `That ring fails the clue “${bad.label}”.` : 'Not that one.';
      } else if (it) main = `That ring is a ${describe({ gap: it.gap, dot: it.dot && !it.od, tint: it.tint, big: it.big })}.`;
      sub = right ? (rd.kind === 'anomaly' ? `The rule: ${rd.rule}.` : rd.kind === 'clues' ? 'Each clue alone left several candidates; together they leave one.' : 'Using the coarse field to rule out regions is what keeps a search short.') : `Search: ${effNote}.`;
    }
    phase = 'reveal';
    sess.done(pen, rd.kind === 'multi' ? main : `${pen < 1 ? 'right' : 'wrong'} · ${effNote}`, toStage(FW / 2, 0.1));
    api.sfx[pen < 1 ? 'press' : 'fail']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next scene'));
    api.ownKeys(false);
    if (sess.last) finish();
  }

  function finish() {
    phase = 'done';
    const r = sess.result({ label: 'mean penalty per scene (wrong answers, then search length)', share: 'FOVEA' });
    if (r) bench.finish(r);
  }

  function next() {
    if (phase !== 'reveal') return;
    begin();
  }

  bench.onMove = (p) => {
    if (phase === 'play' && Number.isFinite(p.x)) {
      hover = true;
      moveLens(toField(p));
      stage.request();
    }
  };
  bench.onTap = (p, e) => {
    if (phase === 'reveal') return next();
    if (phase !== 'play') return;
    const f = toField(p);
    if (Math.hypot(f.x - lens.x, f.y - lens.y) <= rd.lens || e.pointerType === 'mouse') {
      if (e.pointerType !== 'mouse') moveLens(f);
      choose(ringAt(f, R_BIG * 1.9));
    } else moveLens(f);
  };
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return next();
    }
    if (phase !== 'play') return;
    const st = e.shiftKey ? 0.012 : 0.035;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    if (mv[e.key]) {
      moveLens({ x: lens.x + mv[e.key][0], y: lens.y + mv[e.key][1] });
      e.preventDefault();
    } else if (e.key === 'Enter' || e.code === 'Space') {
      choose(ringAt(lens, rd.lens * 0.6));
      e.preventDefault();
    } else if ((e.key === 'd' || e.key === 'D') && rd.kind === 'multi') judge();
    else if ((e.key === 'i' || e.key === 'I') && rd.kind === 'compare') {
      picked = -1;
      judge();
    }
  };

  function drawRing(c: CanvasRenderingContext2D, it: Item, x: number, y: number, detail: boolean, emph?: string) {
    const rad = (it.big ? R_BIG : R_SMALL) * geo.s;
    const col = it.tint === 1 ? AMBER : it.tint === 2 ? BLUE : pal.ink;
    if (!detail) {
      // The low-detail field: a soft blob that keeps size and tint, nothing else.
      const g = c.createRadialGradient(x, y, 0, x, y, rad * 1.5);
      g.addColorStop(0, alpha(col, 0.5));
      g.addColorStop(0.65, alpha(col, 0.3));
      g.addColorStop(1, alpha(col, 0));
      c.fillStyle = g;
      c.fillRect(x - rad * 1.5, y - rad * 1.5, rad * 3, rad * 3);
      return;
    }
    c.save();
    c.lineWidth = Math.max(1.6, rad * 0.24);
    c.strokeStyle = col;
    c.beginPath();
    if (it.gap < 0) c.arc(x, y, rad, 0, TAU);
    else {
      const a = (it.gap * Math.PI) / 4;
      c.arc(x, y, rad, a + 0.42, a - 0.42 + TAU);
    }
    c.stroke();
    if (it.dot) {
      const dx = it.od ? Math.cos(0.8 + it.gap) * rad * 0.62 : 0;
      const dy = it.od ? Math.sin(0.8 + it.gap) * rad * 0.62 : 0;
      c.beginPath();
      c.arc(x + dx, y + dy, Math.max(1.4, rad * 0.2), 0, TAU);
      c.fillStyle = col;
      c.fill();
    }
    if (emph) {
      c.beginPath();
      c.arc(x, y, rad + 6, 0, TAU);
      c.strokeStyle = emph;
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
  }

  function drawClue(c: CanvasRenderingContext2D, cl: Clue, detail: boolean) {
    const p = toStage(cl.x, cl.y);
    const w = 0.15 * geo.s;
    const h = 0.055 * geo.s;
    rr(c, p.x - w / 2, p.y - h / 2, w, h, 4);
    c.fillStyle = alpha(pal.ink, detail ? 0.1 : 0.06);
    c.fill();
    c.strokeStyle = alpha(pal.ink, detail ? 0.5 : 0.22);
    c.lineWidth = 1;
    c.stroke();
    if (detail) text(c, cl.label, p.x, p.y + 0.5, font.mono(Math.max(8, h * 0.42), 600), pal.ink, 'center', 'middle');
    else for (let k = 0; k < 2; k++) c.fillRect(p.x - w * 0.32, p.y - h * 0.15 + k * h * 0.28, w * (k ? 0.4 : 0.64), 1.5);
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    const top = 108;
    const bottom = H - 66;
    const s = Math.min((W - 32) / FW, (bottom - top) / FH);
    geo = { ox: (W - FW * s) / 2, oy: top + (bottom - top - FH * s) / 2, s };
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    plate(c, geo.ox - 6, geo.oy - 6, FW * s + 12, FH * s + 12, 8);
    if (rd.kind === 'compare') {
      const mx = geo.ox + (PANEL_DX - 0.03) * s;
      c.fillStyle = pal.line;
      c.fillRect(mx, geo.oy + 8, 1, FH * s - 16);
    }
    const reveal = phase !== 'play';
    const L = toStage(lens.x, lens.y);
    const LR = rd.lens * s;
    const all = rings();
    const emphOf = (i: number) => {
      if (!reveal) return rd.kind === 'multi' && marked.has(i) ? AMBER : undefined;
      if (rd.answer.includes(i)) return pal.accent;
      if (i === picked || marked.has(i)) return pal.signal;
      return undefined;
    };
    // Low-detail field everywhere (or full detail after the reveal).
    for (const g of all) {
      const p = toStage(g.x, g.y);
      drawRing(c, g.it, p.x, p.y, reveal, reveal ? emphOf(g.i) : undefined);
    }
    rd.clues?.forEach((cl) => drawClue(c, cl, reveal));
    if (!reveal) {
      // Marks on the field (multi-target) stay visible outside the lens.
      for (const g of all)
        if (marked.has(g.i)) {
          const p = toStage(g.x, g.y);
          c.beginPath();
          c.arc(p.x, p.y, R_BIG * s + 6, 0, TAU);
          c.strokeStyle = AMBER;
          c.lineWidth = 1.5;
          c.stroke();
        }
      // The lens: a sharp disc of real detail.
      c.save();
      c.beginPath();
      c.arc(L.x, L.y, LR, 0, TAU);
      c.clip();
      c.fillStyle = pal.paper;
      c.fillRect(L.x - LR, L.y - LR, LR * 2, LR * 2);
      for (const g of all) {
        const p = toStage(g.x, g.y);
        if (Math.hypot(p.x - L.x, p.y - L.y) < LR + R_BIG * s * 1.2) drawRing(c, g.it, p.x, p.y, true, emphOf(g.i));
      }
      rd.clues?.forEach((cl) => drawClue(c, cl, true));
      c.restore();
      c.save();
      c.beginPath();
      c.arc(L.x, L.y, LR, 0, TAU);
      c.strokeStyle = alpha(pal.accent, 0.75);
      c.lineWidth = 1.5;
      c.shadowColor = alpha(pal.accent, 0.5);
      c.shadowBlur = 10;
      c.stroke();
      c.restore();
      if (!hover && sess.round === 0) text(c, 'move me', L.x, L.y + LR + 14, font.mono(10, 500), pal.ink3, 'center');
    }
    // Controls.
    const by = H - 54;
    if (phase === 'play') {
      if (rd.kind === 'multi') bench.row(c, W / 2, by, 320, [{ label: `Done · ${marked.size} marked`, run: judge, o: { primary: true, key: 'D' } }], 40);
      else if (rd.kind === 'compare')
        bench.row(c, W / 2, by, 320, [{ label: 'Identical', run: () => ((picked = -1), judge()), o: { key: 'I' } }], 40);
      else text(c, 'Tap a ring inside the lens · arrows + Enter also work', W / 2, by + 20, font.mono(10, 500), pal.ink3, 'center', 'middle');
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
