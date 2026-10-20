// 25 · DIFFERENCE ENGINE — something in the constellation changed. Where, and what kind of change?
// A figure of points and connections is shown, masked, then shown again with exactly one structural change:
// a moved point, an added or removed connection, a rotated triangle, a stretched edge, a rewired connection
// (topology), or a broken mirror symmetry. Tap the changed part, then name the kind of change.
// Penalty per round: 0 (both right), ½ (right place, wrong kind), 1 (wrong place). Score: mean penalty, %.
// This measures noticing changes on this task only; nothing here tracks your eyes.
import { clamp, font, line, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { bar, glow, plate, rr, slot, sphere } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import { dist, lineDistance, lineParam, type V } from '../core/scoring';
import { targetScale } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 8;
export type ChangeKind = 'move' | 'add' | 'remove' | 'rotate' | 'stretch' | 'rewire' | 'symmetry';
export const KIND_NAMES: Record<ChangeKind, string> = {
  move: 'a point moved',
  add: 'a connection appeared',
  remove: 'a connection vanished',
  rotate: 'a triangle turned',
  stretch: 'an edge got longer / shorter',
  rewire: 'a connection moved to another point',
  symmetry: 'the mirror symmetry broke',
};
/** Answer groups shown as buttons (kept to three per round: the true one and two others). */
export const KIND_ORDER: ChangeKind[] = ['move', 'add', 'remove', 'rotate', 'stretch', 'rewire', 'symmetry'];

export interface Figure {
  pts: V[];
  edges: [number, number][];
}
export interface DiffRound {
  before: Figure;
  after: Figure;
  kind: ChangeKind;
  /** Changed points (indices) and changed edges (as point pairs, in either figure). */
  points: number[];
  edges: [number, number][];
  choices: ChangeKind[];
  explain: string;
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function figure(r: Rng, n: number, symmetric: boolean): Figure {
  const pts: V[] = [];
  if (symmetric) {
    // Mirror-symmetric about the vertical axis.
    const half = Math.ceil(n / 2);
    while (pts.length < half * 2) {
      const p = { x: r.range(6, 38), y: r.range(-36, 36) };
      if (pts.some((q) => dist(q, p) < 13)) continue;
      pts.push(p, { x: -p.x, y: p.y });
    }
  } else {
    let guard = 0;
    while (pts.length < n && guard++ < 2000) {
      const p = { x: r.range(-38, 38), y: r.range(-36, 36) };
      if (pts.some((q) => dist(q, p) < 13)) continue;
      pts.push(p);
    }
  }
  // Connect each point to its nearest one or two neighbours.
  const set = new Set<string>();
  const edges: [number, number][] = [];
  pts.forEach((p, i) => {
    const near = pts.map((q, j) => ({ j, d: dist(p, q) })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d);
    const k = r.next() < 0.5 ? 1 : 2;
    for (const o of near.slice(0, k)) {
      const kk = key(i, o.j);
      if (set.has(kk)) continue;
      if (symmetric) {
        const mi = i ^ 1;
        const mj = o.j ^ 1;
        set.add(key(mi, mj));
        if (!edges.some(([a, b]) => key(a, b) === key(mi, mj))) edges.push([mi, mj]);
      }
      set.add(kk);
      if (!edges.some(([a, b]) => key(a, b) === kk)) edges.push([i, o.j]);
    }
  });
  return { pts, edges };
}

const clone = (f: Figure): Figure => ({ pts: f.pts.map((p) => ({ ...p })), edges: f.edges.map((e) => [e[0], e[1]] as [number, number]) });
const inField = (p: V) => Math.abs(p.x) < 44 && Math.abs(p.y) < 42;

function change(r: Rng, f: Figure, kind: ChangeKind, level: Level): DiffRound | null {
  const a = clone(f);
  const mag = level === 'easy' ? 1 : level === 'medium' ? 0.65 : 0.42;
  const n = f.pts.length;
  const deg = (i: number) => f.edges.filter((e) => e[0] === i || e[1] === i).length;
  switch (kind) {
    case 'move': {
      const i = r.int(0, n - 1);
      const ang = r.range(0, Math.PI * 2);
      const d = 13 * mag + 2;
      const p = { x: f.pts[i].x + Math.cos(ang) * d, y: f.pts[i].y + Math.sin(ang) * d };
      if (!inField(p)) return null;
      a.pts[i] = p;
      return { before: f, after: a, kind, points: [i], edges: [], choices: [], explain: `One point moved ${d.toFixed(0)} u (circled); everything else stayed put.` };
    }
    case 'add': {
      const pairs: [number, number][] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!f.edges.some((e) => key(e[0], e[1]) === key(i, j)) && dist(f.pts[i], f.pts[j]) < 40) pairs.push([i, j]);
      if (!pairs.length) return null;
      const e = r.pick(pairs);
      a.edges.push(e);
      return { before: f, after: a, kind, points: [], edges: [e], choices: [], explain: `A new connection appeared (highlighted): the two points it joins each gained a neighbour.` };
    }
    case 'remove': {
      if (f.edges.length < 3) return null;
      const idx = r.int(0, f.edges.length - 1);
      const e = f.edges[idx];
      a.edges.splice(idx, 1);
      return { before: f, after: a, kind, points: [], edges: [e], choices: [], explain: `A connection is gone (dashed): the two points it joined each lost a neighbour.` };
    }
    case 'rotate': {
      // A connected triple turns about its centroid.
      const tri = f.edges.flatMap(([i, j]) => f.edges.filter(([p, q]) => (p === j || q === j) && key(p, q) !== key(i, j)).map(([p, q]) => [i, j, p === j ? q : p]));
      if (!tri.length) return null;
      const t = r.pick(tri);
      const cx = (f.pts[t[0]].x + f.pts[t[1]].x + f.pts[t[2]].x) / 3;
      const cy = (f.pts[t[0]].y + f.pts[t[1]].y + f.pts[t[2]].y) / 3;
      const ang = ((r.sign() * (level === 'easy' ? 40 : level === 'medium' ? 25 : 15)) * Math.PI) / 180;
      for (const i of t) {
        const dx = f.pts[i].x - cx;
        const dy = f.pts[i].y - cy;
        a.pts[i] = { x: cx + dx * Math.cos(ang) - dy * Math.sin(ang), y: cy + dx * Math.sin(ang) + dy * Math.cos(ang) };
        if (!inField(a.pts[i])) return null;
      }
      return { before: f, after: a, kind, points: t, edges: [], choices: [], explain: `Three linked points (circled) turned ${Math.abs(Math.round((ang * 180) / Math.PI))}° about their centre — their shape is unchanged, only its orientation.` };
    }
    case 'stretch': {
      const leaf = f.edges.find(([i, j]) => deg(i) === 1 || deg(j) === 1);
      if (!leaf) return null;
      const [i, j] = deg(leaf[1]) === 1 ? leaf : [leaf[1], leaf[0]];
      const k = r.next() < 0.5 ? 1 + 0.6 * mag : 1 - 0.4 * mag;
      const p = { x: f.pts[i].x + (f.pts[j].x - f.pts[i].x) * k, y: f.pts[i].y + (f.pts[j].y - f.pts[i].y) * k };
      if (!inField(p)) return null;
      a.pts[j] = p;
      return { before: f, after: a, kind, points: [j], edges: [[i, j]], choices: [], explain: `One edge (highlighted) became ${Math.round(Math.abs(k - 1) * 100)}% ${k > 1 ? 'longer' : 'shorter'}, along its own direction — the angle didn't change.` };
    }
    case 'rewire': {
      const idx = r.int(0, f.edges.length - 1);
      const [i, j] = f.edges[idx];
      const cands = f.pts.map((_, k) => k).filter((k) => k !== i && k !== j && !f.edges.some((e) => key(e[0], e[1]) === key(i, k)) && dist(f.pts[i], f.pts[k]) < 40);
      if (!cands.length) return null;
      const k = r.pick(cands);
      a.edges[idx] = [i, k];
      return { before: f, after: a, kind, points: [], edges: [[i, j], [i, k]], choices: [], explain: `A connection was rewired to a different point (old dashed, new highlighted): same number of connections, different structure.` };
    }
    case 'symmetry': {
      const i = r.int(0, n - 1);
      const d = 9 * mag + 2.5;
      const p = { x: f.pts[i].x, y: f.pts[i].y + r.sign() * d };
      if (!inField(p)) return null;
      a.pts[i] = p;
      return { before: f, after: a, kind, points: [i], edges: [], choices: [], explain: `One point (circled) slid ${d.toFixed(0)} u, so it no longer mirrors its partner: the left–right symmetry broke.` };
    }
  }
}

export function makeDiff(seed: number, level: Level): DiffRound[] {
  const r = rng(seed);
  const kinds: ChangeKind[] = level === 'easy' ? ['move', 'add', 'remove'] : level === 'medium' ? ['move', 'add', 'remove', 'rotate', 'stretch'] : ['move', 'add', 'remove', 'rotate', 'stretch', 'rewire', 'symmetry'];
  const n = level === 'easy' ? 7 : level === 'medium' ? 9 : 11;
  const out: DiffRound[] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 3000) {
    const kind = kinds[out.length % kinds.length === 0 && out.length >= kinds.length ? r.int(0, kinds.length - 1) : out.length % kinds.length];
    const f = figure(r, n, kind === 'symmetry');
    const rd = change(r, f, kind, level);
    if (!rd) continue;
    const others = kinds.filter((k) => k !== kind);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    rd.choices = [kind, ...others.slice(0, 2)].sort((x, y) => KIND_ORDER.indexOf(x) - KIND_ORDER.indexOf(y));
    out.push(rd);
  }
  // Seeded shuffle of round order.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Did a tap at p (field units, in the changed figure's frame) hit a changed element? */
export function hitsChange(rd: DiffRound, p: V, tol = 1) {
  const near = (q: V) => dist(q, p) <= 6 * tol;
  if (rd.points.some((i) => near(rd.after.pts[i]) || near(rd.before.pts[i]))) return true;
  return rd.edges.some(([i, j]) => {
    for (const fig of [rd.after, rd.before]) {
      const a = fig.pts[i];
      const b = fig.pts[j];
      const t = lineParam(p, a, b);
      if (t >= -0.05 && t <= 1.05 && Math.abs(lineDistance(p, a, b)) <= 4.5 * tol) return true;
    }
    return false;
  });
}

export const penalty = (whereOk: boolean, kindOk: boolean) => (!whereOk ? 1 : kindOk ? 0 : 0.5);

const STUDY: Record<Level, number> = { easy: 4, medium: 3, hard: 2.2 };
const MASK = 600;

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: DiffRound[] = [];
  let round = 0;
  let phase: 'ready' | 'study' | 'mask' | 'find' | 'kind' | 'reveal' | 'done' = 'ready';
  let phaseAt = 0;
  let timer = 0;
  let finTimer = 0;
  let tap: V | null = null;
  let whereOk = false;
  let pens: number[] = [];
  let chosen: ChangeKind | null = null;
  const mode = () => api.mode; // 'flash' | 'relaxed' | 'side'

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const side = mode() === 'side';
    const top = 74;
    const avail = H - top - 90;
    if (side) {
      const wide = W > avail * 1.6;
      const F = wide ? Math.min((W - 48) / 2, avail) : Math.min(W - 32, (avail - 16) / 2);
      return wide
        ? { k: F / 100, F, a: { x: W / 2 - F / 2 - 8, y: top + F / 2 }, b: { x: W / 2 + F / 2 + 8, y: top + F / 2 }, btnY: top + F + 12 }
        : { k: F / 100, F, a: { x: W / 2, y: top + F / 2 }, b: { x: W / 2, y: top + F * 1.5 + 16 }, btnY: top + 2 * F + 28 };
    }
    const F = Math.max(160, Math.min(W - 32, avail, 600));
    return { k: F / 100, F, a: { x: W / 2, y: top + F / 2 }, b: { x: W / 2, y: top + F / 2 }, btnY: top + F + 12 };
  };

  function prompt() {
    api.progress(`${round + 1} / ${ROUNDS}`);
    if (mode() === 'side') api.prompt('Left: before. Right: after. Tap what changed on the right.', 'One change per round · then name the kind');
    else api.prompt('Study the figure.', mode() === 'relaxed' ? 'Take your time · press when ready, then find what changed' : `${STUDY[api.level]} s · then it changes once`);
  }

  function reset(seed: number) {
    clearTimeout(timer);
    clearTimeout(finTimer);
    rounds = makeDiff(seed, api.level);
    round = 0;
    pens = [];
    tap = null;
    phase = 'ready';
    api.progress(`1 / ${ROUNDS}`);
    api.prompt('One change per round: find it, then name it.', mode() === 'side' ? 'Static: before and after side by side · press to start' : 'Press to see the first figure');
    stage.request();
  }

  function begin() {
    tap = null;
    chosen = null;
    whereOk = false;
    if (mode() === 'side') {
      phase = 'find';
    } else {
      phase = 'study';
      phaseAt = performance.now();
      clearTimeout(timer);
      if (mode() === 'flash') timer = window.setTimeout(toMask, STUDY[api.level] * 1000);
    }
    prompt();
    stage.request();
  }

  function toMask() {
    if (phase !== 'study') return;
    phase = 'mask';
    phaseAt = performance.now();
    api.prompt('');
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      phase = 'find';
      api.prompt('What changed? Tap it.', 'A point, a connection, or the place where one used to be');
      stage.request();
    }, MASK);
    stage.request();
  }

  function placeTap(p: V) {
    const rd = rounds[round];
    tap = p;
    whereOk = hitsChange(rd, p, targetScale());
    phase = 'kind';
    api.sfx.tick();
    api.prompt('What kind of change was it?', 'Choose one');
    stage.request();
  }

  function chooseKind(k: ChangeKind) {
    const rd = rounds[round];
    chosen = k;
    const pen = penalty(whereOk, k === rd.kind);
    {
      const { k: kk, a, b } = layout();
      const o = mode() === 'side' ? b : a;
      api.judge(pen * 100, tap ? { x: o.x + tap.x * kk, y: o.y + tap.y * kk - 36 } : undefined);
    }
    pens.push(pen);
    phase = 'reveal';
    api.sfx[pen === 0 ? 'near' : 'release']();
    api.prompt(pen === 0 ? 'Right place, right kind.' : pen === 0.5 ? 'Right place — but it was: ' + KIND_NAMES[rd.kind] + '.' : 'It was elsewhere: ' + KIND_NAMES[rd.kind] + '.', rd.explain + (round < ROUNDS - 1 ? ' · tap for the next' : ''));
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    begin();
  }

  function finish() {
    phase = 'done';
    const mean = (pens.reduce((a, b) => a + b, 0) / pens.length) * 100;
    const disp = mean.toFixed(1);
    const full = pens.filter((p) => p === 0).length;
    const place = pens.filter((p) => p < 1).length;
    const rows: [string, string][] = rounds.map((rd, i) => [`${i + 1} · ${KIND_NAMES[rd.kind]}`, pens[i] === 0 ? 'found + named' : pens[i] === 0.5 ? 'found, wrong kind' : 'missed']);
    rows.push(['Found the place', `${place} of ${ROUNDS}`]);
    rows.push(['Also named the kind', `${full} of ${ROUNDS}`]);
    rows.push(['Penalty', '0 right place + kind · ½ right place only · 1 wrong place']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '%',
          label: 'miss rate (weighted)',
          headline: full === ROUNDS ? 'Every change found and named.' : `Found ${place} of ${ROUNDS} changes; named ${full} correctly.`,
          rows,
          perfect: disp === '0.0',
          near: mean <= 7,
          share: [`DIFFERENCE ENGINE · ${api.level} · ${mode()} — spot the structural change`, `${place}/${ROUNDS} found`],
        }),
      api.motion() ? 600 : 0,
    );
  }

  const buttons = () => {
    const { btnY } = layout();
    const rd = rounds[round];
    const w = Math.min(220, (stage.w - 40) / 3 - 8);
    return rd.choices.map((k, i) => ({ k, x: stage.w / 2 + (i - 1) * (w + 8) - w / 2, y: btnY, w, h: 40 }));
  };

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    const p = stage.pt(e);
    if (phase === 'ready') return begin();
    if (phase === 'study' && mode() === 'relaxed') return toMask();
    if (phase === 'reveal') return next();
    if (phase === 'kind') {
      const b = buttons().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      if (b) chooseKind(b.k);
      return;
    }
    if (phase === 'find') {
      const { k, b } = layout();
      placeTap({ x: (p.x - b.x) / k, y: (p.y - b.y) / k });
    }
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const onVis = () => {
    if (document.hidden && (phase === 'study' || phase === 'mask')) {
      clearTimeout(timer);
      api.voidRun('Attempt voided — the tab was hidden while the figure was showing.');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.repeat) return;
      if (phase === 'kind' && /^[1-3]$/.test(e.key)) return; // digits belong to the shell (levels)
      if (phase === 'kind' && ['a', 'b', 'c'].includes(e.key.toLowerCase())) {
        const k = rounds[round].choices['abc'.indexOf(e.key.toLowerCase())];
        if (k) chooseKind(k);
      } else if ((e.key === 'Enter' || e.code === 'Space') && (phase === 'ready' || phase === 'reveal' || (phase === 'study' && mode() === 'relaxed'))) {
        e.preventDefault();
        if (phase === 'ready') begin();
        else if (phase === 'reveal') next();
        else toMask();
      }
    }),
  ];

  function drawFig(c: CanvasRenderingContext2D, f: Figure, o: V, k: number, opts: { ghost?: boolean; mark?: DiffRound } = {}) {
    const X = (u: number) => o.x + u * k;
    const Y = (u: number) => o.y + u * k;
    for (const [i, j] of f.edges) line(c, X(f.pts[i].x), Y(f.pts[i].y), X(f.pts[j].x), Y(f.pts[j].y), opts.ghost ? pal.line : pal.ink2, opts.ghost ? 1 : 1.5, opts.ghost ? [3, 3] : undefined);
    f.pts.forEach((p) => {
      // Nodes are small shaded beads (the same style in every copy, so only structure differs).
      if (opts.ghost) {
        c.beginPath();
        c.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2);
        c.fillStyle = pal.ink3;
        c.fill();
      } else sphere(c, X(p.x), Y(p.y), 4.5, pal.ink);
    });
    if (opts.mark) {
      const rd = opts.mark;
      for (const i of rd.points) {
        c.beginPath();
        glow(c, X(rd.after.pts[i].x), Y(rd.after.pts[i].y), 30, pal.accent, 0.7);
        c.beginPath();
        c.arc(X(rd.after.pts[i].x), Y(rd.after.pts[i].y), 11, 0, Math.PI * 2);
        c.strokeStyle = pal.accent;
        c.lineWidth = 2;
        c.stroke();
        line(c, X(rd.before.pts[i].x), Y(rd.before.pts[i].y), X(rd.after.pts[i].x), Y(rd.after.pts[i].y), pal.accent, 1, [2, 2]);
      }
      for (const [i, j] of rd.edges) {
        const inAfter = rd.after.edges.some((e) => key(e[0], e[1]) === key(i, j));
        const fig = inAfter ? rd.after : rd.before;
        line(c, X(fig.pts[i].x), Y(fig.pts[i].y), X(fig.pts[j].x), Y(fig.pts[j].y), pal.accent, inAfter ? 3 : 1.5, inAfter ? undefined : [5, 4]);
      }
    }
  }

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const { k, F, a, b } = layout();
    let more = false;
    const frame = (o: V) => plate(c, o.x - F / 2, o.y - F / 2, F, F, 14);
    if (mode() === 'side') {
      frame(a);
      frame(b);
      drawFig(c, rd.before, a, k);
      text(c, 'BEFORE', a.x - F / 2 + 6, a.y - F / 2 + 14, font.mono(10, 500), pal.ink3, 'left');
      drawFig(c, rd.after, b, k, { mark: phase === 'reveal' || phase === 'done' ? rd : undefined });
      text(c, 'AFTER', b.x - F / 2 + 6, b.y - F / 2 + 14, font.mono(10, 500), pal.ink3, 'left');
    } else {
      frame(a);
      if (phase === 'study') {
        drawFig(c, rd.before, a, k);
        if (mode() === 'flash') {
          const left = 1 - (now - phaseAt) / (STUDY[api.level] * 1000);
          slot(c, a.x - F / 2, a.y + F / 2 + 12, a.x + F / 2, a.y + F / 2 + 12, 6);
          bar(c, a.x - F / 2, a.y + F / 2 + 9.5, F * clamp(left, 0, 1), 5, pal.accent, 2.5);
          more = true;
        } else text(c, 'press when ready ▸', a.x, a.y + F / 2 + 18, font.mono(11, 500), pal.ink2, 'center');
      } else if (phase === 'mask') {
        // A neutral mask: hides the switch, so the change can't be seen as motion.
        for (let i = 0; i < 40; i++) {
          const r2 = rng(i * 97 + round);
          rr(c, a.x - F / 2 + r2.next() * (F - 6), a.y - F / 2 + r2.next() * (F - 6), 6, 6, 2);
          c.fillStyle = pal.line;
          c.fill();
        }
      } else if (phase !== 'ready') {
        if (phase === 'reveal' || phase === 'done') drawFig(c, rd.before, a, k, { ghost: true });
        drawFig(c, rd.after, a, k, { mark: phase === 'reveal' || phase === 'done' ? rd : undefined });
      }
    }
    if (tap && phase !== 'find') {
      const o = mode() === 'side' ? b : a;
      const tc = phase === 'kind' ? pal.ink : whereOk ? pal.accent : pal.signal;
      glow(c, o.x + tap.x * k, o.y + tap.y * k, 26, tc, 0.7);
      line(c, o.x + tap.x * k - 7, o.y + tap.y * k, o.x + tap.x * k + 7, o.y + tap.y * k, tc, 2);
      line(c, o.x + tap.x * k, o.y + tap.y * k - 7, o.x + tap.x * k, o.y + tap.y * k + 7, tc, 2);
      if (phase !== 'kind') tag(c, whereOk ? 'your tap ✓' : 'your tap', o.x + tap.x * k, o.y + tap.y * k - 16, tc, 10);
    }
    if (phase === 'kind') {
      buttons().forEach((bt, i) => {
        plate(c, bt.x, bt.y, bt.w, bt.h, 4, pal.paper2);
        rr(c, bt.x + 0.5, bt.y + 0.5, bt.w - 1, bt.h - 1, 4);
        c.strokeStyle = pal.ink2;
        c.lineWidth = 1;
        c.stroke();
        text(c, `${'ABC'[i]} · ${KIND_NAMES[bt.k]}`, bt.x + bt.w / 2, bt.y + bt.h / 2, font.sans(12, 500), pal.ink, 'center', 'middle');
      });
    }
    if (phase === 'ready') text(c, 'press to start', stage.w / 2, stage.h / 2, font.mono(12, 500), pal.ink2, 'center', 'middle');
    if (chosen && phase === 'reveal') void chosen;
    const sy = stage.h - 10;
    for (let i = 0; i < ROUNDS; i++) text(c, i < pens.length ? (pens[i] === 0 ? '✓' : pens[i] === 0.5 ? '½' : '✕') : i === round ? '•' : '·', stage.w / 2 + (i - 3.5) * 34, sy, font.mono(12, 500), i <= round ? pal.ink : pal.ink3, 'center');
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(timer);
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
