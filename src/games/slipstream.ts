// 28 · SLIPSTREAM — full speed down a tube. Steer round its wall (← →) and thread the gaps in the rings
// rushing at you. Pass within a few degrees of an edge — a graze — and its slipstream pulls you faster;
// five grazes charge a shield that breaks one wall for you. A graze under 1.5° is PERFECT and slows time.
// Score: distance before the crash (m), higher is better. The course is a pure function of the seed and
// the distance travelled, and the run is simulated in fixed 1/240 s steps, so a slow frame can never
// carry you through a wall.
import { clamp, font, pal, TAU, text } from '../core/draw';
import { capture, gameKey, listen } from '../core/input';
import { rng } from '../core/rng';
import { flashOK } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

/** Tube radius (m). */
export const R = 3;
/** Obstacle height off the wall (m). */
const H_OB = 0.95;
/** Ship half-width (rad). */
export const PW = 0.1;
/** A pass with less clearance than this (rad, ≈ 5.7°) is a graze. */
export const GRAZE = 0.1;
/** A graze closer than this (rad, ≈ 1.5°) is PERFECT: time slows for a moment. */
export const PERFECT = 0.026;
/** The most slipstream can add to your speed. */
export const BOOST_MAX = 0.35;
/** Grazes that charge a shield. */
export const CHARGE = 5;
const STEP = 1 / 240;
const DRAW = 120; // draw distance (m)
const CAM = 3.2; // camera distance behind the ship (m)
const CAM_Y = 1.15; // camera offset from the axis towards the floor (m)
const NEAR = -CAM * 0.8; // nearest depth drawn (m)
const LONGEST = 260; // no obstacle is deeper than this (m)
const GHOST = 0.6; // seconds you pass through walls after a shield breaks
const DOOR = 45; // doors close over their last 45 m

export interface Arc {
  /** Start angle (rad) at t = 0; the arc covers [a, a + w]. */
  a: number;
  w: number;
  /** Angular speed (rad/s): rotors turn as they come. */
  rot: number;
  /** Doors: the arc is this much shorter at each end while far away, closing to full size as it arrives. */
  grow?: number;
}
export type Pattern = 'gate' | 'twin' | 'blades' | 'zigzag' | 'spiral' | 'rotor' | 'slalom' | 'doors';
export interface Row {
  /** Distance of the front face along the tube (m). */
  z: number;
  /** Depth of the obstacle (m). Slalom rails are long. */
  len: number;
  arcs: Arc[];
  kind: Pattern;
  /** Broken by a shield: gone. */
  broken?: boolean;
}

export const CFG: Record<Level, { v0: number; gearDist: number; gap: number; omega: number; bend: number; start: number }> = {
  easy: { v0: 34, gearDist: 500, gap: 1.35, omega: 6.4, bend: 0.6, start: 1 },
  medium: { v0: 46, gearDist: 600, gap: 1.1, omega: 7.4, bend: 1, start: 1 },
  // Hard starts in second gear, bends harder and narrows the gaps.
  hard: { v0: 60, gearDist: 700, gap: 0.92, omega: 8.6, bend: 1.4, start: 2 },
};
export const MAX_GEAR = 9;

export const gearAt = (level: Level, s: number) => Math.min(MAX_GEAR, CFG[level].start + Math.floor(Math.max(0, s) / CFG[level].gearDist));
/** Base speed (m/s) at distance s: a step up each gear, plus a slow creep. */
export const speedAt = (level: Level, s: number) => CFG[level].v0 * (1 + 0.12 * (gearAt(level, s) - 1)) * (1 + Math.max(0, s) / 20000);
/** Gap width (rad) in a gear. Always far wider than the ship (2·PW). */
export const gapAt = (level: Level, gear: number) => Math.max(0.6, CFG[level].gap * (1 - 0.045 * (gear - 1)));

export const norm = (x: number) => ((x % TAU) + TAU) % TAU;

/** Where an arc really is at time t, seen at depth d (rotors turn; doors are open while far away). */
export function effArc(arc: Arc, t: number, d: number) {
  const g = arc.grow ? arc.grow * clamp(d / DOOR, 0, 1) : 0;
  return { a: arc.a + arc.rot * t + g, w: Math.max(0.002, arc.w - 2 * g) };
}
/** Clearance (rad) between the ship at angle th and an arc (at time t, depth d). Negative = overlap, a hit. */
export function clearance(arc: Arc, th: number, t = 0, d = 0) {
  const e = effArc(arc, t, d);
  const x = norm(th - e.a);
  if (x <= e.w) return -PW - Math.min(x, e.w - x);
  return Math.min(x - e.w, TAU - x) - PW;
}
export const rowClearance = (row: Row, th: number, t = 0, d = 0) => row.arcs.reduce((m, a) => Math.min(m, clearance(a, th, t, d)), Infinity);

/** A ring with gaps of `width` centred on `centers`: the blocked arcs in between. */
export function ring(centers: number[], width: number, rot = 0): Arc[] {
  const cs = centers.map(norm).sort((a, b) => a - b);
  return cs.map((c, i) => ({ a: c + width / 2, w: (i + 1 < cs.length ? cs[i + 1] : cs[0] + TAU) - c - width, rot }));
}

/** The empty stretches of a row (world angles), at time t and depth d. */
export function freeIntervals(row: Row, t: number, d: number): [number, number][] {
  const es = row.arcs.map((a) => effArc(a, t, d)).map((e) => ({ a: norm(e.a), w: e.w }));
  es.sort((p, q) => p.a - q.a);
  const out: [number, number][] = [];
  es.forEach((e, i) => {
    const end = e.a + e.w;
    const next = i + 1 < es.length ? es[i + 1].a : es[0].a + TAU;
    if (next > end + 0.01) out.push([end, next]);
  });
  return out;
}

/**
 * The course, generated lazily and deterministically from the seed: call next() until `st.z` is far enough
 * ahead. Spacing is set in seconds of travel at the base speed, with margin for full slipstream, so every
 * turn it asks for is possible. It opens with four wide, slow gates, and clears before every gear change.
 */
export function makeCourse(seed: number, level: Level) {
  const r = rng(seed);
  const rows: Row[] = [];
  const cfg = CFG[level];
  const st = { z: 70, n: 0 };
  const add = (kind: Pattern, z: number, arcs: Arc[], len = 1.6) => rows.push({ z, len, arcs, kind });
  function next() {
    let z = st.z;
    // A breather: no pattern straddles a gear change. The tube clears before it and just after.
    const gd = cfg.gearDist;
    const toShift = gd - (z % gd);
    if (st.n >= 4 && gearAt(level, z) < MAX_GEAR && toShift < speedAt(level, z) * 1.8) z += toShift + speedAt(level, z + toShift + 1) * 0.8;
    const gear = gearAt(level, z);
    const v = speedAt(level, z);
    const m = (sec: number) => sec * v;
    const om = cfg.omega;
    const g = gapAt(level, gear);
    const warm = st.n < 4;
    let kind: Pattern = 'gate';
    if (!warm) {
      const pool: Pattern[] = ['gate', 'gate', 'blades'];
      if (gear >= 2) pool.push('twin', 'zigzag', 'doors', 'blades');
      if (gear >= 3) pool.push('spiral', 'rotor', 'zigzag', 'doors');
      if (gear >= 4) pool.push('slalom', 'spiral', 'rotor');
      kind = r.pick(pool);
    }
    // The very first gap is never behind you.
    const c0 = st.n === 0 ? r.range(-1.2, 1.2) : r.range(0, TAU);
    switch (kind) {
      case 'gate':
        add(kind, z, ring([c0], warm ? Math.max(g, [2.3, 2, 1.7, 1.45][st.n] * (level === 'hard' ? 0.75 : 1)) : g));
        break;
      case 'twin':
        add(kind, z, ring([c0, c0 + Math.PI], g * 0.85));
        break;
      case 'doors':
        // The gap is wide far away and closes as it comes: commit early.
        add(kind, z, ring([c0], g).map((a) => ({ ...a, grow: 0.55 })));
        break;
      case 'blades': {
        const k = r.int(2, 3);
        add(
          kind,
          z,
          Array.from({ length: k }, (_, i) => ({ a: c0 + (i * TAU) / k + r.range(-0.25, 0.25), w: r.range(0.7, 1.15), rot: 0 })),
          2.2,
        );
        break;
      }
      case 'zigzag': {
        // Quick left-right: each gap a real swing away, reachable with a margin even at full slipstream.
        const n = r.int(4, 6);
        const dt = 0.34;
        const swing = Math.min(1.8, om * dt * 0.6);
        for (let i = 0; i < n; i++) {
          add(kind, z, ring([c0 + (i % 2 ? swing : 0)], g));
          if (i < n - 1) z += m(dt);
        }
        break;
      }
      case 'spiral': {
        // A corkscrew of thin rings: turn steadily at under half your top rate.
        const n = r.int(6, 10);
        const dt = 0.17;
        const stepA = r.sign() * om * dt * 0.45;
        for (let i = 0; i < n; i++) {
          add(kind, z, ring([c0 + i * stepA], g * 0.95), 1.1);
          if (i < n - 1) z += m(dt);
        }
        break;
      }
      case 'rotor': {
        const rot = r.sign() * om * r.range(0.2, 0.3);
        add(kind, z, ring([c0, c0 + Math.PI], g, rot), 2);
        z += m(0.6);
        add(kind, z, ring([c0 + Math.PI / 2, c0 + (3 * Math.PI) / 2], g, -rot), 2);
        break;
      }
      case 'slalom': {
        // Three long rails make three lanes; blades alternate sides inside each lane.
        const rw = 0.16;
        const L = m(1.6);
        add(kind, z, [0, 1, 2].map((k) => ({ a: c0 + (k * TAU) / 3, w: rw, rot: 0 })), L);
        const laneW = TAU / 3 - rw;
        for (let j = 1; j <= 4; j++) {
          const arcs = [0, 1, 2].map((k) => {
            const lane = c0 + (k * TAU) / 3 + rw;
            return { a: j % 2 ? lane : lane + laneW * 0.4, w: laneW * 0.6, rot: 0 };
          });
          add(kind, z + m(0.32 * j), arcs, 1.4);
        }
        z += L;
        break;
      }
    }
    st.n++;
    st.z = z + m(warm ? 1.1 : r.range(0.7, 0.85));
  }
  return { rows, st, next };
}

// Gear colours climb from the lab's cyan through azure and indigo to a hot magenta at the top gears.
const HUES = [172, 176, 186, 198, 212, 232, 258, 290, 330];

function rgbOf(col: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(col.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (col: string, a: number) => {
  const c = rgbOf(col);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgba(238,237,232,${a})`;
};
const isDark = () => {
  const c = rgbOf(pal.paper);
  return c ? (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255 < 0.4 : false;
};

interface Pop {
  text: string;
  at: number;
  side: number;
  big: boolean;
  hue: number;
  color?: string;
}
interface Bit {
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  at: number;
  ship: boolean;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let level: Level = 'medium';
  let course = makeCourse(1, level);
  let phase: 'ready' | 'run' | 'crash' | 'done' = 'ready';
  let s = 0; // distance (m) — the score
  let t = 0; // run time (s)
  let th = 0; // ship angle round the tube (rad)
  let v = 0;
  let boost = 0;
  let acc = 0;
  let lastFrame = 0;
  let frameNow = 0;
  let ri = 0; // first row whose front face is still ahead
  let gear = 1;
  let idle = 0; // ready-screen cruise
  let base0 = 0; // visual continuity from the cruise into the run
  let skid = 0; // visual slide after a crash (never scored)
  let lastVs = 0;
  let steerVis = 0;
  let boostVis = 0;
  let timeScale = 1;
  let slowUntil = 0;
  let grazes = 0;
  let perfects = 0;
  let chain = 0;
  let maxChain = 0;
  let lastGraze = -9;
  let closest = Infinity;
  let topV = 0;
  let threaded = 0;
  let shield = false;
  let charge = 0;
  let shieldsWon = 0;
  let shieldsUsed = 0;
  let ghostUntil = -1;
  let best: number | null = null;
  let markers: { z: number; label: string; kind: 'star' | 'best'; passed: boolean }[] = [];
  let crashAt = 0;
  let doneAt = 0;
  let finTimer = 0;
  let beatAt = 0;
  let beatN = 0;
  let shownProg = '';
  const keys = new Set<'L' | 'R'>();
  const ptrs = new Map<number, number>();
  const pops: Pop[] = [];
  const sparks: { x: number; y: number; vx: number; vy: number; at: number }[] = [];
  const bits: Bit[] = [];
  const exhaust: { x: number; y: number; vx: number; vy: number; at: number; coral: boolean }[] = [];
  const streaks = Array.from({ length: 64 }, (_, i) => ({ a: (i * 2.39996) % TAU, d: NEAR + ((i * 37) % 120), rr: 0.8 + ((i * 0.618) % 1) * 0.18 }));

  const progress = (txt: string) => {
    if (txt !== shownProg) api.progress((shownProg = txt));
  };
  const steer = () => {
    let d = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
    for (const p of ptrs.values()) d += p;
    return clamp(d, -1, 1);
  };
  const pop = (txt: string, big: boolean, side = 0, color?: string) => pops.push({ text: txt, at: frameNow, side, big, hue: HUES[(gear - 1) % HUES.length], color });
  const burstBits = (n: number, ship: boolean, speed = 1) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.4;
      const sp = (70 + Math.random() * 190) * speed;
      bits.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14, at: frameNow, ship });
    }
  };

  function reset(seed: number) {
    clearTimeout(finTimer);
    level = api.level;
    course = makeCourse(seed, level);
    while (course.st.z < DRAW + 120) course.next();
    phase = 'ready';
    s = t = boost = acc = v = th = skid = 0;
    ri = 0;
    gear = CFG[level].start;
    grazes = perfects = chain = maxChain = threaded = charge = shieldsWon = shieldsUsed = 0;
    shield = false;
    ghostUntil = -1;
    lastGraze = -9;
    closest = Infinity;
    topV = 0;
    timeScale = 1;
    slowUntil = 0;
    pops.length = sparks.length = bits.length = exhaust.length = 0;
    keys.clear();
    ptrs.clear();
    best = api.best?.() ?? null;
    // Gates in the tube: your star targets and your best.
    const targets = api.stars?.() ?? null;
    markers = (targets ?? []).map((z, i) => ({ z, label: '★'.repeat(i + 1), kind: 'star' as const, passed: false }));
    if (best != null && best > 0) markers.push({ z: best, label: 'BEST', kind: 'best', passed: false });
    shownProg = '';
    progress(`gear ${gear}`);
    api.prompt(
      'Hold ← or → to launch.',
      `Thread the gaps · graze edges for speed · ${CHARGE} grazes charge a shield${api.firstTime ? ' · A / D, or hold the left / right half' : ''}`,
    );
    stage.request();
  }

  function start() {
    if (phase !== 'ready') return;
    phase = 'run';
    base0 = idle;
    lastFrame = performance.now();
    beatAt = lastFrame + 60;
    beatN = 0;
    api.prompt('');
    api.sfx.press();
    stage.request();
  }

  /** Visit rows whose depth spans the ship right now (front passed, back not yet); stop when fn returns true. */
  function spanning(fn: (row: Row) => boolean) {
    for (let j = ri - 1; j >= 0; j--) {
      const row = course.rows[j];
      if (row.z + LONGEST < s) break;
      if (!row.broken && row.z + row.len >= s && fn(row)) return true;
    }
    return false;
  }

  function step() {
    t += STEP;
    const om = CFG[level].omega;
    const dir = steer();
    if (dir) {
      // A wall beside you blocks the turn; only a face-on hit counts.
      const nth = th + dir * om * STEP;
      if (t < ghostUntil || !spanning((row) => row.arcs.some((a) => clearance(a, nth, t) < Math.min(0, clearance(a, th, t))))) th = nth;
    }
    // A rotor turning into the ship sweeps it along.
    spanning((row) => {
      for (const a of row.arcs) if (a.rot && clearance(a, th, t) < 0) th += a.rot * STEP;
      return false;
    });
    th = norm(th);
    const g = gearAt(level, s);
    if (g !== gear) {
      gear = g;
      pop(`GEAR ${g}`, true);
      api.sfx.gear();
    }
    boost *= Math.exp(-STEP / 1.5);
    const launch = 1 - (1 - Math.min(1, t / 0.8)) ** 3;
    v = speedAt(level, s) * (1 + boost) * (0.2 + 0.8 * launch);
    topV = Math.max(topV, v);
    s += v * STEP;
    const rows = course.rows;
    while (ri < rows.length && rows[ri].z <= s) {
      const row = rows[ri++];
      if (row.broken) continue;
      const c = rowClearance(row, th, t);
      if (c < 0) {
        if (t < ghostUntil) continue;
        if (shield) {
          breakWall(row);
          continue;
        }
        return crash();
      }
      threaded++;
      if (c < GRAZE) graze(row, c);
    }
    if (t - lastGraze > 1.6) chain = 0;
    for (const mk of markers) {
      if (mk.passed || s < mk.z) continue;
      mk.passed = true;
      if (mk.kind === 'best') {
        pop('NEW BEST', true, 0, pal.signal);
        api.sfx.record();
      } else {
        pop(`${mk.label}  ${Math.round(mk.z)} m`, true, 0, pal.signal);
        api.sfx.star(mk.label.length);
      }
    }
    while (course.st.z < s + DRAW + 120) course.next();
  }

  function graze(row: Row, c: number) {
    grazes++;
    chain = t - lastGraze < 1.6 ? chain + 1 : 1;
    lastGraze = t;
    maxChain = Math.max(maxChain, chain);
    closest = Math.min(closest, c);
    boost = Math.min(BOOST_MAX, boost + 0.045 + 0.01 * Math.min(chain, 6));
    // Which side was the edge on? Left of the ship when its nearest end is behind it in angle.
    let side = 1;
    let mc = Infinity;
    for (const a of row.arcs) {
      const k = clearance(a, th, t);
      if (k < mc) {
        mc = k;
        const e = effArc(a, t, 0);
        const d = norm(th - e.a);
        side = d - e.w < TAU - d ? -1 : 1;
      }
    }
    const perfect = c < PERFECT;
    if (perfect) {
      perfects++;
      slowUntil = frameNow + 280;
      api.sfx.whoosh();
      api.buzz(18);
    } else api.buzz(6);
    pop(`${perfect ? 'PERFECT' : 'GRAZE'} ${((c * 180) / Math.PI).toFixed(1)}°${chain > 1 ? `  ×${chain}` : ''}`, false, side);
    for (let i = 0; i < (perfect ? 16 : 9); i++) sparks.push({ x: side * 14, y: 0, vx: side * (80 + Math.random() * 220), vy: -60 - Math.random() * 200, at: frameNow });
    api.sfx.graze(chain);
    if (!shield && ++charge >= CHARGE) {
      shield = true;
      charge = 0;
      shieldsWon++;
      pop('SHIELD READY', true);
      api.sfx.shield();
    }
  }

  /** The shield takes the hit: the wall shatters, you lose your slipstream and pass through for a moment. */
  function breakWall(row: Row) {
    row.broken = true;
    shield = false;
    shieldsUsed++;
    ghostUntil = t + GHOST;
    boost = 0;
    chain = 0;
    burstBits(22, false, 1.3);
    pop('SHIELD BROKEN', true, 0, pal.signal);
    api.sfx.shatter();
    api.buzz([20, 30, 20]);
  }

  function crash() {
    phase = 'crash';
    crashAt = frameNow;
    api.sfx.crash();
    api.buzz([40, 30, 80]);
    burstBits(18, true);
    progress('crashed');
    finTimer = window.setTimeout(finishRun, api.motion() ? 750 : 200);
  }

  function finishRun() {
    phase = 'done';
    doneAt = performance.now();
    const dist = Math.floor(s);
    const kmh = (x: number) => `${Math.round(x * 3.6)} km/h`;
    const deg = Number.isFinite(closest) ? ((closest * 180) / Math.PI).toFixed(2) : null;
    api.finish({
      score: dist,
      value: String(dist),
      unit: 'm',
      label: 'distance before the crash',
      headline: `Gear ${gear}, ${kmh(v)} — ${
        grazes ? `${grazes} graze${grazes > 1 ? 's' : ''}${perfects ? ` (${perfects} perfect)` : ''}, the closest ${deg}° from the edge.` : 'no grazes: skim the edges for slipstream and shields.'
      }`,
      rows: [
        ['Time', `${t.toFixed(2)} s`],
        ['Top speed', kmh(topV)],
        ['Gear reached', `${gear} of ${MAX_GEAR}`],
        ['Walls threaded', String(threaded)],
        ['Grazes · perfect', `${grazes} · ${perfects}`],
        ['Longest graze chain', maxChain ? `×${maxChain}` : '—'],
        ['Closest pass', deg ? `${deg}°` : '—'],
        ['Shields earned · used', `${shieldsWon} · ${shieldsUsed}`],
      ],
      near: best != null && dist < best && dist >= best * 0.9,
      share: [`SLIPSTREAM · ${api.level} — ${dist} m, top speed ${kmh(topV)}`, `${grazes} grazes${deg ? ` · closest ${deg}°` : ''}`],
    });
  }

  /** The soundtrack: a kick on the beat, a hat off it, a bass line — tempo rises with the gear. */
  function music(now: number) {
    const spb = 60000 / (126 + 8 * (gear - 1));
    if (beatAt < now - 250) beatAt = now; // after a stall, don't machine-gun the missed beats
    while (beatAt < now + 120) {
      const at = Math.max(0, (beatAt - now) / 1000);
      const root = [55, 55, 65.41, 49][Math.floor(beatN / 8) % 4];
      api.sfx.kick(at);
      api.sfx.hat(at + spb / 2000);
      api.sfx.bass(root * (beatN % 4 === 2 ? 2 : 1), at + spb / 2000, spb / 2600);
      beatAt += spb;
      beatN++;
    }
  }

  // ── Input: ← → / A D, or hold the left / right half (two thumbs work). From the result, the same keys
  // (or a tap) start the next run at once. ───────────────────────────────────────
  const retry = () => {
    if (phase === 'done' && performance.now() - doneAt > 350) api.again?.();
  };
  const keyDir = (e: KeyboardEvent) =>
    e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' ? 'L' : e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' ? 'R' : null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    retry();
    if (phase !== 'ready' && phase !== 'run') return;
    capture(stage.canvas, e.pointerId);
    ptrs.set(e.pointerId, stage.pt(e).x < stage.w / 2 ? -1 : 1);
    start();
  };
  const onUp = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const offs = [
    listen('keydown', (e) => {
      const k = keyDir(e);
      if (!k || !gameKey(e)) return;
      if (!e.repeat) retry();
      if (phase !== 'ready' && phase !== 'run') return;
      e.preventDefault();
      keys.add(k);
      start();
    }),
    listen('keyup', (e) => {
      const k = keyDir(e);
      if (k) keys.delete(k);
    }),
    listen('blur', () => {
      keys.clear();
      ptrs.clear();
    }),
  ];
  // Development only (stripped from builds): let a test bot see the next gap.
  const w = window as unknown as { __slip?: unknown };
  if (import.meta.env.DEV)
    w.__slip = {
      peek: () => {
        const row = course.rows.slice(ri).find((r) => !r.broken && !(r.kind === 'slalom' && r.len > 6));
        return { phase, s, th, t, gear, shield, charge, grazes, next: row ? { d: row.z - s, kind: row.kind, free: freeIntervals(row, t, 0) } : null };
      },
      /** Draw one frame at a given time (lets a test step the game while the tab is in the background). */
      frame: (now: number) => stage.draw(now),
    };
  // Fairness: hiding the tab mid-run would be a pause button. It voids the run instead.
  const onVis = () => {
    keys.clear();
    ptrs.clear();
    if (document.hidden && phase === 'run') api.voidRun('Run voided — the tab was hidden mid-run.');
  };
  document.addEventListener('visibilitychange', onVis);

  // ── Drawing ───────────────────────────────────────────────────────────────
  stage.draw = (now) => {
    frameNow = now;
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    // Perfect grazes slow time for a moment (the simulation itself never changes, only how fast it runs).
    timeScale += ((now < slowUntil ? 0.35 : 1) - timeScale) * Math.min(1, dt * (now < slowUntil ? 30 : 7));
    if (phase === 'run') {
      acc += dt * timeScale;
      while (acc >= STEP && phase === 'run') {
        step();
        acc -= STEP;
      }
      if (phase === 'run') {
        music(now);
        progress(`gear ${gear} · ${Math.floor(s / 10) * 10} m`);
      }
    } else if (phase === 'ready' && api.motion()) idle += dt * 9;
    const crashP = phase === 'crash' || phase === 'done' ? clamp((now - crashAt) / 700, 0, 1) : 0;
    if (crashP > 0) skid += v * dt * 0.3 * (1 - crashP) ** 3;
    steerVis += ((phase === 'run' ? steer() : 0) - steerVis) * Math.min(1, dt * 12);
    boostVis += (boost - boostVis) * Math.min(1, dt * 5);
    render(now, crashP);
    const fx = pops.some((p) => now - p.at < 1100) || sparks.length > 0 || bits.some((b) => now - b.at < 1100);
    return phase === 'run' || phase === 'crash' || (phase === 'ready' && api.motion()) || (phase === 'done' && crashP < 1) || fx;
  };

  function render(now: number, crashP: number) {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    const dark = isDark();
    const motion = api.motion();
    const hue = HUES[(gear - 1) % HUES.length];
    const accent = (a: number, dl = 0) => `hsla(${hue}, ${dark ? 88 : 76}%, ${(dark ? 62 : 45) + dl}%, ${a})`;
    const F = Math.min(H * 0.8, W * 0.62) * (1 - (0.16 * boostVis) / BOOST_MAX) * (1 + (1 - timeScale) * 0.08);
    const cx = W / 2;
    const shipY = H * 0.83;
    const vy = shipY - ((R - 0.22 - CAM_Y) * F) / CAM;
    const vs = phase === 'ready' ? idle : base0 + s + skid; // the tube's own scroll
    const dView = vs - lastVs;
    lastVs = vs;
    const ds = s + skid; // obstacle depths are measured from here
    const bendK = CFG[level].bend * (motion ? 1 : 0.35);
    const BX = 0.0011 * bendK * Math.sin(vs / 190 + 1.3);
    const BY = 0.0008 * bendK * Math.sin(vs / 260);
    let px = 0;
    let py = 0;
    const proj = (phi: number, d: number, rr: number) => {
      const k = F / (CAM + d);
      const dd = d > 0 ? d * d : 0;
      px = cx + (rr * Math.sin(phi) + BX * dd) * k;
      py = vy + (rr * Math.cos(phi) - CAM_Y + BY * dd) * k;
    };
    const fogOf = (d: number) => clamp(1 - d / DRAW, 0, 1);
    const ringPath = (d: number, rr: number, from = 0, to = TAU, n = 44) => {
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        proj(from + ((to - from) * i) / n, d, rr);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      }
    };

    c.save();
    if (crashP > 0 && crashP < 1 && motion) {
      const k = 18 * (1 - crashP) ** 2;
      c.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    c.fillStyle = dark ? '#050507' : pal.paper;
    c.fillRect(-30, -30, W + 60, H + 60);
    proj(0, DRAW, 0);
    const fx = px;
    const fy = py;

    // The world banks a little against the turn.
    c.translate(cx, shipY);
    c.rotate(-steerVis * 0.05);
    c.translate(-cx, -shipY);
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // The warp tunnel: compression rings rushing out of the core — every fourth one a bright shock — drawn
    // additively so they bloom.
    const RS = 7.5;
    if (dark) c.globalCompositeOperation = 'lighter';
    for (let k = Math.ceil((vs + NEAR) / RS); k * RS <= vs + DRAW; k++) {
      const d = k * RS - vs;
      const shock = k % 4 === 0;
      const fog = fogOf(d) ** 1.2;
      const lw = clamp((1.1 * CAM) / (CAM + d), 0.4, 2.5);
      if (shock && dark) {
        c.globalAlpha = fog * 0.16;
        c.strokeStyle = accent(1);
        c.lineWidth = lw * 7;
        ringPath(d, R, -th, TAU - th);
        c.stroke();
      }
      c.globalAlpha = fog * (shock ? 0.7 : 0.16);
      c.strokeStyle = shock ? accent(1, dark ? 10 : 0) : pal.ink3;
      c.lineWidth = shock ? lw * 1.4 : lw;
      ringPath(d, R, -th, TAU - th);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    const DS = [NEAR, -1, 0, 2, 5, 9, 14, 21, 30, 42, 57, 75, 96, DRAW];
    for (let j = 0; j < 16; j++) {
      const phi = (j / 16) * TAU - th;
      const lit = j % 4 === 0;
      // Spokes: the lit rails glow, alternating the gear colour and coral.
      c.globalAlpha = lit ? 0.5 : 0.14;
      c.strokeStyle = lit ? (j % 8 === 0 ? accent(1, 8) : 'rgba(255,94,87,0.9)') : pal.ink3;
      c.lineWidth = lit ? 1.75 : 1;
      c.beginPath();
      DS.forEach((d, i) => {
        proj(phi, d, R);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      });
      c.stroke();
      if (!lit) continue;
      // Light pulses racing along the lit lines.
      for (let k = Math.ceil((vs + NEAR - j * 7) / 30); k * 30 + j * 7 - vs < DRAW; k++) {
        const d = k * 30 + j * 7 - vs;
        proj(phi, d, R * 0.995);
        const x0 = px;
        const y0 = py;
        proj(phi, d + 5 + v * 0.03, R * 0.995);
        c.globalAlpha = fogOf(d) * 0.75;
        c.strokeStyle = accent(1, dark ? 14 : -6);
        c.lineWidth = clamp((6 * CAM) / (CAM + Math.max(d, 0.1)), 1, 6);
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(px, py);
        c.stroke();
      }
    }
    // Speed streaks: dust on the wall, stretched by your speed.
    const stretch = 1 + Math.max(v, 8) * 0.05 * (1 + boostVis * 4);
    c.strokeStyle = dark ? '#ffffff' : pal.ink2;
    for (const p of streaks) {
      if (dView > 0 && dView < 60) p.d -= dView;
      if (p.d < NEAR) {
        p.d += DRAW - NEAR;
        p.a = Math.random() * TAU;
      }
      proj(p.a - th, p.d, R * p.rr);
      const x0 = px;
      const y0 = py;
      proj(p.a - th, p.d + stretch, R * p.rr);
      c.globalAlpha = fogOf(p.d) * (dark ? 0.5 : 0.35);
      c.lineWidth = clamp((2.2 * CAM) / (CAM + Math.max(0.2, p.d)), 0.5, 2.6);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(px, py);
      c.stroke();
    }
    // Haze at the far end.
    c.globalAlpha = 1;
    const haze = c.createRadialGradient(fx, fy, 0, fx, fy, Math.min(W, H) * 0.24);
    haze.addColorStop(0, rgba(pal.paper, 0.95));
    haze.addColorStop(1, rgba(pal.paper, 0));
    c.fillStyle = haze;
    c.fillRect(0, 0, W, H);

    // Gates in the tube: each gear change, your star targets, your best.
    if (phase !== 'ready') {
      const gd = CFG[level].gearDist;
      const gates: { z: number; label: string; col: string; dash: boolean }[] = [];
      for (let k = Math.max(1, Math.ceil((ds + NEAR) / gd)); k * gd < ds + DRAW; k++)
        if (CFG[level].start + k <= MAX_GEAR) gates.push({ z: k * gd, label: `GEAR ${CFG[level].start + k}`, col: accent(1, dark ? 8 : 0), dash: false });
      for (const mk of markers) if (!mk.passed) gates.push({ z: mk.z, label: mk.kind === 'best' ? `BEST ${Math.round(mk.z)} m` : `${mk.label} ${Math.round(mk.z)} m`, col: pal.signal, dash: true });
      for (const gt of gates) {
        const d = gt.z - ds;
        if (d < NEAR || d > DRAW) continue;
        c.globalAlpha = fogOf(d);
        c.strokeStyle = gt.col;
        c.lineWidth = clamp((4 * CAM) / (CAM + Math.max(d, 0.1)), 1, 6);
        c.setLineDash(gt.dash ? [10, 8] : []);
        ringPath(d, R * 0.97);
        c.stroke();
        c.setLineDash([]);
        if (d > 1) {
          proj(Math.PI, d, R * 0.8);
          text(c, gt.label, px, py, font.mono(clamp((150 * CAM) / (CAM + d), 9, 16), 700), gt.col, 'center', 'middle');
        }
      }
    }

    // The obstacles ahead, far to near. The next two are lit: their gaps glow on the floor.
    const rows = course.rows;
    const lead: Row[] = [];
    if (phase !== 'ready') {
      for (let j = ri; j < rows.length && lead.length < 2; j++) {
        const row = rows[j];
        if (row.broken || row.z - ds > 70) continue;
        if (!(row.kind === 'slalom' && row.len > 6)) lead.push(row);
      }
      // Your line: where the ship is heading. Red when the next wall is across it.
      const next = lead[0];
      const blocked = next != null && t >= ghostUntil && rowClearance(next, th, t) < 0;
      const AIM = [0.6, 3, 7, 13, 22, 35, 50, 70];
      c.lineWidth = 2;
      for (let i = 0; i + 1 < AIM.length; i++) {
        proj(0, AIM[i], R * 0.997);
        const x0 = px;
        const y0 = py;
        proj(0, AIM[i + 1], R * 0.997);
        c.globalAlpha = (1 - i / AIM.length) * (blocked ? 0.95 : 0.55);
        c.strokeStyle = blocked ? pal.signal : accent(1, dark ? 10 : 0);
        c.lineWidth = clamp((3 * CAM) / (CAM + AIM[i]), 0.8, 3);
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(px, py);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    if (phase !== 'ready') {
      let j1 = ri;
      while (j1 < rows.length && rows[j1].z - ds < DRAW) j1++;
      // White slabs with a gear-coloured rim; the sides and tops are shaded grey so they read as solid.
      const front = dark ? '#f4f2ec' : '#ffffff';
      const side = `hsl(${hue}, 8%, ${dark ? 58 : 74}%)`;
      const top = `hsl(${hue}, 6%, ${dark ? 76 : 86}%)`;
      const rIn = R - H_OB;
      for (let j = j1 - 1; j >= 0; j--) {
        const row = rows[j];
        if (row.z + LONGEST < ds + NEAR) break;
        if (row.broken) continue;
        const dF = row.z - ds;
        const dB = dF + row.len;
        if (dB <= NEAR + 0.05) continue;
        const dF2 = Math.max(dF, NEAR + 0.05);
        const fog = clamp((DRAW - dF2) / 28, 0, 1);
        // The glowing way through.
        const li = lead.indexOf(row);
        if (li >= 0 && dF > NEAR + 0.5) {
          const near = clamp(1 - dF / 70, 0, 1);
          for (const [f0, f1] of freeIntervals(row, t, dF)) {
            const n = Math.max(2, Math.ceil((f1 - f0) / 0.1));
            c.beginPath();
            for (let i = 0; i <= n; i++) {
              proj(f0 - th + ((f1 - f0) * i) / n, Math.max(dF - 0.4, NEAR + 0.1), R * 0.998);
              if (i) c.lineTo(px, py);
              else c.moveTo(px, py);
            }
            for (let i = n; i >= 0; i--) {
              proj(f0 - th + ((f1 - f0) * i) / n, dF + 5, R * 0.998);
              c.lineTo(px, py);
            }
            c.closePath();
            c.globalAlpha = (li === 0 ? 0.55 : 0.28) * (0.35 + 0.65 * near) * fog;
            c.fillStyle = accent(1, dark ? 6 : 8);
            c.fill();
          }
        }
        const nd = row.len > 6 ? Math.ceil((dB - dF2) / 6) + 1 : 2;
        const depth = (i: number) => dF2 + ((dB - dF2) * i) / (nd - 1);
        for (const arc of row.arcs) {
          const e = effArc(arc, t, Math.max(dF, 0));
          const a0 = e.a - th;
          const n = Math.max(2, Math.ceil(e.w / 0.1));
          const along = (i: number) => a0 + (e.w * i) / n;
          c.globalAlpha = fog;
          for (const edge of [a0, a0 + e.w]) {
            c.beginPath();
            for (let i = 0; i < nd; i++) {
              proj(edge, depth(i), R);
              if (i) c.lineTo(px, py);
              else c.moveTo(px, py);
            }
            for (let i = nd - 1; i >= 0; i--) {
              proj(edge, depth(i), rIn);
              c.lineTo(px, py);
            }
            c.closePath();
            c.fillStyle = side;
            c.fill();
          }
          c.beginPath();
          for (let i = 0; i <= n; i++) {
            proj(along(i), dF2, rIn);
            if (i) c.lineTo(px, py);
            else c.moveTo(px, py);
          }
          for (let i = 0; i < nd; i++) {
            proj(a0 + e.w, depth(i), rIn);
            c.lineTo(px, py);
          }
          for (let i = n; i >= 0; i--) {
            proj(along(i), dB, rIn);
            c.lineTo(px, py);
          }
          for (let i = nd - 1; i >= 0; i--) {
            proj(a0, depth(i), rIn);
            c.lineTo(px, py);
          }
          c.closePath();
          c.fillStyle = top;
          c.fill();
          if (dF <= NEAR) continue;
          c.beginPath();
          for (let i = 0; i <= n; i++) {
            proj(along(i), dF, R);
            if (i) c.lineTo(px, py);
            else c.moveTo(px, py);
          }
          for (let i = n; i >= 0; i--) {
            proj(along(i), dF, rIn);
            c.lineTo(px, py);
          }
          c.closePath();
          c.fillStyle = front;
          c.fill();
          // Lined up to hit it (where it will be when it arrives)? The face turns the signal colour.
          const danger = phase === 'run' && t >= ghostUntil && dF > 0 && dF < 45 && clearance(arc, th, t) < 0;
          if (danger) {
            c.globalAlpha = fog * 0.55;
            c.fillStyle = pal.signal;
            c.fill();
            c.globalAlpha = fog;
          }
          // Neon outline of the face, with a haze that swells as the wall gets close.
          const lw0 = clamp((2 * CAM) / (CAM + Math.max(dF, 0.1)), 0.6, 4);
          const ncol = danger ? '#ff5e57' : accent(1, dark ? 12 : 0);
          if (dark && dF < 40) {
            c.globalCompositeOperation = 'lighter';
            c.globalAlpha = fog * 0.22 * clamp(1 - dF / 40, 0, 1);
            c.strokeStyle = ncol;
            c.lineWidth = lw0 * 7;
            c.stroke();
            c.globalCompositeOperation = 'source-over';
            c.globalAlpha = fog;
          }
          c.strokeStyle = ncol;
          c.lineWidth = lw0;
          c.stroke();
          c.beginPath();
          for (let i = 0; i <= n; i++) {
            proj(along(i), dF, rIn);
            if (i) c.lineTo(px, py);
            else c.moveTo(px, py);
          }
          c.strokeStyle = danger ? pal.signal : accent(1, dark ? 10 : 2);
          c.lineWidth = clamp(((danger ? 4.5 : 3.2) * CAM) / (CAM + Math.max(dF, 0.1)), 0.8, 6);
          c.stroke();
        }
      }
    }
    c.globalAlpha = 1;

    // The ship.
    proj(0, 0, R - 0.22);
    const sx = px;
    const sy = py;
    const u = F * 0.04;

    // The vernier compass round the tube mouth: world-locked degrees (your polar position), slowly
    // turning dashed rings. Drawn under the ship.
    if (dark) {
      proj(0, 0, 0);
      const ax = px;
      const ay = py;
      const rr0 = (R * F) / CAM;
      c.save();
      c.lineWidth = 1;
      c.setLineDash([2, 6]);
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.beginPath();
      c.arc(ax, ay, rr0 * 1.07, 0, TAU);
      c.stroke();
      c.setLineDash([8, 12]);
      c.lineDashOffset = motion ? -now / 60 : 0;
      c.strokeStyle = accent(0.2);
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(ax, ay, rr0 * 1.12, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      for (let j = 0; j < 8; j++) {
        const phi = (j / 8) * TAU - th;
        const lx = ax + Math.sin(phi) * rr0 * 1.25;
        const ly = ay + Math.cos(phi) * rr0 * 1.25;
        text(c, `${String(j * 45).padStart(3, '0')}°`, lx, ly, font.mono(9, 500), 'rgba(255,255,255,0.4)', 'center', 'middle');
      }
      c.restore();
    }
    // Plasma exhaust: sparks shed behind the craft, cyan and coral, brighter with the slipstream.
    if (phase === 'run' && motion) {
      for (let i = 0; i < 2; i++)
        exhaust.push({ x: sx + (Math.random() - 0.5) * u * 0.6, y: sy + u * 0.5, vx: (Math.random() - 0.5) * 40 - steerVis * 80, vy: 90 + Math.random() * 120 + boostVis * 400, at: now, coral: Math.random() < 0.35 + boostVis });
    }
    if (exhaust.length) {
      c.save();
      c.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      for (let i = exhaust.length - 1; i >= 0; i--) {
        const p = exhaust[i];
        const tt = (now - p.at) / 1000;
        if (tt > 0.45) {
          exhaust.splice(i, 1);
          continue;
        }
        const life = 1 - tt / 0.45;
        c.globalAlpha = life * 0.8;
        c.fillStyle = p.coral ? '#ff5e57' : accent(1, 10);
        c.beginPath();
        c.arc(p.x + p.vx * tt, p.y + p.vy * tt, Math.max(0.5, u * 0.18 * life), 0, TAU);
        c.fill();
      }
      c.restore();
    }
    if (phase !== 'crash' && phase !== 'done') {
      const bob = phase === 'ready' && motion ? Math.sin(now / 320) * u * 0.12 : 0;
      const ghost = t < ghostUntil && phase === 'run';
      c.save();
      c.translate(sx, sy + bob);
      c.fillStyle = rgba('#000000', dark ? 0.45 : 0.18);
      c.beginPath();
      c.ellipse(0, u * 0.62, u * 1.2, u * 0.26, 0, 0, TAU);
      c.fill();
      const halo = c.createRadialGradient(0, 0, 0, 0, 0, u * 3.2);
      halo.addColorStop(0, accent(0.4 + boostVis));
      halo.addColorStop(1, accent(0));
      c.fillStyle = halo;
      c.fillRect(-u * 3.2, -u * 3.2, u * 6.4, u * 6.4);
      // Shield: a ring round the ship. Charge: pips above it.
      if (shield) {
        c.globalAlpha = 0.65 + (motion ? 0.25 * Math.sin(now / 140) : 0.2);
        c.strokeStyle = accent(1, dark ? 12 : 0);
        c.lineWidth = 2.2;
        c.beginPath();
        c.arc(0, -u * 0.2, u * 1.95, 0, TAU);
        c.stroke();
        c.globalAlpha = 1;
      } else if (phase === 'run') {
        for (let i = 0; i < CHARGE; i++) {
          const a = -Math.PI / 2 + (i - (CHARGE - 1) / 2) * 0.3;
          c.fillStyle = i < charge ? accent(1, dark ? 10 : 0) : rgba(dark ? '#ffffff' : '#000000', 0.18);
          c.beginPath();
          c.arc(Math.cos(a) * u * 2.1, -u * 0.2 + Math.sin(a) * u * 2.1, Math.max(1.6, u * 0.14), 0, TAU);
          c.fill();
        }
      }
      if (ghost && motion && Math.floor(now / 60) % 2) c.globalAlpha = 0.35;
      c.rotate(steerVis * 0.2);
      c.scale(1 - Math.abs(steerVis) * 0.22, 1);
      if (phase === 'run') {
        const fl = (1.3 + (motion ? 0.35 * Math.sin(now / 28) : 0) + boostVis * 5) * u;
        const flame = c.createLinearGradient(0, u * 0.4, 0, u * 0.5 + fl);
        // Plasma thruster: the gear's colour cruising, coral when the slipstream is pushing you.
        const hot = boostVis > 0.03;
        flame.addColorStop(0, hot ? 'rgba(255,214,200,1)' : accent(1, dark ? 20 : 10));
        flame.addColorStop(0.35, hot ? 'rgba(255,94,87,0.9)' : accent(0.8, 6));
        flame.addColorStop(1, hot ? 'rgba(255,94,87,0)' : accent(0));
        c.fillStyle = flame;
        c.beginPath();
        c.moveTo(-u * 0.24, u * 0.42);
        c.lineTo(u * 0.24, u * 0.42);
        c.lineTo(0, u * 0.5 + fl);
        c.closePath();
        c.fill();
      }
      // The craft: an alabaster delta wing in a cyan halo, a neon core vector inside it.
      c.save();
      c.shadowColor = accent(1, 10);
      c.shadowBlur = 18;
      c.beginPath();
      c.moveTo(0, -u * 1.35);
      c.lineTo(u * 1.1, u * 0.55);
      c.lineTo(u * 0.38, u * 0.3);
      c.lineTo(0, u * 0.5);
      c.lineTo(-u * 0.38, u * 0.3);
      c.lineTo(-u * 1.1, u * 0.55);
      c.closePath();
      c.fillStyle = dark ? '#f4f0e8' : accent(1);
      c.fill();
      c.restore();
      c.lineWidth = 1.2;
      c.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : pal.ink;
      c.stroke();
      c.beginPath();
      c.moveTo(0, -u * 0.8);
      c.lineTo(u * 0.48, u * 0.36);
      c.lineTo(0, u * 0.22);
      c.lineTo(-u * 0.48, u * 0.36);
      c.closePath();
      c.fillStyle = accent(1, dark ? 4 : -6);
      c.fill();
      c.restore();
    }

    // Fragments: the ship's (a crash) or a wall's (a shield).
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      const tt = (now - b.at) / 1000;
      if (tt > 1.1) {
        bits.splice(i, 1);
        continue;
      }
      const x = sx + b.vx * tt;
      const y = sy - (b.ship ? 0 : u * 2) + b.vy * tt + 260 * tt * tt;
      c.globalAlpha = clamp(1 - tt / 1.1, 0, 1);
      c.fillStyle = b.ship ? accent(1) : dark ? '#f4f2ec' : `hsl(${hue}, 6%, 80%)`;
      c.save();
      c.translate(x, y);
      c.rotate(b.rot + b.vr * tt);
      c.beginPath();
      c.moveTo(0, -u * 0.5);
      c.lineTo(u * 0.35, u * 0.3);
      c.lineTo(-u * 0.35, u * 0.3);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;

    // Graze sparks fly off the edge you skimmed.
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      const tt = (now - p.at) / 1000;
      if (tt > 0.45 || !motion) {
        sparks.splice(i, 1);
        continue;
      }
      const x = sx + p.x + p.vx * tt;
      const y = sy + p.y + p.vy * tt + 500 * tt * tt;
      c.globalAlpha = 1 - tt / 0.45;
      c.strokeStyle = accent(1, 15);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - p.vx * 0.025, y - p.vy * 0.025);
      c.stroke();
    }
    c.globalAlpha = 1;

    // Ready: chevrons either side of the ship.
    if (phase === 'ready') {
      const p = motion ? 0.5 + 0.5 * Math.sin(now / 260) : 1;
      c.globalAlpha = 0.45 + 0.55 * p;
      for (const sd of [-1, 1]) text(c, sd < 0 ? '‹' : '›', sx + sd * (u * 2.6 + p * 6), sy + u * 0.2, font.mono(Math.round(u * 2.2), 400), pal.ink, 'center', 'middle');
      c.globalAlpha = 1;
    }
    c.restore();

    // Slow motion tints the edges; a crash is a hit of red (a soft vignette when flashes are off).
    if (timeScale < 0.95) {
      const sv = c.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.35, cx, H / 2, Math.max(W, H) * 0.75);
      sv.addColorStop(0, accent(0));
      sv.addColorStop(1, accent(0.35 * (1 - timeScale)));
      c.fillStyle = sv;
      c.fillRect(0, 0, W, H);
    }
    if (crashP > 0 && crashP < 1) {
      if (flashOK()) {
        c.fillStyle = rgba(pal.signal, 0.32 * (1 - crashP) ** 2);
        c.fillRect(0, 0, W, H);
      } else {
        const vg = c.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.3, cx, H / 2, Math.max(W, H) * 0.75);
        vg.addColorStop(0, rgba(pal.signal, 0));
        vg.addColorStop(1, rgba(pal.signal, 0.3 * (1 - crashP)));
        c.fillStyle = vg;
        c.fillRect(0, 0, W, H);
      }
    }
    const vig = c.createRadialGradient(cx, H * 0.55, Math.min(W, H) * 0.35, cx, H * 0.55, Math.hypot(W, H) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${dark ? 0.45 : 0.12})`);
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);

    // Floating words: grazes beside the ship; gears, stars, shields and records in the middle (the newest
    // headline replaces the one before it, so they never pile up).
    let headline = false;
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const age = (now - p.at) / 1000;
      if (age > 1.1) {
        pops.splice(i, 1);
        continue;
      }
      const k = clamp(age / 0.18, 0, 1);
      c.globalAlpha = clamp((1.1 - age) / 0.35, 0, 1);
      const col = p.color ?? `hsl(${p.hue}, ${dark ? 88 : 76}%, ${dark ? 66 : 40}%)`;
      if (p.big) {
        if (headline) continue;
        headline = true;
        const sc = motion ? 0.7 + 0.3 * k : 1;
        text(c, p.text, cx, H * 0.3 - (motion ? age * 14 : 0), font.mono(Math.round(28 * sc), 700), col, 'center', 'middle');
      } else {
        text(c, p.text, sx + p.side * u * 2.6, sy - u * 2.4 - (motion ? age * 40 : 0), font.mono(13, 700), col, p.side < 0 ? 'right' : 'left', 'middle');
      }
    }
    c.globalAlpha = 1;

    // HUD: distance and speed (left), gear (right), slipstream and shield (bottom).
    if (phase !== 'ready') {
      const panel = (x: number, y: number, w: number, h: number, edge?: string) => {
        c.fillStyle = rgba(pal.paper, 0.72);
        c.beginPath();
        c.roundRect?.(x, y, w, h, 4);
        c.fill();
        c.strokeStyle = edge ?? rgba(pal.ink, 0.12);
        c.lineWidth = 1;
        c.stroke();
      };
      // Velocity vector (top left): the distance, then speed, Mach and boost chips.
      const dist = Math.floor(s).toLocaleString('en-US');
      const kmh = Math.round(v * 3.6);
      const mult = 1 + boostVis;
      const flux = boostVis > BOOST_MAX * 0.6;
      c.font = font.mono(40, 300);
      const dW = c.measureText(dist).width;
      const chips = [`${kmh.toLocaleString('en-US')} KM/H`, `MACH ${(kmh / 1235).toFixed(2)}`, ...(flux ? ['HYPERFLUX'] : []), `${mult.toFixed(1)}× BOOST`];
      c.font = font.mono(10, 600);
      const chipW = chips.map((t) => c.measureText(t).width + 14);
      const pw = Math.max(dW + 60, chipW.reduce((a, b) => a + b + 6, 0) + 26);
      panel(12, 12, pw, 98);
      c.fillStyle = accent(1);
      c.beginPath();
      c.arc(26, 30, 3, 0, TAU);
      c.fill();
      text(c, 'VELOCITY VECTOR', 36, 30, font.mono(10, 600), accent(1, dark ? 8 : 0), 'left', 'middle');
      text(c, dist, 24, 72, font.mono(40, 300), pal.ink, 'left');
      text(c, 'M', 30 + dW, 72, font.mono(13, 600), accent(1), 'left');
      let chx = 24;
      chips.forEach((t, i) => {
        const hot = t === 'HYPERFLUX';
        c.beginPath();
        c.roundRect?.(chx, 84, chipW[i], 18, 3);
        c.fillStyle = hot ? rgba(pal.signal, 0.2) : rgba(pal.paper, 0.6);
        c.fill();
        c.strokeStyle = hot ? pal.signal : rgba(pal.ink, 0.18);
        c.stroke();
        text(c, t, chx + chipW[i] / 2, 93.5, font.mono(10, 600), hot ? pal.signal : i === 0 ? pal.ink : accent(1, dark ? 8 : 0), 'center', 'middle');
        chx += chipW[i] + 6;
      });
      // Gear overdrive (top right): italic gear name and one cell per gear, the top one hot.
      const gw = 210;
      panel(W - 12 - gw, 12, gw, 62);
      text(c, `Gear ${gear} ${gear >= MAX_GEAR ? 'overdrive' : 'engaged'}`, W - 12 - gw + 16, 38, font.serif(19, true), pal.ink, 'left', 'middle');
      for (let i = 0; i < MAX_GEAR; i++) {
        const on = i < gear;
        c.fillStyle = on ? (i === MAX_GEAR - 1 ? pal.signal : accent(1)) : rgba(pal.ink, 0.12);
        c.beginPath();
        c.roundRect?.(W - 12 - gw + 16 + i * ((gw - 32) / MAX_GEAR), 54, (gw - 32) / MAX_GEAR - 3, 8, 2);
        c.fill();
      }
      // Aperture strip (bottom): slipstream boost and shield integrity.
      const mw = Math.min(520, W * 0.7);
      const my = H - 44;
      panel(cx - mw / 2, my - 16, mw, 50);
      text(c, chain > 1 ? `SLIPSTREAM ×${chain}` : 'SLIPSTREAM', cx - mw / 2 + 16, my, font.mono(10, 600), boostVis > 0.02 ? accent(1) : pal.ink3, 'left', 'middle');
      const bx = cx - mw / 2 + 140;
      const bw = mw / 2 - 150;
      c.fillStyle = rgba(pal.ink, 0.1);
      c.beginPath();
      c.roundRect?.(bx, my - 3, bw, 6, 3);
      c.fill();
      const bg = c.createLinearGradient(bx, 0, bx + bw, 0);
      bg.addColorStop(0, accent(1));
      bg.addColorStop(1, pal.signal);
      c.fillStyle = bg;
      c.beginPath();
      c.roundRect?.(bx, my - 3, Math.max(0.1, (bw * boostVis) / BOOST_MAX), 6, 3);
      c.fill();
      const sxh = cx + 10;
      text(c, 'SHIELD', sxh, my, font.mono(10, 600), shield ? accent(1) : pal.ink3, 'left', 'middle');
      for (let i = 0; i < CHARGE; i++) {
        c.fillStyle = shield || i < charge ? accent(1) : rgba(pal.ink, 0.14);
        c.fillRect(sxh + 58 + i * 12, my - 7, 7, 14);
      }
      text(c, shield ? 'ARMED' : `${charge}/${CHARGE}`, sxh + 58 + CHARGE * 12 + 8, my, font.mono(10, 600), shield ? accent(1) : pal.ink2, 'left', 'middle');
      text(c, `GRAZES ${grazes} · PERFECT ${perfects}`, cx - mw / 2 + 16, my + 20, font.mono(9, 500), pal.ink3, 'left', 'middle');
      text(c, `TOP ${Math.round(topV * 3.6)} KM/H`, cx + mw / 2 - 16, my + 20, font.mono(9, 500), pal.ink3, 'right', 'middle');
    }
  }

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      if (import.meta.env.DEV) delete w.__slip;
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;
