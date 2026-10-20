// 47 · DESCENT — find the lowest point of a landscape you cannot see.
// Landscapes are smooth by construction: a gentle bowl plus Gaussian wells,
//   f(x) = k·|x − b|² + t·x − Σ dᵢ·exp(−|x − cᵢ|² / 2wᵢ²),
// on [0, 1] or [0, 1]². The global minimum is located numerically (a fine grid, then golden-section /
// coordinate refinement) and every landscape must have a unique winner: any other local minimum is at
// least 8% of the height range higher and well separated, so "the" answer is never a coin toss.
// Families differ in what a measurement tells you: height and slope along a walk with limited reach,
// slope only on a near-flat plateau, height with bounded noise (σ shown; repeats average), a handful of
// free height queries, or a 2-D map. Score: within tolerance of the global minimum is near-perfect;
// otherwise the gap in height and the distance both count.
import { clamp, font, pal, text } from '../core/draw';
import { alpha, plate } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, type Pt } from './kit';
import { famChip, fork, Session, type Band, type Family } from './lab';

export interface Well {
  c: number[];
  d: number;
  w: number;
}
export interface Land {
  dim: 1 | 2;
  k: number;
  b: number[];
  t: number;
  wells: Well[];
}
export const fOf = (L: Land, p: number[]) => {
  let v = 0;
  for (let i = 0; i < L.dim; i++) v += L.k * (p[i] - L.b[i]) ** 2;
  v += L.t * p[0];
  for (const w of L.wells) {
    let r2 = 0;
    for (let i = 0; i < L.dim; i++) r2 += (p[i] - w.c[i]) ** 2;
    v -= w.d * Math.exp(-r2 / (2 * w.w * w.w));
  }
  return v;
};
export const slope1 = (L: Land, x: number) => (fOf(L, [x + 1e-5]) - fOf(L, [x - 1e-5])) / 2e-5;

/** Local minima on a grid (refined), sorted by value; plus the landscape's range. */
export function minima(L: Land) {
  const mins: { p: number[]; v: number }[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  if (L.dim === 1) {
    const N = 2000;
    const v = Array.from({ length: N + 1 }, (_, i) => fOf(L, [i / N]));
    v.forEach((x) => ((lo = Math.min(lo, x)), (hi = Math.max(hi, x))));
    for (let i = 0; i <= N; i++) {
      const l = i > 0 ? v[i - 1] : Infinity;
      const r = i < N ? v[i + 1] : Infinity;
      if (v[i] <= l && v[i] < r) {
        // Golden-section refinement inside the bracket.
        let a = Math.max(0, (i - 1) / N);
        let b = Math.min(1, (i + 1) / N);
        for (let k = 0; k < 40; k++) {
          const m1 = b - (b - a) / 1.618;
          const m2 = a + (b - a) / 1.618;
          if (fOf(L, [m1]) < fOf(L, [m2])) b = m2;
          else a = m1;
        }
        const x = (a + b) / 2;
        mins.push({ p: [x], v: fOf(L, [x]) });
      }
    }
  } else {
    const N = 120;
    const g = (i: number, j: number) => fOf(L, [i / N, j / N]);
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const v = g(i, j);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        let isMin = true;
        for (let di = -1; di <= 1 && isMin; di++)
          for (let dj = -1; dj <= 1; dj++) {
            if (!di && !dj) continue;
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a > N || b > N) continue;
            if (g(a, b) < v || (g(a, b) === v && (di < 0 || (di === 0 && dj < 0)))) {
              isMin = false;
              break;
            }
          }
        if (!isMin) continue;
        // Coordinate refinement.
        const p = [i / N, j / N];
        let h = 1 / N;
        for (let k = 0; k < 40; k++) {
          for (const ax of [0, 1])
            for (const s of [-1, 1]) {
              const q = [...p];
              q[ax] = clamp(q[ax] + s * h, 0, 1);
              if (fOf(L, q) < fOf(L, p)) p[ax] = q[ax];
            }
          h *= 0.7;
        }
        mins.push({ p, v: fOf(L, p) });
      }
  }
  mins.sort((a, b) => a.v - b.v);
  return { mins, lo, hi };
}

export interface DescentRound {
  kind: 'walk' | 'flat' | 'noisy' | 'queries' | 'map';
  land: Land;
  /** The verified global minimum. */
  best: number[];
  fBest: number;
  lo: number;
  hi: number;
  start?: number[];
  reach?: number;
  budget: number;
  noise?: number;
  tol: number;
}

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

function check(L: Land) {
  const { mins, lo, hi } = minima(L);
  if (!mins.length) return null;
  const g = mins[0];
  if (g.p.some((v) => v < 0.05 || v > 0.95)) return null;
  // Unique winner: every other minimum is clearly higher, or it is the same basin.
  // A rival valley must also lie well outside any commit tolerance (so landing in it is never "close enough").
  for (const m of mins.slice(1)) {
    const d = dist(m.p, g.p);
    if (d > 0.02 && (m.v - g.v < 0.08 * (hi - lo) || d < 0.12)) return null;
  }
  return { g, mins, lo, hi };
}

function wells1(r: Rng, n: number, depth: [number, number], width: [number, number]) {
  const out: Well[] = [];
  for (let i = 0; i < n; i++) out.push({ c: [r.range(0.08, 0.92)], d: r.range(depth[0], depth[1]), w: r.range(width[0], width[1]) });
  return out;
}

function genWalk(r: Rng, band: Band): DescentRound | null {
  const L: Land = { dim: 1, k: r.range(0.2, 0.6), b: [r.range(0.3, 0.7)], t: r.range(-0.2, 0.2), wells: wells1(r, [2, 3, 3, 4][band], [0.4, 1], [0.04, 0.09]) };
  const ck = check(L);
  if (!ck) return null;
  // Start in the basin of a local (not global) minimum when there is one — the deceptive valley.
  const locals = ck.mins.slice(1).filter((m) => dist(m.p, ck.g.p) > 0.2);
  if (band >= 1 && !locals.length) return null;
  const s0 = locals.length ? clamp(r.pick(locals).p[0] + r.range(-0.06, 0.06), 0.02, 0.98) : r.next() < 0.5 ? r.range(0.02, 0.25) : r.range(0.75, 0.98);
  if (Math.abs(s0 - ck.g.p[0]) < 0.25) return null;
  return { kind: 'walk', land: L, best: ck.g.p, fBest: ck.g.v, lo: ck.lo, hi: ck.hi, start: [s0], reach: [0.18, 0.15, 0.12, 0.1][band], budget: [9, 8, 7, 6][band], tol: 0.025 };
}

function genFlat(r: Rng, band: Band): DescentRound | null {
  const c = r.range(0.12, 0.88);
  const side = c < 0.5 ? 1 : -1;
  // A deep narrow well, a near-flat plateau elsewhere with a faint tilt down towards it, and a decoy dip.
  const L: Land = {
    dim: 1,
    k: 0,
    b: [0.5],
    t: -side * r.range(0.04, 0.09) * (band >= 2 ? 0.6 : 1),
    wells: [
      { c: [c], d: r.range(0.8, 1.2), w: r.range(0.04, 0.07) },
      { c: [clamp(c + side * r.range(0.35, 0.55), 0.1, 0.9)], d: r.range(0.05, 0.12), w: r.range(0.03, 0.05) },
    ],
  };
  const ck = check(L);
  if (!ck) return null;
  const s0 = clamp(c + side * r.range(0.4, 0.6), 0.03, 0.97);
  if (Math.abs(slope1(L, s0)) > 0.4) return null;
  return { kind: 'flat', land: L, best: ck.g.p, fBest: ck.g.v, lo: ck.lo, hi: ck.hi, start: [s0], reach: [0.2, 0.17, 0.14, 0.12][band], budget: [9, 8, 7, 6][band], tol: 0.025 };
}

function genNoisy(r: Rng, band: Band): DescentRound | null {
  const L: Land = { dim: 1, k: r.range(0.3, 0.8), b: [r.range(0.2, 0.8)], t: 0, wells: wells1(r, 3, [0.3, 0.8], [0.05, 0.12]) };
  const ck = check(L);
  if (!ck) return null;
  return { kind: 'noisy', land: L, best: ck.g.p, fBest: ck.g.v, lo: ck.lo, hi: ck.hi, budget: [11, 10, 9, 8][band], noise: (ck.hi - ck.lo) * [0.08, 0.13, 0.18, 0.22][band], tol: 0.035 };
}

function genQueries(r: Rng, band: Band): DescentRound | null {
  const L: Land = { dim: 1, k: r.range(0.1, 0.4), b: [r.range(0.3, 0.7)], t: r.range(-0.15, 0.15), wells: wells1(r, [2, 3, 3, 4][band], [0.4, 1], [0.035, 0.08]) };
  const ck = check(L);
  if (!ck) return null;
  return { kind: 'queries', land: L, best: ck.g.p, fBest: ck.g.v, lo: ck.lo, hi: ck.hi, budget: [6, 5, 5, 4][band], tol: 0.03 };
}

function genMap(r: Rng, band: Band): DescentRound | null {
  const n = [2, 3, 3, 4][band];
  const wells: Well[] = Array.from({ length: n }, () => ({ c: [r.range(0.12, 0.88), r.range(0.12, 0.88)], d: r.range(0.4, 1), w: r.range(0.08, 0.15) }));
  const L: Land = { dim: 2, k: r.range(0.2, 0.5), b: [r.range(0.3, 0.7), r.range(0.3, 0.7)], t: 0, wells };
  const ck = check(L);
  if (!ck) return null;
  return { kind: 'map', land: L, best: ck.g.p, fBest: ck.g.v, lo: ck.lo, hi: ck.hi, budget: [9, 8, 7, 6][band], tol: 0.05 };
}

export const FAMILIES: Family<DescentRound>[] = [
  { id: 'walk', name: 'Valley walk', teach: 'Tap within your reach to step there; each step shows the height and the slope. Downhill is not always the way to the lowest point.', bands: [0, 3], intro: true, gen: genWalk, sig: (rd) => `${Math.round(rd.best[0] * 10)}|${Math.round(rd.start![0] * 10)}|${rd.land.wells.length}` },
  { id: 'flat', name: 'Plateau', teach: 'Here you only feel the slope, and it is faint. Read its direction carefully before committing your steps.', bands: [1, 3], gen: genFlat, sig: (rd) => `${Math.round(rd.best[0] * 10)}|${Math.round(rd.start![0] * 10)}` },
  { id: 'noisy', name: 'Noisy gauge', teach: 'Measure anywhere, but each reading is off by up to the bar shown. Measuring the same place again averages the noise.', bands: [1, 3], gen: genNoisy, sig: (rd) => `${Math.round(rd.best[0] * 10)}|${rd.land.wells.length}` },
  { id: 'queries', name: 'Few queries', teach: 'A handful of exact height readings, anywhere. Spread them to find the right valley, then spend the rest inside it.', bands: [0, 3], gen: genQueries, sig: (rd) => `${Math.round(rd.best[0] * 10)}|${rd.land.wells.length}|${rd.budget}` },
  { id: 'map', name: '2-D map', teach: 'A whole terrain. Each reading is one point’s height; combine a few to find the deepest basin.', bands: [1, 3], gen: genMap, sig: (rd) => `${Math.round(rd.best[0] * 5)},${Math.round(rd.best[1] * 5)}|${rd.land.wells.length}` },
];

export const ROUNDS = 5;

/** Penalty for committing at p. */
export function descentPen(rd: DescentRound, p: number[]) {
  const d = dist(p, rd.best);
  const gap = (fOf(rd.land, p) - rd.fBest) / (rd.hi - rd.lo);
  if (d <= rd.tol) return { pen: (0.15 * d) / rd.tol, d, gap };
  return { pen: Math.min(1, 0.15 + 0.85 * Math.min(1, 3 * gap + d)), d, gap };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<DescentRound>(api, 'descent', FAMILIES, ROUNDS);
  let rd: DescentRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let probe: number[] = [0.5];
  let cursor: number[] = [0.5];
  let meas: { p: number[]; v: number; s?: number }[] = [];
  let committed: number[] | null = null;
  let geo = { x: 0, y: 0, w: 1, h: 1 };
  let heat: HTMLCanvasElement | null = null;
  // The plot's floor sits an unknown distance below the true minimum, so a low dot is not a giveaway.
  let pad = 0.25;
  let noiseR: Rng = rng(1);

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  const walking = () => rd.kind === 'walk' || rd.kind === 'flat';

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    meas = [];
    committed = null;
    heat = null;
    // Per-round stream for noise and display padding, so the next rounds do not depend on how many readings you took.
    noiseR = fork(sess.rand);
    pad = noiseR.range(0.12, 0.45);
    probe = rd.start ? [...rd.start] : rd.land.dim === 2 ? [0.5, 0.5] : [0.5];
    cursor = [...probe];
    if (walking()) measureAt(probe, false);
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const ask = walking() ? 'Find the lowest point of the whole landscape, step by step.' : rd.kind === 'map' ? 'Find the lowest point of this terrain.' : 'Find the lowest point on the line.';
    api.prompt(ask, sess.teach || (walking() ? `Tap a spot within reach, then Step · ${rd.budget} steps · Commit where you stand` : `Tap a spot, Measure · ${rd.budget} readings · Commit at the cursor`));
    stage.request();
  }

  function measureAt(p: number[], count = true) {
    const v = fOf(rd.land, p);
    const noise = rd.noise ? noiseR.range(-rd.noise, rd.noise) : 0;
    meas.push({ p: [...p], v: v + noise, s: rd.land.dim === 1 ? slope1(rd.land, p[0]) : undefined });
    if (count) api.sfx.tick();
  }

  const used = () => (walking() ? meas.length - 1 : meas.length);

  function act() {
    if (phase !== 'play' || used() >= rd.budget) return;
    if (walking()) {
      const d = cursor[0] - probe[0];
      probe = [clamp(probe[0] + clamp(d, -rd.reach!, rd.reach!), 0, 1)];
      cursor = [...probe];
      measureAt(probe);
    } else measureAt(cursor);
    stage.request();
  }

  function commit() {
    if (phase !== 'play') return;
    const p = walking() ? probe : cursor;
    committed = [...p];
    const res = descentPen(rd, p);
    const ok = res.d <= rd.tol;
    const others = minima(rd.land).mins.filter((m) => dist(m.p, rd.best) > 0.05);
    const inLocal = !ok && others.some((m) => dist(m.p, p) < 0.06);
    const main = ok ? `On the global minimum (${res.d.toFixed(3)} away).` : inLocal ? 'You settled in a local minimum — a valley, but not the deepest.' : `${res.d.toFixed(2)} from the global minimum, ${(res.gap * 100).toFixed(0)}% of the height range above it.`;
    const sub =
      rd.kind === 'walk'
        ? 'Following the slope finds the bottom of the valley you are in; only exploring finds the deepest one.'
        : rd.kind === 'flat'
          ? 'On a plateau the slope is tiny but still points somewhere — a long step along it pays off.'
          : rd.kind === 'noisy'
            ? `Each reading was ±${rd.noise!.toFixed(2)}. Differences smaller than that are not evidence.`
            : rd.kind === 'queries'
              ? 'A few spread-out readings find the right basin; then readings inside it refine the bottom.'
              : 'In 2-D a coarse grid of readings locates the deepest basin before you zoom in.';
    phase = 'reveal';
    sess.done(res.pen, `${ok ? 'global' : inLocal ? 'local minimum' : 'off'} · ${res.d.toFixed(3)} away · ${used()} ${walking() ? 'steps' : 'readings'}`, { x: stage.w / 2, y: 120 });
    api.sfx[ok ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per landscape (distance and height gap to the global minimum)', share: 'DESCENT' });
      if (r) bench.finish(r);
    }
    stage.request();
  }

  const toWorld = (p: Pt) => (rd.land.dim === 1 ? [clamp((p.x - geo.x) / geo.w, 0, 1)] : [clamp((p.x - geo.x) / geo.w, 0, 1), clamp((p.y - geo.y) / geo.h, 0, 1)]);
  const inPlot = (p: Pt) => p.x >= geo.x - 10 && p.x <= geo.x + geo.w + 10 && p.y >= geo.y - 10 && p.y <= geo.y + geo.h + 10;

  bench.onTap = (p) => {
    if (phase === 'reveal') return begin();
    if (phase === 'play' && inPlot(p)) cursor = toWorld(p);
  };
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase !== 'play') return;
    const st = e.shiftKey ? 0.005 : 0.02;
    if (e.key === 'ArrowLeft') cursor[0] = clamp(cursor[0] - st, 0, 1);
    else if (e.key === 'ArrowRight') cursor[0] = clamp(cursor[0] + st, 0, 1);
    else if (e.key === 'ArrowUp' && rd.land.dim === 2) cursor[1] = clamp(cursor[1] - st, 0, 1);
    else if (e.key === 'ArrowDown' && rd.land.dim === 2) cursor[1] = clamp(cursor[1] + st, 0, 1);
    else if (e.code === 'Space' || e.key === 'm' || e.key === 'M') act();
    else if (e.key === 'Enter') commit();
    else return;
    e.preventDefault();
  };

  const norm = (v: number) => (v - rd.lo) / (rd.hi - rd.lo);
  const plotY = (v: number) => (v - (rd.lo - pad * (rd.hi - rd.lo))) / ((1 + pad + 0.08) * (rd.hi - rd.lo));

  function heatmap() {
    const n = 96;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const x = cv.getContext('2d')!;
    const img = x.createImageData(n, n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const v = clamp(norm(fOf(rd.land, [(i + 0.5) / n, (j + 0.5) / n])), 0, 1);
        const o = (j * n + i) * 4;
        img.data[o] = 20 + 200 * v;
        img.data[o + 1] = 30 + 150 * (1 - Math.abs(v - 0.5) * 2) * 0.6 + 60 * v;
        img.data[o + 2] = 60 + 140 * (1 - v);
        img.data[o + 3] = 255;
      }
    x.putImageData(img, 0, 0);
    return cv;
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const reveal = phase !== 'play';
    const top = 120;
    if (rd.land.dim === 1) {
      geo = { x: 40, y: top, w: W - 80, h: Math.min(260, H - top - 130) };
      plate(c, geo.x - 12, geo.y - 12, geo.w + 24, geo.h + 30, 8);
      const Y = (v: number) => geo.y + geo.h - clamp(plotY(v), -0.05, 1.05) * geo.h;
      const X = (x: number) => geo.x + x * geo.w;
      if (reveal) {
        c.strokeStyle = alpha(pal.ink, 0.7);
        c.lineWidth = 1.5;
        c.beginPath();
        for (let i = 0; i <= 400; i++) {
          const x = i / 400;
          i ? c.lineTo(X(x), Y(fOf(rd.land, [x]))) : c.moveTo(X(x), Y(fOf(rd.land, [x])));
        }
        c.stroke();
        for (const m of minima(rd.land).mins.slice(1)) text(c, 'local', X(m.p[0]), Y(m.v) + 16, font.mono(9, 500), pal.ink3, 'center');
        c.fillStyle = pal.accent;
        c.beginPath();
        c.arc(X(rd.best[0]), Y(rd.fBest), 6, 0, Math.PI * 2);
        c.fill();
        text(c, 'global', X(rd.best[0]), Y(rd.fBest) + 18, font.mono(10, 600), pal.accent, 'center');
      }
      // Reach band.
      if (walking() && !reveal) {
        c.fillStyle = alpha(pal.accent, 0.06);
        c.fillRect(X(Math.max(0, probe[0] - rd.reach!)), geo.y, (Math.min(1, probe[0] + rd.reach!) - Math.max(0, probe[0] - rd.reach!)) * geo.w, geo.h);
      }
      // Measurements: height dots (with noise bars), slope ticks.
      if (walking() && meas.length > 1) {
        c.strokeStyle = alpha(AMBER, 0.5);
        c.setLineDash([3, 3]);
        c.beginPath();
        meas.forEach((m, i) => {
          const yy = rd.kind === 'flat' ? geo.y + geo.h + 4 : Y(m.v);
          i ? c.lineTo(X(m.p[0]), yy) : c.moveTo(X(m.p[0]), yy);
        });
        c.stroke();
        c.setLineDash([]);
      }
      meas.forEach((m, i) => {
        const x = X(m.p[0]);
        const showH = rd.kind !== 'flat';
        const y = showH ? Y(m.v) : geo.y + geo.h + 4;
        if (rd.noise) {
          c.fillStyle = alpha(AMBER, 0.25);
          c.fillRect(x - 1, Y(m.v + rd.noise), 2, Y(m.v - rd.noise) - Y(m.v + rd.noise));
        }
        c.beginPath();
        c.arc(x, y, i === meas.length - 1 ? 5 : 3.5, 0, Math.PI * 2);
        c.fillStyle = AMBER;
        c.fill();
        if (m.s !== undefined && walking()) {
          // Slope as a short tangent (and a number on the plateau, where it matters).
          const sl = m.s;
          const ang = Math.atan2(-sl * (geo.h / (rd.hi - rd.lo)) * 0.02, geo.w * 0.02);
          const L = 20;
          const yy = showH ? y : geo.y + geo.h - 30;
          c.strokeStyle = pal.ink2;
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(x - Math.cos(ang) * L, yy - Math.sin(ang) * L);
          c.lineTo(x + Math.cos(ang) * L, yy + Math.sin(ang) * L);
          c.stroke();
          if (rd.kind === 'flat') text(c, `${sl >= 0 ? '+' : '−'}${Math.abs(sl).toFixed(3)}`, x, yy - 12, font.mono(9, 500), pal.ink2, 'center');
        }
      });
      // Probe and cursor.
      if (walking()) {
        c.fillStyle = pal.accent;
        c.fillRect(X(probe[0]) - 1, geo.y, 2, geo.h);
      }
      if (!reveal) {
        c.strokeStyle = alpha(pal.ink, 0.6);
        c.setLineDash([2, 3]);
        c.beginPath();
        c.moveTo(X(cursor[0]), geo.y);
        c.lineTo(X(cursor[0]), geo.y + geo.h);
        c.stroke();
        c.setLineDash([]);
      }
      if (committed) {
        c.fillStyle = AMBER;
        c.fillRect(X(committed[0]) - 1.5, geo.y, 3, geo.h);
      }
    } else {
      const side = Math.min(H - top - 120, W - 80, 420);
      geo = { x: W / 2 - side / 2, y: top, w: side, h: side };
      plate(c, geo.x - 10, geo.y - 10, side + 20, side + 20, 8);
      if (reveal) {
        heat ??= heatmap();
        c.drawImage(heat, geo.x, geo.y, side, side);
        c.beginPath();
        c.arc(geo.x + rd.best[0] * side, geo.y + rd.best[1] * side, 8, 0, Math.PI * 2);
        c.strokeStyle = pal.accent;
        c.lineWidth = 2.5;
        c.stroke();
      } else {
        c.strokeStyle = pal.line2;
        for (let i = 1; i < 10; i++) {
          c.beginPath();
          c.moveTo(geo.x + (i / 10) * side, geo.y);
          c.lineTo(geo.x + (i / 10) * side, geo.y + side);
          c.moveTo(geo.x, geo.y + (i / 10) * side);
          c.lineTo(geo.x + side, geo.y + (i / 10) * side);
          c.stroke();
        }
      }
      meas.forEach((m) => {
        const v = clamp(plotY(m.v), 0, 1);
        const x = geo.x + m.p[0] * side;
        const y = geo.y + m.p[1] * side;
        c.beginPath();
        c.arc(x, y, 14, 0, Math.PI * 2);
        c.fillStyle = `rgba(${Math.round(20 + 200 * v)},${Math.round(80 + 60 * v)},${Math.round(60 + 140 * (1 - v))},0.9)`;
        c.fill();
        // Raw heights, in the landscape's own units — comparable with each other, not with an unknown floor.
        text(c, (m.v * 100).toFixed(0), x, y + 1, font.mono(9, 600), pal.ink, 'center', 'middle');
      });
      if (!reveal) {
        const x = geo.x + cursor[0] * side;
        const y = geo.y + cursor[1] * side;
        c.strokeStyle = pal.ink;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x - 10, y);
        c.lineTo(x + 10, y);
        c.moveTo(x, y - 10);
        c.lineTo(x, y + 10);
        c.stroke();
      }
      if (committed) {
        c.beginPath();
        c.arc(geo.x + committed[0] * side, geo.y + committed[1] * side, 6, 0, Math.PI * 2);
        c.fillStyle = AMBER;
        c.fill();
      }
      text(c, 'readings are heights: lower is better', geo.x, geo.y + side + 22, font.mono(9, 500), pal.ink3);
    }
    if (!reveal) {
      const by = geo.y + geo.h + (rd.land.dim === 1 ? 34 : 40);
      const left = rd.budget - used();
      bench.button(c, W / 2 - 170, by, 160, 42, `${walking() ? 'Step' : 'Measure'} · ${left} left`, act, { key: 'M', off: left <= 0 });
      bench.button(c, W / 2 + 10, by, 160, 42, walking() ? 'Commit here' : 'Commit at cursor', commit, { primary: true, key: 'Enter' });
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
