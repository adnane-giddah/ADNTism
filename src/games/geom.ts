// Plane geometry for Area, Intersection, Rotate and Length: exact polygon areas, convex clipping, circle
// lens areas, arc lengths with explicit tolerances. Everything here is pure and unit-tested.
import type { Pt } from './kit';

export const P = (x: number, y: number): Pt => ({ x, y });

/** Signed shoelace area (positive when counter-clockwise in a y-up frame). */
export function signedArea(p: Pt[]) {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y;
  return s / 2;
}
export const polyArea = (p: Pt[]) => Math.abs(signedArea(p));

export function centroid(p: Pt[]) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j].x * p[i].y - p[i].x * p[j].y;
    a += f;
    cx += (p[j].x + p[i].x) * f;
    cy += (p[j].y + p[i].y) * f;
  }
  if (Math.abs(a) < 1e-12) return P(p.reduce((s, q) => s + q.x, 0) / p.length, p.reduce((s, q) => s + q.y, 0) / p.length);
  return P(cx / (3 * a), cy / (3 * a));
}

export const rotate = (p: Pt[], a: number, c: Pt = P(0, 0)) => {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return p.map((q) => P(c.x + (q.x - c.x) * cs - (q.y - c.y) * sn, c.y + (q.x - c.x) * sn + (q.y - c.y) * cs));
};
export const translate = (p: Pt[], dx: number, dy: number) => p.map((q) => P(q.x + dx, q.y + dy));
export const scale = (p: Pt[], k: number) => p.map((q) => P(q.x * k, q.y * k));
export const mirrorX = (p: Pt[]) => p.map((q) => P(-q.x, q.y)).reverse();

export function bbox(p: Pt[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Regular n-gon of circumradius R. Area n R² sin(2π/n) / 2. */
export const regular = (n: number, R: number, rot = 0) => Array.from({ length: n }, (_, i) => P(R * Math.cos(rot + (i * 2 * Math.PI) / n), R * Math.sin(rot + (i * 2 * Math.PI) / n)));
/** Ellipse outline (drawing and clipping only — its area is πab, not the polygon's). */
export const ellipsePts = (cx: number, cy: number, a: number, b: number, rot = 0, n = 360) =>
  rotate(Array.from({ length: n }, (_, i) => P(a * Math.cos((i * 2 * Math.PI) / n), b * Math.sin((i * 2 * Math.PI) / n))), rot).map((q) => P(q.x + cx, q.y + cy));

export function isConvex(p: Pt[]) {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = p[(i + 2) % p.length];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/**
 * Sutherland–Hodgman: `subject` (any simple polygon) clipped by a CONVEX `clip`. For a concave subject the
 * result may contain zero-width bridges along the clip boundary; they add no area.
 */
export function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const s = signedArea(clip) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (q: Pt) => s * ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x));
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const cur = inp[j];
      const prev = inp[(j + inp.length - 1) % inp.length];
      const sc = side(cur);
      const sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) out.push(cut(prev, cur, sp, sc));
        out.push(cur);
      } else if (sp >= 0) out.push(cut(prev, cur, sp, sc));
    }
  }
  return out;
}
const cut = (p: Pt, q: Pt, sp: number, sq: number) => {
  const t = sp / (sp - sq);
  return P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
};

/** Area of overlap of two circles (exact). Handles separate, tangent, partial and contained. */
export function lensArea(r1: number, r2: number, d: number) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

export function pointInPoly(q: Pt, p: Pt[]) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > q.y !== p[j].y > q.y && q.x < ((p[j].x - p[i].x) * (q.y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
  }
  return inside;
}

export function segDist(q: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L)) : 0;
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
}

/** Distance from q to a polygon's boundary (0 on it). */
export function polyEdgeDist(q: Pt, p: Pt[]) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segDist(q, p[j], p[i]));
  return d;
}

/**
 * Adaptive Simpson quadrature with an absolute tolerance. Used for arc lengths where no closed form exists;
 * the integrands here are smooth, so the Richardson-corrected estimate meets `eps` comfortably.
 */
export function integrate(f: (t: number) => number, a: number, b: number, eps = 1e-10) {
  const simpson = (a: number, b: number, fa: number, fm: number, fb: number) => ((b - a) / 6) * (fa + 4 * fm + fb);
  const rec = (a: number, b: number, fa: number, fm: number, fb: number, whole: number, eps: number, depth: number): number => {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(a, m, fa, flm, fm);
    const right = simpson(m, b, fm, frm, fb);
    const delta = left + right - whole;
    if (depth <= 0 || Math.abs(delta) <= 15 * eps) return left + right + delta / 15;
    return rec(a, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b, fm, frm, fb, right, eps / 2, depth - 1);
  };
  // Split first so periodic integrands cannot fool the first estimate.
  const n = 16;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x0 = a + ((b - a) * i) / n;
    const x1 = a + ((b - a) * (i + 1)) / n;
    const fa = f(x0);
    const fb = f(x1);
    const fm = f((x0 + x1) / 2);
    s += rec(x0, x1, fa, fm, fb, simpson(x0, x1, fa, fm, fb), eps / n, 40);
  }
  return s;
}

export const polylineLength = (p: Pt[]) => {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return s;
};
