// 51 · SWARM — steer a flock you cannot touch.
// Each particle follows three local rules within a radius of 0.08 u: steer towards its neighbours' centre
// (cohesion), match their heading (alignment), keep 0.03 u apart (separation). Your only influence is a
// field: while you press, particles within 0.45 u accelerate towards (or, in repel mode, away from) the
// point, with a strength falling linearly from 1.6 u/s² at the point to zero at the edge of the range.
// Amber particles (selective routing) flee the attractor instead. Walls push back within 0.04 u and stop
// motion through them; hazards remove particles that touch them.
// The simulation runs on a fixed 1/60 s step with a seeded start, so a run is reproducible from its inputs
// and does not depend on the frame rate. Layouts are checked before play: the spawn is in open space, and
// every zone is reachable from it through gaps wider than the flock's separation (grid search).
import { clamp, font, pal, text, TAU } from '../core/draw';
import { listen } from '../core/input';
import { alpha, plate } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

export const FW = 1.6;
export const FH = 1;
export const SDT = 1 / 60;
const R_N = 0.08;
const R_SEP = 0.03;
const VMAX = 0.26;
const VMIN = 0.05;
export const TOOL_R = 0.45;
export const TOOL_A = 1.6;

export interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sp: 0 | 1;
  alive: boolean;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Zone {
  x: number;
  y: number;
  r: number;
  /** Which species must be here (routing), or −1 for any. */
  sp: number;
}
export interface SwarmSpec {
  kind: 'passage' | 'split' | 'capture' | 'avoid' | 'mill' | 'route';
  boids: Boid[];
  walls: Rect[];
  hazards: { x: number; y: number; r: number }[];
  zones: Zone[];
  need: number;
  hold: number;
  limit: number;
  repel: boolean;
  /** Mill: the centre to circle, and the order needed. */
  mark?: { x: number; y: number };
}
export interface Tool {
  x: number;
  y: number;
  on: boolean;
  repel: boolean;
}

const inRect = (x: number, y: number, r: Rect, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;

/** One fixed step of the flock (pure: mutates and returns the boids). */
export function stepSwarm(s: SwarmSpec, b: Boid[], tool: Tool) {
  const n = b.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = b[i];
    if (!p.alive) continue;
    let cx = 0,
      cy = 0,
      vx = 0,
      vy = 0,
      sx = 0,
      sy = 0,
      k = 0;
    for (let j = 0; j < n; j++) {
      if (i === j || !b[j].alive) continue;
      const dx = b[j].x - p.x;
      const dy = b[j].y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R_N * R_N) continue;
      if (d2 < R_SEP * R_SEP) {
        const d = Math.sqrt(d2) || 1e-6;
        sx -= (dx / d) * (R_SEP - d);
        sy -= (dy / d) * (R_SEP - d);
      }
      if (b[j].sp !== p.sp) continue;
      cx += b[j].x;
      cy += b[j].y;
      vx += b[j].vx;
      vy += b[j].vy;
      k++;
    }
    if (k) {
      ax[i] += 0.6 * (cx / k - p.x) + 1.0 * (vx / k - p.vx);
      ay[i] += 0.6 * (cy / k - p.y) + 1.0 * (vy / k - p.vy);
    }
    ax[i] += 60 * sx;
    ay[i] += 60 * sy;
    if (tool.on) {
      const dx = tool.x - p.x;
      const dy = tool.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < TOOL_R && d > 1e-6) {
        const sgn = (tool.repel ? -1 : 1) * (p.sp === 1 ? -1 : 1);
        const a = TOOL_A * (1 - d / TOOL_R) * sgn;
        ax[i] += (dx / d) * a;
        ay[i] += (dy / d) * a;
      }
    }
    // Walls and field edges push back.
    for (const w of s.walls)
      if (inRect(p.x, p.y, w, 0.04)) {
        const cxw = clamp(p.x, w.x, w.x + w.w);
        const cyw = clamp(p.y, w.y, w.y + w.h);
        const dx = p.x - cxw;
        const dy = p.y - cyw;
        const d = Math.hypot(dx, dy) || 1e-6;
        ax[i] += (dx / d) * 3 * (0.04 - Math.min(0.04, d));
        ay[i] += (dy / d) * 3 * (0.04 - Math.min(0.04, d));
      }
    if (p.x < 0.04) ax[i] += 2 * (0.04 - p.x);
    if (p.x > FW - 0.04) ax[i] -= 2 * (p.x - FW + 0.04);
    if (p.y < 0.04) ay[i] += 2 * (0.04 - p.y);
    if (p.y > FH - 0.04) ay[i] -= 2 * (p.y - FH + 0.04);
  }
  for (let i = 0; i < n; i++) {
    const p = b[i];
    if (!p.alive) continue;
    p.vx += ax[i] * SDT;
    p.vy += ay[i] * SDT;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > VMAX) {
      p.vx *= VMAX / sp;
      p.vy *= VMAX / sp;
    } else if (sp < VMIN && sp > 1e-9) {
      p.vx *= VMIN / sp;
      p.vy *= VMIN / sp;
    }
    const nx = clamp(p.x + p.vx * SDT, 0.005, FW - 0.005);
    const ny = clamp(p.y + p.vy * SDT, 0.005, FH - 0.005);
    // Solid walls: a move into a wall is cancelled along that axis.
    let bx = false;
    let by = false;
    for (const w of s.walls) {
      if (inRect(nx, p.y, w)) bx = true;
      if (inRect(p.x, ny, w)) by = true;
    }
    if (bx) p.vx = -p.vx * 0.3;
    else p.x = nx;
    if (by) p.vy = -p.vy * 0.3;
    else p.y = ny;
    for (const hz of s.hazards) if (Math.hypot(p.x - hz.x, p.y - hz.y) < hz.r) p.alive = false;
  }
  return b;
}

export const inZone = (p: Boid, z: Zone) => p.alive && Math.hypot(p.x - z.x, p.y - z.y) <= z.r && (z.sp < 0 || p.sp === z.sp);

/** Angular-momentum order about a point: 1 = everyone circling the same way, 0 = no rotation. */
export function millOrder(b: Boid[], m: { x: number; y: number }) {
  let L = 0;
  let N = 0;
  for (const p of b) {
    if (!p.alive) continue;
    const rx = p.x - m.x;
    const ry = p.y - m.y;
    L += rx * p.vy - ry * p.vx;
    N += Math.hypot(rx, ry) * Math.hypot(p.vx, p.vy);
  }
  return N ? Math.abs(L) / N : 0;
}

/** Grid search: can a particle get from a to b keeping `clear` from walls and hazards? */
export function reachable(s: SwarmSpec, a: { x: number; y: number }, b: { x: number; y: number }, clear = 0.025) {
  const g = 0.02;
  const W = Math.round(FW / g);
  const H = Math.round(FH / g);
  const free = (i: number, j: number) => {
    const x = (i + 0.5) * g;
    const y = (j + 0.5) * g;
    return !s.walls.some((w) => inRect(x, y, w, clear)) && !s.hazards.some((h) => Math.hypot(x - h.x, y - h.y) < h.r + clear);
  };
  const start = [Math.floor(a.x / g), Math.floor(a.y / g)];
  const goal = [Math.floor(b.x / g), Math.floor(b.y / g)];
  const seen = new Uint8Array(W * H);
  const q = [start];
  seen[start[1] * W + start[0]] = 1;
  while (q.length) {
    const [i, j] = q.shift()!;
    if (Math.abs(i - goal[0]) <= 1 && Math.abs(j - goal[1]) <= 1) return true;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a2 = i + di;
      const b2 = j + dj;
      if (a2 < 0 || b2 < 0 || a2 >= W || b2 >= H || seen[b2 * W + a2] || !free(a2, b2)) continue;
      seen[b2 * W + a2] = 1;
      q.push([a2, b2]);
    }
  }
  return false;
}

function flock(r: Rng, n: number, cx: number, cy: number, rad: number, sp: (i: number) => 0 | 1 = () => 0): Boid[] {
  const h = r.range(0, TAU);
  return Array.from({ length: n }, (_, i) => {
    const a = r.range(0, TAU);
    const d = Math.sqrt(r.next()) * rad;
    return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: Math.cos(h) * 0.08 + r.range(-0.02, 0.02), vy: Math.sin(h) * 0.08 + r.range(-0.02, 0.02), sp: sp(i), alive: true };
  });
}

const NB = [50, 64, 80, 96];

function validate(s: SwarmSpec) {
  const c = s.boids.reduce((a, p) => ({ x: a.x + p.x / s.boids.length, y: a.y + p.y / s.boids.length }), { x: 0, y: 0 });
  // Spawn in open space.
  if (s.boids.some((p) => s.walls.some((w) => inRect(p.x, p.y, w, 0.02)) || s.hazards.some((h) => Math.hypot(p.x - h.x, p.y - h.y) < h.r + 0.03))) return null;
  for (const z of s.zones) if (!reachable(s, c, z)) return null;
  if (s.mark && !reachable(s, c, s.mark)) return null;
  return s;
}

function genPassage(r: Rng, band: Band): SwarmSpec | null {
  const gx = r.range(0.7, 0.9);
  const gy = r.range(0.25, 0.75);
  const gw = [0.13, 0.11, 0.09, 0.075][band];
  const walls: Rect[] = [
    { x: gx, y: 0, w: 0.04, h: gy - gw / 2 },
    { x: gx, y: gy + gw / 2, w: 0.04, h: FH - gy - gw / 2 },
  ];
  const sy = r.range(0.2, 0.8);
  return validate({ kind: 'passage', boids: flock(r, NB[band], 0.25, sy, 0.1), walls, hazards: [], zones: [{ x: (gx + FW) / 2 + 0.05, y: 0.5, r: 0.4, sp: -1 }], need: [0.6, 0.7, 0.75, 0.8][band], hold: 1, limit: 45, repel: false });
}

function genSplit(r: Rng, band: Band): SwarmSpec | null {
  const walls: Rect[] = [{ x: 0.95, y: 0.35, w: 0.12, h: 0.3 }];
  const zones: Zone[] = [
    { x: 1.4, y: 0.17, r: 0.13, sp: -1 },
    { x: 1.4, y: 0.83, r: 0.13, sp: -1 },
    { x: 0.25, y: r.range(0.3, 0.7), r: 0.16, sp: -1 },
  ];
  return validate({ kind: 'split', boids: flock(r, NB[band], 0.7, 0.5, 0.09), walls, hazards: [], zones, need: [0.25, 0.3, 0.33, 0.35][band], hold: 1, limit: 60, repel: true });
}

function genCapture(r: Rng, band: Band): SwarmSpec | null {
  const z = { x: r.range(1.05, 1.4), y: r.range(0.2, 0.8), r: [0.15, 0.13, 0.12, 0.11][band], sp: -1 };
  const walls: Rect[] = [];
  for (let i = 0; i < band + 1; i++) {
    const w = { x: r.range(0.45, 1.25), y: r.range(0.05, 0.75), w: r.range(0.04, 0.08), h: r.range(0.15, 0.3) };
    if (Math.hypot(w.x - z.x, w.y - z.y) < 0.25) continue;
    walls.push(w);
  }
  return validate({ kind: 'capture', boids: flock(r, NB[band], 0.22, r.range(0.25, 0.75), 0.1), walls, hazards: [], zones: [z], need: [0.65, 0.72, 0.78, 0.82][band], hold: 2, limit: 45, repel: false });
}

function genAvoid(r: Rng, band: Band): SwarmSpec | null {
  const hazards: { x: number; y: number; r: number }[] = [];
  const n = [2, 3, 4, 5][band];
  for (let i = 0; i < n; i++) hazards.push({ x: 0.5 + (i * 0.75) / Math.max(1, n - 1) + r.range(-0.05, 0.05), y: r.range(0.15, 0.85), r: r.range(0.06, 0.09) });
  return validate({ kind: 'avoid', boids: flock(r, NB[band], 0.18, r.range(0.3, 0.7), 0.09), walls: [], hazards, zones: [{ x: 1.42, y: r.range(0.3, 0.7), r: 0.17, sp: -1 }], need: [0.55, 0.62, 0.68, 0.72][band], hold: 1, limit: 45, repel: false });
}

function genMill(r: Rng, band: Band): SwarmSpec | null {
  const mark = { x: r.range(0.6, 1.0), y: r.range(0.4, 0.6) };
  return validate({ kind: 'mill', boids: flock(r, NB[band], r.next() < 0.5 ? 0.25 : 1.35, r.range(0.3, 0.7), 0.09), walls: [], hazards: [], zones: [{ x: mark.x, y: mark.y, r: 0.3, sp: -1 }], need: [0.45, 0.5, 0.55, 0.6][band], hold: 2, limit: 60, repel: false, mark });
}

function genRoute(r: Rng, band: Band): SwarmSpec | null {
  const zones: Zone[] = [
    { x: 0.22, y: r.range(0.25, 0.75), r: 0.17, sp: 0 },
    { x: 1.38, y: r.range(0.25, 0.75), r: 0.17, sp: 1 },
  ];
  if (r.next() < 0.5) [zones[0].sp, zones[1].sp] = [1, 0];
  return validate({ kind: 'route', boids: flock(r, NB[band], 0.8, r.range(0.35, 0.65), 0.12, (i) => (i % 2) as 0 | 1), walls: band >= 2 ? [{ x: 0.78, y: 0, w: 0.04, h: 0.18 }] : [], hazards: [], zones, need: [0.5, 0.55, 0.6, 0.65][band], hold: 1, limit: 60, repel: false });
}

const loc = (z: { x: number; y: number }) => `${Math.round(z.x * 4)},${Math.round(z.y * 4)}`;
export const FAMILIES: Family<SwarmSpec>[] = [
  { id: 'capture', name: 'Capture', teach: 'Press and hold to pull the flock towards your pointer (range shown). Gather it into the ring and keep it there.', bands: [0, 3], intro: true, gen: genCapture, sig: (s) => `${loc(s.zones[0])}|${s.walls.length}` },
  { id: 'passage', name: 'Passage', teach: 'Lead the flock through the gap. Pull too hard and it piles against the wall; lead it in a line.', bands: [0, 3], gen: genPassage, sig: (s) => `${loc({ x: s.walls[0].x, y: s.walls[0].h })}` },
  { id: 'split', name: 'Split & reunite', teach: 'X switches to repel. Split the flock between the two right-hand rings, then bring it all to the left ring.', bands: [1, 3], gen: genSplit, sig: (s) => `${loc(s.zones[2])}` },
  { id: 'avoid', name: 'Avoidance', teach: 'Red discs destroy particles that touch them. Guide the flock to the ring without losing it.', bands: [0, 3], gen: genAvoid, sig: (s) => `${s.hazards.map(loc).join(';')}` },
  { id: 'mill', name: 'Mill', teach: 'Make the flock circle the marker: lead it round and round until it rotates on its own.', bands: [1, 3], gen: genMill, sig: (s) => `${loc(s.mark!)}|${Math.round(s.boids[0].x)}` },
  { id: 'route', name: 'Selective routing', teach: 'Amber particles flee your attractor. Send cyan to the cyan ring and amber to the amber ring.', bands: [1, 3], gen: genRoute, sig: (s) => `${s.zones.map((z) => loc(z) + z.sp).join(';')}` },
];

export const ROUNDS = 4;

/** Progress towards the objective at this instant, 0…1 (≥ 1 = met). */
export function progressOf(s: SwarmSpec, b: Boid[], stage: number) {
  const n = b.length;
  const frac = (z: Zone, sp = -1) => b.filter((p) => inZone(p, { ...z, sp: sp >= 0 ? sp : z.sp })).length / (sp >= 0 ? b.filter((p) => p.sp === sp).length : n);
  switch (s.kind) {
    case 'passage':
    case 'capture':
    case 'avoid':
      return frac(s.zones[0]) / s.need;
    case 'split':
      return stage === 0 ? Math.min(frac(s.zones[0]), frac(s.zones[1])) / s.need : frac(s.zones[2]) / 0.75;
    case 'mill':
      return Math.min(frac(s.zones[0]) / 0.6, millOrder(b, s.mark!) / s.need);
    case 'route':
      return Math.min(frac(s.zones[0], s.zones[0].sp), frac(s.zones[1], s.zones[1].sp)) / s.need;
  }
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<SwarmSpec>(api, 'swarm', FAMILIES, ROUNDS);
  let spec: SwarmSpec;
  let boids: Boid[] = [];
  let phase: 'ready' | 'run' | 'reveal' | 'done' = 'ready';
  const tool: Tool = { x: 0.8, y: 0.5, on: false, repel: false };
  let keyOn = false;
  let ptrOn = false;
  let t = 0;
  let held = 0;
  let sub = 0;
  let best = 0;
  let path = 0;
  let last = 0;
  let acc = 0;
  let geo = { ox: 0, oy: 0, s: 1 };
  const offs = [listen('keyup', (e) => e.code === 'Space' && (keyOn = false))];

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    spec = sess.next().rd;
    boids = spec.boids.map((p) => ({ ...p }));
    phase = 'ready';
    tool.on = false;
    tool.repel = false;
    keyOn = ptrOn = false;
    t = held = sub = best = path = 0;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const ask = {
      capture: `Gather ${Math.round(spec.need * 100)}% of the flock in the ring for ${spec.hold} s.`,
      passage: `Get ${Math.round(spec.need * 100)}% of the flock through the gap into the right side.`,
      split: `Split: ${Math.round(spec.need * 100)}% in each right ring at once — then reunite 75% in the left ring.`,
      avoid: `Bring ${Math.round(spec.need * 100)}% of the flock to the ring past the hazards.`,
      mill: 'Make the flock circle the marker on its own (rotation meter ≥ target).',
      route: `${Math.round(spec.need * 100)}% of each colour in its own ring, at the same time.`,
    }[spec.kind];
    api.prompt(ask, `${sess.teach ? sess.teach + ' · ' : ''}${spec.limit} s · press and hold to attract${spec.repel ? ' · X: repel' : ''} · Start`);
    stage.request();
  }

  function start() {
    if (phase !== 'ready') return;
    phase = 'run';
    last = 0;
    acc = 0;
    api.sfx.press();
    stage.request();
  }

  function step() {
    tool.on = keyOn || ptrOn;
    stepSwarm(spec, boids, tool);
    t += SDT;
    const p = progressOf(spec, boids, sub);
    best = Math.max(best, Math.min(1, p) * (spec.kind === 'split' ? 0.5 + 0.5 * sub : 1));
    if (p >= 1) {
      held += SDT;
      if (held >= spec.hold) {
        if (spec.kind === 'split' && sub === 0) {
          sub = 1;
          held = 0;
          api.sfx.chime(2, 0);
          api.prompt('Split! Now reunite: 75% in the left ring.', 'Pull them back together');
        } else return end(true);
      }
    } else held = 0;
    if (t >= spec.limit) end(false);
  }

  function end(ok: boolean) {
    if (phase !== 'run') return;
    phase = 'reveal';
    const lost = boids.filter((p) => !p.alive).length / boids.length;
    let pen: number;
    let main: string;
    let note: string;
    if (ok) {
      pen = Math.min(0.6, 0.3 * (t / spec.limit) + 0.4 * lost);
      main = `Done in ${t.toFixed(1)} s${lost ? `, ${Math.round(lost * 100)}% lost` : ''}.`;
      note = `${t.toFixed(1)} s · ${Math.round(lost * 100)}% lost · tool moved ${path.toFixed(1)} u`;
    } else {
      pen = clamp(1 - 0.6 * best, 0.4, 1);
      main = `Time up — reached ${Math.round(best * 100)}% of the goal.`;
      note = `${Math.round(best * 100)}% of goal · ${Math.round(lost * 100)}% lost`;
    }
    const tip = {
      capture: 'The flock follows its own neighbours more than you: pull from just ahead of it, not from far away.',
      passage: 'A flock funnels when led — place the field beyond the gap so the front particles drag the rest through.',
      split: 'Repelling from the middle of the flock splits it; attraction then holds each half.',
      avoid: 'Particles near the edge of the flock cut corners — lead wide around hazards.',
      mill: 'Circling the field around the marker makes the flock chase it; once moving, alignment keeps it rotating.',
      route: 'One field, opposite responses: the same pull that gathers cyan drives amber away.',
    }[spec.kind];
    sess.done(pen, note, { x: stage.w / 2, y: 120 });
    api.sfx[ok ? 'press' : 'release']();
    api.prompt(main, tip + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    ptrOn = keyOn = false;
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per task (time, losses, or how far from the goal)', share: 'SWARM' });
      if (r) bench.finish(r);
    }
  }

  const toWorld = (p: { x: number; y: number }) => ({ x: clamp((p.x - geo.ox) / geo.s, 0, FW), y: clamp((p.y - geo.oy) / geo.s, 0, FH) });
  const moveTool = (w: { x: number; y: number }) => {
    if (phase === 'run') path += Math.hypot(w.x - tool.x, w.y - tool.y);
    tool.x = w.x;
    tool.y = w.y;
  };

  bench.onAway = () => {
    ptrOn = keyOn = false;
    last = 0;
  };
  bench.onTap = (p) => {
    if (phase === 'reveal') return begin();
    if (phase !== 'run') return;
    moveTool(toWorld(p));
    ptrOn = true;
  };
  bench.onMove = (p) => {
    if (phase === 'run' && Number.isFinite(p.x) && (ptrOn || p.x >= geo.ox)) moveTool(toWorld(p));
  };
  bench.onUp = () => {
    ptrOn = false;
  };
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase === 'ready' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return start();
    }
    if (phase !== 'run') return;
    const st = 0.03;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    if (mv[e.key]) moveTool({ x: clamp(tool.x + mv[e.key][0], 0, FW), y: clamp(tool.y + mv[e.key][1], 0, FH) });
    else if (e.code === 'Space') keyOn = true;
    else if ((e.key === 'x' || e.key === 'X') && spec.repel) tool.repel = !tool.repel;
    else return;
    e.preventDefault();
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    if (!spec) return false;
    if (phase === 'run') {
      if (!last) last = now;
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (acc >= SDT && phase === 'run') {
        step();
        acc -= SDT;
      }
    }
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const top = 112;
    const s = Math.min((W - 32) / FW, (H - top - 70) / FH);
    geo = { ox: (W - FW * s) / 2, oy: top, s };
    const P = (x: number, y: number) => ({ x: geo.ox + x * s, y: geo.oy + y * s });
    plate(c, geo.ox - 6, geo.oy - 6, FW * s + 12, FH * s + 12, 8);
    // Zones, walls, hazards.
    spec.zones.forEach((z, i) => {
      const q = P(z.x, z.y);
      const active = spec.kind !== 'split' || (sub === 0 ? i < 2 : i === 2);
      const col = z.sp === 1 ? AMBER : pal.accent;
      c.beginPath();
      c.arc(q.x, q.y, z.r * s, 0, TAU);
      c.fillStyle = alpha(col, active ? 0.08 : 0.02);
      c.fill();
      c.strokeStyle = alpha(col, active ? 0.8 : 0.25);
      c.setLineDash([5, 4]);
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
    });
    if (spec.mark) {
      const q = P(spec.mark.x, spec.mark.y);
      c.strokeStyle = pal.accent;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(q.x - 8, q.y);
      c.lineTo(q.x + 8, q.y);
      c.moveTo(q.x, q.y - 8);
      c.lineTo(q.x, q.y + 8);
      c.stroke();
    }
    for (const w of spec.walls) {
      const q = P(w.x, w.y);
      c.fillStyle = alpha(pal.ink, 0.55);
      c.fillRect(q.x, q.y, w.w * s, w.h * s);
    }
    for (const hz of spec.hazards) {
      const q = P(hz.x, hz.y);
      c.beginPath();
      c.arc(q.x, q.y, hz.r * s, 0, TAU);
      c.fillStyle = alpha(pal.signal, 0.25);
      c.fill();
      c.strokeStyle = pal.signal;
      c.lineWidth = 1;
      c.stroke();
    }
    // Field.
    if (phase === 'run' || phase === 'ready') {
      const q = P(tool.x, tool.y);
      const on = keyOn || ptrOn;
      c.beginPath();
      c.arc(q.x, q.y, TOOL_R * s, 0, TAU);
      c.strokeStyle = alpha(pal.ink, on ? 0.25 : 0.08);
      c.lineWidth = 1;
      c.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const r0 = (tool.repel ? 10 : 18) + (on ? 2 * Math.sin(now / 120) : 0);
        const r1 = tool.repel ? 18 : 10;
        c.beginPath();
        c.moveTo(q.x + Math.cos(a) * r0, q.y + Math.sin(a) * r0);
        c.lineTo(q.x + Math.cos(a) * r1, q.y + Math.sin(a) * r1);
        c.strokeStyle = on ? pal.ink : pal.ink3;
        c.lineWidth = 1.5;
        c.stroke();
      }
    }
    // Particles, drawn as short strokes along their velocity.
    c.lineCap = 'round';
    for (const p of boids) {
      if (!p.alive) continue;
      const q = P(p.x, p.y);
      const sp = Math.hypot(p.vx, p.vy) || 1;
      c.strokeStyle = p.sp ? AMBER : pal.accent;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(q.x - (p.vx / sp) * 6, q.y - (p.vy / sp) * 6);
      c.lineTo(q.x + (p.vx / sp) * 2, q.y + (p.vy / sp) * 2);
      c.stroke();
    }
    // Meters.
    const pr = Math.min(1, progressOf(spec, boids, sub));
    const mx = geo.ox;
    const my = geo.oy + FH * s + 18;
    const mw = Math.min(260, FW * s * 0.4);
    c.fillStyle = pal.line;
    c.fillRect(mx, my, mw, 4);
    c.fillStyle = pr >= 1 ? pal.accent : AMBER;
    c.fillRect(mx, my, mw * pr, 4);
    text(c, spec.kind === 'mill' ? `rotation ${millOrder(boids, spec.mark!).toFixed(2)} / ${spec.need}` : `goal ${Math.round(pr * 100)}%`, mx, my + 18, font.mono(10, 500), pal.ink2);
    if (held > 0) text(c, `holding ${held.toFixed(1)} / ${spec.hold} s`, mx + mw + 16, my + 6, font.mono(10, 600), pal.accent);
    text(c, `${t.toFixed(1)} / ${spec.limit} s${spec.repel ? ` · ${tool.repel ? 'REPEL' : 'ATTRACT'} (X)` : ''}`, geo.ox + FW * s, my + 6, font.mono(10, 500), pal.ink3, 'right');
    if (phase === 'ready') bench.button(c, W / 2 - 70, geo.oy + (FH * s) / 2 - 22, 140, 44, 'Start', start, { primary: true, key: 'Space' });
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return phase === 'run';
  };

  return {
    reset,
    destroy: () => {
      api.ownKeys(false);
      offs.forEach((f) => f());
      bench.destroy();
    },
  };
};

export default factory;
