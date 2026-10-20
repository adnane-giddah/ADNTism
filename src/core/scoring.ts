// Pure measurement functions. No DOM, no randomness: every game's score is computed here
// so it can be unit-tested and audited independently of rendering and input handling.

export type V = { x: number; y: number };

/** True for a usable score: a finite, non-negative number. */
export const validScore = (s: number) => Number.isFinite(s) && s >= 0;

// ── Angles ────────────────────────────────────────────────────────────────────

/** Signed shortest difference a − b in degrees, in (−180, 180]. Positive = clockwise of b. */
export function angleDiff(a: number, b: number) {
  const d = ((((a - b) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

// ── Zero ──────────────────────────────────────────────────────────────────────

/** Running signed total of holds (seconds). */
export const signedTotal = (durations: number[], signs: number[]) =>
  durations.reduce((a, d, i) => a + signs[i] * d, 0);

// ── Close the Loop ────────────────────────────────────────────────────────────

export interface PadTransform {
  scale: number;
  rot: number; // radians, pad turned clockwise by this
  mirror: boolean;
}

/** A vector drawn on the pad, as it lands in the field: un-mirror, rotate back, scale. */
export function padToField(v0: V, t: PadTransform): V {
  const v = t.mirror ? { x: -v0.x, y: v0.y } : v0;
  const c = Math.cos(-t.rot);
  const s = Math.sin(-t.rot);
  return { x: (v.x * c - v.y * s) * t.scale, y: (v.x * s + v.y * c) * t.scale };
}

/** The pad vector that would close the loop exactly (inverse of padToField). */
export function fieldToPad(f: V, t: PadTransform): V {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  const v = { x: (f.x * c - f.y * s) / t.scale, y: (f.x * s + f.y * c) / t.scale };
  return t.mirror ? { x: -v.x, y: v.y } : v;
}

/** Distance from the tip of the closing arrow to home. */
export function closureGap(end: V, home: V, arrow: V) {
  return Math.hypot(end.x + arrow.x - home.x, end.y + arrow.y - home.y);
}

// ── Draw ──────────────────────────────────────────────────────────────────────

/** How many of `bins` equal angular sectors around `c` the stroke visits (0..1). */
export function angularCoverage(pts: V[], c: V, bins = 72) {
  if (pts.length < 2) return 0;
  const hit = new Uint8Array(bins);
  for (let i = 1; i < pts.length; i++) {
    // Interpolate so fast strokes don't skip sectors.
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n - c.x;
      const y = a.y + ((b.y - a.y) * k) / n - c.y;
      const ang = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
      hit[Math.min(bins - 1, Math.floor((ang / (2 * Math.PI)) * bins))] = 1;
    }
  }
  return hit.reduce((a, b) => a + b, 0) / bins;
}

/** Length-weighted RMS of signed distances; `dist(p)` gives the signed distance of a point. */
export function weightedRms(pts: V[], dist: (p: V) => number) {
  let w = 0;
  let e2 = 0;
  let e1 = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const e = dist({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    w += len;
    e2 += len * e * e;
    e1 += len * e;
  }
  if (w === 0) return { rms: NaN, mean: NaN, length: 0 };
  return { rms: Math.sqrt(e2 / w), mean: e1 / w, length: w };
}

/** Signed perpendicular distance from p to the infinite line through a→b (left of a→b is negative in screen coords). */
export function lineDistance(p: V, a: V, b: V) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / L;
}

/** Projection parameter of p onto a→b: 0 at a, 1 at b. */
export function lineParam(p: V, a: V, b: V) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
}

// ── Stop ──────────────────────────────────────────────────────────────────────

/** Distance needed to stop from speed v at constant deceleration A. */
export const stoppingDistance = (v: number, A: number) => (v * v) / (2 * A);

/** Where the mass "would have stopped" after hitting the wall at speed vWall. */
export const virtualStop = (wall: number, vWall: number, A: number) => wall + stoppingDistance(vWall, A);

// ── Balance ───────────────────────────────────────────────────────────────────

/** The balance point lies at least this far from the pivot, so the relative score is well defined. */
export const BALANCE_MIN_X = 18;
export const BALANCE_MAX_X = 94;

export const balancePoint = (blocks: { m: number; d: number }[]) => blocks.reduce((a, q) => a + q.m * q.d, 0);

/** Residual imbalance in % of the hidden torque. Requires x* ≥ BALANCE_MIN_X (enforced by the generator). */
export function balanceError(x: number, xStar: number) {
  if (!(xStar >= BALANCE_MIN_X)) return NaN;
  return (Math.abs(x - xStar) / xStar) * 100;
}

// ── Echo ──────────────────────────────────────────────────────────────────────

export function echoErrors(taps: number[], gaps: number[]) {
  const mine = taps.slice(1).map((t, i) => t - taps[i]);
  const errs = mine.map((g, i) => g - gaps[i]);
  const mean = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
  const totalT = gaps.reduce((a, b) => a + b, 0);
  const totalM = mine.reduce((a, b) => a + b, 0);
  const k = totalM > 0 ? totalT / totalM : NaN;
  // Shape error forgives a uniformly faster or slower tempo.
  const shape = mine.reduce((a, g, i) => a + Math.abs(g * k - gaps[i]), 0) / mine.length;
  const tempo = (totalM / totalT - 1) * 100;
  return { mine, errs, mean, shape, tempo };
}

// ── Center ────────────────────────────────────────────────────────────────────

export function weightedCentroid(pts: V[], w: number[]) {
  const m = pts.reduce((a, _, i) => a + w[i], 0);
  return {
    x: pts.reduce((a, p, i) => a + p.x * w[i], 0) / m,
    y: pts.reduce((a, p, i) => a + p.y * w[i], 0) / m,
  };
}

/** Where the last point must go so the weighted centroid of all points equals T. */
export function idealLastPoint(earlier: V[], w: number[], T: V): V {
  const total = w.reduce((a, b) => a + b, 0);
  const wl = w[w.length - 1];
  const rest = earlier.reduce((a, p, i) => ({ x: a.x + p.x * w[i], y: a.y + p.y * w[i] }), { x: 0, y: 0 });
  return { x: (total * T.x - rest.x) / wl, y: (total * T.y - rest.y) / wl };
}

// ── Robust statistics ─────────────────────────────────────────────────────────

export function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation — spread in the score's own unit, robust to one wild run. */
export function mad(a: number[]) {
  const m = median(a);
  return median(a.map((v) => Math.abs(v - m)));
}

// ── Seeds ─────────────────────────────────────────────────────────────────────

/** Full 32-bit seed as a short, URL-safe, case-insensitive string. */
export const seedToString = (seed: number) => (seed >>> 0).toString(36).toUpperCase();

/** Parse a seed from a URL. Accepts base-36 (as shown in the UI). Returns null if invalid. */
export function parseSeed(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!/^[0-9a-zA-Z]{1,7}$/.test(t)) return null;
  const n = parseInt(t, 36);
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
  return n >>> 0;
}

// ── Shared precision helpers (Phaseshift, False Beat, Intersect, Perception, Afterimage) ──────

/** Unsigned shortest angular distance in degrees, in [0, 180]. Correct across 0°/360°. */
export const circularError = (a: number, b: number) => Math.abs(angleDiff(a, b));

/** Relative error |v − ref| / |ref| (a fraction). `ref` must be non-zero. */
export const relError = (v: number, ref: number) => Math.abs(v - ref) / Math.abs(ref);

/** Illustrative 0..100 accuracy: 100 at zero error, 0 at (or beyond) the tolerance. */
export const accuracyPct = (err: number, tol: number) => 100 * Math.max(0, 1 - err / tol);

// ── Phaseshift ────────────────────────────────────────────────────────────────

/** A circular oscillator: θ(t) = θ0 + ω·t, θ in degrees, ω in degrees per second, t in seconds. */
export interface Osc {
  theta0: number;
  omega: number;
}
export const oscAngle = (o: Osc, t: number) => o.theta0 + o.omega * t;

/** Signed relative phase of b against a at time t, in (−180, 180]. Positive = b leads (clockwise). */
export const relPhase = (a: Osc, b: Osc, t: number) => angleDiff(oscAngle(b, t), oscAngle(a, t));

/**
 * The worst phase gap over an observation window: max |wrap(d0 + dω·τ)| for τ ∈ [0, W].
 * d0 is the signed gap (°) at the start, dω the frequency mismatch (°/s). A frequency error turns into
 * a growing phase error, so one number in degrees covers both — and a lucky momentary overlap with
 * the wrong frequency cannot score well.
 */
export function syncError(d0: number, dOmega: number, W: number) {
  const a = d0;
  const b = d0 + dOmega * W;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // If the sweep crosses an odd multiple of 180°, the gap reached the opposite side at some moment.
  const k = Math.ceil((lo - 180) / 360);
  if (180 + 360 * k <= hi) return 180;
  // Otherwise |wrap| is |x − 360m| for one fixed m: convex, so its maximum is at an end of the window.
  return Math.max(Math.abs(angleDiff(a, 0)), Math.abs(angleDiff(b, 0)));
}

// ── False Beat ────────────────────────────────────────────────────────────────

/** Time of beat n (ms), counting from beat 0 at `start` (ms). */
export const beatTime = (start: number, n: number, bpm: number) => start + (n * 60000) / bpm;

/** When a linear mover x(t) = x0 + v·(t − t0)/1000 reaches xT (ms). v in units per second, non-zero. */
export const crossingTime = (x0: number, v: number, xT: number, t0: number) => t0 + ((xT - x0) / v) * 1000;

/** Signed tap error in ms (positive = late), after removing a calibrated systematic offset. */
export const tapError = (tap: number, ideal: number, offset = 0) => tap - offset - ideal;

/**
 * Systematic latency from a tap-along: the median signed error, but only if the taps were steady enough
 * to trust (at least 5 taps, spread ≤ 45 ms). Returns null when the estimate would be noise.
 */
export function latencyEstimate(errs: number[]) {
  if (errs.length < 5) return null;
  const m = median(errs);
  const spread = mad(errs);
  if (!Number.isFinite(m) || spread > 45 || Math.abs(m) > 300) return null;
  return { offset: m, spread };
}

// ── Intersect ─────────────────────────────────────────────────────────────────

export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
export const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest approach of two linear movers pa(t) = a0 + va·t and pb(t) = b0 + vb·t over t ∈ [0, T] (s). */
export function closestApproach(a0: V, va: V, b0: V, vb: V, T: number) {
  const dp = sub(b0, a0);
  const dv = sub(vb, va);
  const vv = dv.x * dv.x + dv.y * dv.y;
  const t = vv < 1e-12 ? 0 : Math.min(T, Math.max(0, -(dp.x * dv.x + dp.y * dv.y) / vv));
  return { t, d: Math.hypot(dp.x + dv.x * t, dp.y + dv.y * t) };
}

/**
 * Interception from a launcher L with speed s (u/s) and heading θ (radians, screen coordinates), against a
 * target point P that the other object passes at time tA (s).
 *   miss    — where B is when A passes P: |pB(tA) − P| (u). Zero iff they meet at P at the right time.
 *   spatial — how far B's path passes from P (u): the direction error alone.
 *   timing  — when B is closest to P, minus tA (s): the speed error alone. Positive = B late.
 */
export function interceptErrors(L: V, s: number, theta: number, P: V, tA: number) {
  const d = { x: Math.cos(theta), y: Math.sin(theta) };
  const rel = sub(P, L);
  const along = rel.x * d.x + rel.y * d.y;
  const spatial = Math.abs(rel.x * d.y - rel.y * d.x);
  const tClosest = along > 0 && s > 0 ? along / s : Infinity;
  const pB = add(L, scale(d, s * tA));
  return { miss: dist(pB, P), spatial, timing: tClosest - tA, pB, along };
}

/** The launch that meets A at P exactly at tA. */
export const idealLaunch = (L: V, P: V, tA: number) => ({ s: dist(L, P) / tA, theta: Math.atan2(P.y - L.y, P.x - L.x) });

// ── Perception / Afterimage ───────────────────────────────────────────────────

/**
 * Bias of repeated signed errors. A bias is only called systematic with at least 8 samples and a mean
 * more than two standard errors from zero — one or two attempts never establish a stable bias.
 */
export function biasSummary(errs: number[]) {
  const n = errs.length;
  if (!n) return { n, mean: NaN, sd: NaN, se: NaN, systematic: false };
  const mean = errs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(errs.reduce((a, e) => a + (e - mean) ** 2, 0) / (n - 1)) : NaN;
  const se = n > 1 ? sd / Math.sqrt(n) : NaN;
  return { n, mean, sd, se, systematic: n >= 8 && Number.isFinite(se) && Math.abs(mean) > 2 * se };
}

/** Phase error expressed as a fraction of a full cycle (0..0.5), so it can sit next to relative errors. */
export const phaseFraction = (a: number, b: number) => circularError(a, b) / 360;

// ── Pour ──────────────────────────────────────────────────────────────────────

/**
 * Cumulative area of a flat tank of width w(y) for y = 0 (bottom) … H, sampled in N slices (trapezoids).
 * The tank is flat (uniform depth), so volume is area.
 */
export function pourTable(width: (y: number) => number, H: number, N = 600) {
  const ys = new Float64Array(N + 1);
  const A = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) ys[i] = (H * i) / N;
  for (let i = 1; i <= N; i++) A[i] = A[i - 1] + ((width(ys[i - 1]) + width(ys[i])) / 2) * (H / N);
  return { ys, A, total: A[N], H };
}

/** Liquid height for a volume V (inverse of the cumulative area; linear inside a slice). */
export function levelFor(tab: ReturnType<typeof pourTable>, V: number) {
  const { ys, A } = tab;
  if (V <= 0) return 0;
  if (V >= tab.total) return tab.H;
  let lo = 0;
  let hi = A.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (A[m] < V) lo = m;
    else hi = m;
  }
  return ys[lo] + ((V - A[lo]) / (A[hi] - A[lo])) * (ys[hi] - ys[lo]);
}

/** Fill error in percentage points of capacity. */
export const fillError = (V: number, total: number, f: number) => Math.abs(V / total - f) * 100;

// ── Shadow ────────────────────────────────────────────────────────────────────

/**
 * Tracking error on a fixed time grid: at every step the cursor is where its most recent sample put it
 * (samples sorted by time), and the error is its distance to the target at that moment. Frame rate and
 * event rate cannot change the result, only the actual cursor positions over time can.
 */
export function trackingRms(samples: { t: number; x: number; y: number }[], target: (t: number) => V, t0: number, t1: number, dt = 1 / 120) {
  if (!samples.length || !(t1 > t0)) return { rms: NaN, mean: NaN, series: [] as number[] };
  let j = 0;
  let e2 = 0;
  let e1 = 0;
  let n = 0;
  const series: number[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    while (j + 1 < samples.length && samples[j + 1].t <= t) j++;
    const s = samples[j];
    const p = target(t);
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    e2 += d * d;
    e1 += d;
    n++;
    series.push(d);
  }
  return { rms: Math.sqrt(e2 / n), mean: e1 / n, series };
}

// ── Mirror ────────────────────────────────────────────────────────────────────

/** Reflection of p across the infinite line through a and b. */
export function reflect(p: V, a: V, b: V): V {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

// ── Vessels of revolution (Halfway Is a Lie) ──────────────────────────────────

/** Cumulative volume of a round vessel with radius r(y): V(h) = ∫₀ʰ π·r(y)² dy. Same table format as pourTable. */
export const revolveTable = (radius: (y: number) => number, H: number, N = 800) => pourTable((y) => Math.PI * radius(y) ** 2, H, N);

/** Volume below height h (linear inside a slice; inverse of levelFor). */
export function volumeAt(tab: ReturnType<typeof pourTable>, h: number) {
  const { ys, A } = tab;
  if (h <= 0) return 0;
  if (h >= tab.H) return tab.total;
  const i = Math.min(ys.length - 2, Math.floor((h / tab.H) * (ys.length - 1)));
  return A[i] + ((h - ys[i]) / (ys[i + 1] - ys[i])) * (A[i + 1] - A[i]);
}

// ── Connected vessels (Communicating Vessels, Valve Engineer) ─────────────────

export interface Tank {
  /** Cross-section area table, from the bottom (y = 0) to the rim. */
  tab: ReturnType<typeof pourTable>;
  /** Height of the tank's floor above the common datum (0 for vessels standing side by side). */
  floor: number;
}

/** Free-surface height (above the datum) of a tank holding volume V. */
export const surfaceOf = (t: Tank, V: number) => t.floor + levelFor(t.tab, V);

/** Volume a tank holds when its free surface is at height s (clamped to floor … rim). */
export const volumeBelow = (t: Tank, s: number) => volumeAt(t.tab, s - t.floor);

/**
 * Hydrostatic equilibrium of tanks joined at the bottom: one common surface height s such that the
 * total volume is conserved. If that surface would rise above the lowest rim, the lowest tank overflows:
 * the surface settles at its rim and the excess is lost. Volumes are generally NOT equal — heights are.
 */
export function equilibrium(tanks: Tank[], volumes: number[]) {
  const total = volumes.reduce((a, b) => a + b, 0);
  const rim = Math.min(...tanks.map((t) => t.floor + t.tab.H));
  const lowFloor = Math.min(...tanks.map((t) => t.floor));
  const held = (s: number) => tanks.reduce((a, t) => a + volumeBelow(t, s), 0);
  if (held(rim) <= total) {
    return { surface: rim, volumes: tanks.map((t) => volumeBelow(t, rim)), overflow: total - held(rim) };
  }
  let lo = lowFloor;
  let hi = rim;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (held(m) < total) lo = m;
    else hi = m;
  }
  const s = (lo + hi) / 2;
  return { surface: s, volumes: tanks.map((t) => volumeBelow(t, s)), overflow: 0 };
}

/**
 * One fixed step of pipe flow between tanks. Each open pipe (a, b, k) moves k·(sa − sb)·dt from the higher
 * surface to the lower one, limited so it can never overshoot equilibrium or empty a tank. A tank filled past
 * its rim spills the excess (returned as `spilled`). Liquid is conserved exactly: moved + spilled.
 */
export function flowStep(tanks: Tank[], V: number[], pipes: { a: number; b: number; k: number; open: boolean }[], dt: number) {
  const next = V.slice();
  for (const p of pipes) {
    if (!p.open) continue;
    const sa = surfaceOf(tanks[p.a], next[p.a]);
    const sb = surfaceOf(tanks[p.b], next[p.b]);
    // A pipe at the bottom: liquid only flows if the source holds some, and toward the lower surface.
    let q = p.k * (sa - sb) * dt;
    if (q > 0) q = Math.min(q, next[p.a], equalizeLimit(tanks, next, p.a, p.b));
    else if (q < 0) q = -Math.min(-q, next[p.b], equalizeLimit(tanks, next, p.b, p.a));
    next[p.a] -= q;
    next[p.b] += q;
  }
  let spilled = 0;
  next.forEach((v, i) => {
    const cap = tanks[i].tab.total;
    if (v > cap) {
      spilled += v - cap;
      next[i] = cap;
    }
    if (next[i] < 0) next[i] = 0;
  });
  return { V: next, spilled };
}

/** Largest transfer from `from` to `to` that does not push `to` above `from` (the two-tank equilibrium). */
function equalizeLimit(tanks: Tank[], V: number[], from: number, to: number) {
  // What `from` can give before the pair reaches equilibrium (if the pair overflows, `to` spills the excess).
  const eq = equilibrium([tanks[from], tanks[to]], [V[from], V[to]]);
  return Math.max(0, V[from] - eq.volumes[0]);
}

/** Uniform-section tank (a box of floor area `area` and height H). */
export const boxTank = (area: number, H: number, floor = 0): Tank => ({ tab: pourTable(() => area, H, 200), floor });
