// Subtle realism and the instrument kit: liquid with depth, glass with thickness, soft contact shadows,
// shaded solids, dial faces, tapered needles, knobs, recessed slots, plates, glows, trails and ripples.
// Purely presentational — every helper draws what the simulation already decided, and none of them may add
// information a measurement depends on (no extra ticks or guides; sized objects keep their exact radius).
// Colours come from the theme tokens, so dark mode and contrast follow.
import { pal } from './draw';

type C = CanvasRenderingContext2D;

/** Fill a liquid body (outline traced by `trace`) with a gentle top-to-bottom depth gradient. */
export function liquidBody(c: C, trace: (c: C) => void, yTop: number, yBottom: number) {
  c.save();
  c.beginPath();
  trace(c);
  c.closePath();
  const g = c.createLinearGradient(0, yTop, 0, Math.max(yTop + 1, yBottom));
  g.addColorStop(0, pal.liquid);
  g.addColorStop(1, pal.liquidDeep);
  c.fillStyle = g;
  c.fill();
  c.restore();
}

/** The free surface: a crisp line with a faint highlight just under it (a meniscus hint). */
export function liquidSurface(c: C, x0: number, x1: number, y: number) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = pal.liquidDeep;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x0 + 1, y);
  c.lineTo(x1 - 1, y);
  c.stroke();
  c.strokeStyle = pal.glass;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0 + 3, y + 2.5);
  c.lineTo(x1 - 3, y + 2.5);
  c.stroke();
  c.restore();
}

/**
 * A glass wall along a polyline: the ink edge plus a thin highlight a little inside, which reads as wall
 * thickness. `inward` is the side (+1 / −1 in x) the highlight sits on.
 */
export function glassWall(c: C, pts: { x: number; y: number }[], inward: number, w = 2) {
  if (pts.length < 2) return;
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = pal.ink;
  c.lineWidth = w;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.stroke();
  c.strokeStyle = pal.glass;
  c.lineWidth = 1.5;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p.x + inward * 3, p.y) : c.moveTo(p.x + inward * 3, p.y)));
  c.stroke();
  c.restore();
}

/** A soft elliptical contact shadow under an object. */
export function softShadow(c: C, x: number, y: number, rx: number, ry = rx * 0.28, strength = 1) {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, pal.shade);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha *= strength;
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** A solid block: rounded body, light from above, a darker base — reads as a weighted object. */
export function solidBlock(c: C, x: number, y: number, w: number, h: number, color = pal.ink) {
  c.save();
  rr(c, x, y, w, h, Math.min(3, w / 6, h / 6));
  c.fillStyle = color;
  c.fill();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  c.fillStyle = g;
  c.fill();
  c.fillStyle = pal.glass;
  c.globalAlpha = 0.5;
  c.fillRect(x + 2, y + 1, Math.max(0, w - 4), Math.max(1, Math.min(3, h * 0.14)));
  c.restore();
}

/** A sphere: shaded body (light from the upper left), a soft core shadow and a specular highlight. */
export function sphere(c: C, x: number, y: number, r: number, color = pal.ink) {
  c.save();
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  const d = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.15, x, y, r);
  d.addColorStop(0, 'rgba(0,0,0,0)');
  d.addColorStop(1, 'rgba(0,0,0,0.3)');
  c.fillStyle = d;
  c.fill();
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.35, y - r * 0.4, r * 0.9);
  g.addColorStop(0, pal.glass);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fill();
  // A cool rim light on the lower right, as if lit by the lab's cyan instruments.
  if (r >= 6) {
    c.beginPath();
    c.arc(x, y, r - 0.6, -0.15, Math.PI * 0.75);
    c.strokeStyle = alpha(pal.accent, 0.35);
    c.lineWidth = Math.min(2, r * 0.12);
    c.stroke();
  }
  c.restore();
}

// ── Instrument kit: shared shapes so every experiment speaks the same visual language ───────────────

type RGBA = [number, number, number, number];
const rgbaCache = new Map<string, RGBA>();
let probe: CanvasRenderingContext2D | null | undefined;
/** Any CSS colour → [r, g, b, a] (cached). Theme colours change by name, so the cache stays valid. */
export function rgbaOf(color: string): RGBA {
  const hit = rgbaCache.get(color);
  if (hit) return hit;
  if (probe === undefined) probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  let v: RGBA = [0, 0, 0, 1];
  if (probe) {
    probe.fillStyle = '#000';
    probe.fillStyle = color;
    const s = String(probe.fillStyle);
    if (s[0] === '#') {
      const n = parseInt(s.slice(1, 7), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    } else {
      const m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) v = [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1];
    }
  }
  rgbaCache.set(color, v);
  return v;
}
/** The same colour at k × its opacity. */
export function alpha(color: string, k: number) {
  const [r, g, b, a] = rgbaOf(color);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a * k))})`;
}

/** A rounded-rectangle path. */
export function rr(c: C, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

/** A soft radial glow in `color` — live points, targets, cursors. */
export function glow(c: C, x: number, y: number, r: number, color: string, strength = 1) {
  if (!(r > 0)) return;
  c.save();
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, 0.5 * strength));
  g.addColorStop(0.4, alpha(color, 0.16 * strength));
  g.addColorStop(1, alpha(color, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
}

/** A draggable handle: contact shadow, a shaded body and a fine rim; `active` adds a halo. */
export function knob(c: C, x: number, y: number, r: number, color = pal.ink, active = false) {
  if (active) glow(c, x, y, r * 3.2, color, 0.9);
  softShadow(c, x, y + r * 0.6, r * 1.15, r * 0.38, 1.3);
  sphere(c, x, y, r, color);
  c.save();
  c.beginPath();
  c.arc(x, y, r - 0.5, 0, Math.PI * 2);
  c.strokeStyle = alpha(pal.paper, 0.35);
  c.lineWidth = 1;
  c.stroke();
  c.restore();
}

/** An instrument face: a soft drop shadow, a gently lit disc and a fine inner bezel. Draw it first. */
export function dialFace(c: C, x: number, y: number, r: number) {
  c.save();
  const sh = c.createRadialGradient(x, y + r * 0.04, r * 0.92, x, y + r * 0.04, r * 1.1);
  sh.addColorStop(0, pal.shade);
  sh.addColorStop(1, alpha(pal.shade, 0));
  c.fillStyle = sh;
  c.beginPath();
  c.arc(x, y + r * 0.04, r * 1.1, 0, Math.PI * 2);
  c.fill();
  const f = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  f.addColorStop(0, pal.paper);
  f.addColorStop(1, pal.paper2);
  c.fillStyle = f;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = pal.line2;
  c.lineWidth = 1;
  c.beginPath();
  c.arc(x, y, Math.max(1, r - 5), 0, Math.PI * 2);
  c.stroke();
  // The bezel: a thin lit rim, brightest at the top like a polished edge catching the room light.
  const b = c.createLinearGradient(x, y - r, x, y + r);
  b.addColorStop(0, alpha(pal.accent, 0.4));
  b.addColorStop(0.5, alpha(pal.ink, 0.06));
  b.addColorStop(1, alpha(pal.accent, 0.14));
  c.strokeStyle = b;
  c.lineWidth = 1.25;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

/** A tapered needle from a hub at (x, y) towards angle a (canvas radians), with a short tail and a cap. */
export function needle(c: C, x: number, y: number, a: number, len: number, color = pal.ink, w = 3, shadow = true) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const tail = Math.min(len * 0.16, 22);
  const shape = (ox: number, oy: number) => {
    c.beginPath();
    c.moveTo(x + ox + ca * len, y + oy + sa * len);
    c.lineTo(x + ox - sa * w * 0.5, y + oy + ca * w * 0.5);
    c.lineTo(x + ox - ca * tail - sa * w * 0.8, y + oy - sa * tail + ca * w * 0.8);
    c.lineTo(x + ox - ca * tail + sa * w * 0.8, y + oy - sa * tail - ca * w * 0.8);
    c.lineTo(x + ox + sa * w * 0.5, y + oy - ca * w * 0.5);
    c.closePath();
  };
  c.save();
  if (shadow) {
    shape(1.5, 2.5);
    c.fillStyle = pal.shade;
    c.fill();
  }
  shape(0, 0);
  c.fillStyle = color;
  c.fill();
  c.beginPath();
  c.arc(x, y, w * 1.7, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x, y, w * 0.6, 0, Math.PI * 2);
  c.fillStyle = pal.paper;
  c.fill();
  c.restore();
}

/** A recessed track (a slider slot or a rail): a soft channel with a lit lower lip. */
export function slot(c: C, x0: number, y0: number, x1: number, y1: number, w = 6) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = alpha(pal.ink, 0.1);
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.strokeStyle = alpha(pal.ink, 0.12);
  c.lineWidth = Math.max(1, w * 0.4);
  c.beginPath();
  c.moveTo(x0, y0 - w * 0.18);
  c.lineTo(x1, y1 - w * 0.18);
  c.stroke();
  c.strokeStyle = pal.glass;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0, y0 + w * 0.5);
  c.lineTo(x1, y1 + w * 0.5);
  c.stroke();
  c.restore();
}

/** A rounded instrument plate with a soft shadow (drawn under a group of readings). */
export function plate(c: C, x: number, y: number, w: number, h: number, r = 6, fill = pal.paper) {
  r = Math.min(r, 6);
  c.save();
  c.shadowColor = pal.shade;
  c.shadowBlur = 24;
  c.shadowOffsetY = 8;
  rr(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  c.shadowColor = 'rgba(0,0,0,0)';
  // A faint lift from the top edge, then the hairline frame and the four reticle corners.
  const g = c.createLinearGradient(0, y, 0, y + Math.min(h, 60));
  g.addColorStop(0, alpha(pal.ink, 0.045));
  g.addColorStop(1, alpha(pal.ink, 0));
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = pal.line2;
  c.lineWidth = 1;
  c.stroke();
  if (w > 60 && h > 40) reticle(c, x + 5, y + 5, w - 10, h - 10, 7, alpha(pal.accent, 0.45));
  c.restore();
}

/** Four crisp 90° corner marks around a box — the optical test-bench frame. */
export function reticle(c: C, x: number, y: number, w: number, h: number, s = 10, color = alpha(pal.ink, 0.38)) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.beginPath();
  const o = (v: number) => Math.round(v) + 0.5;
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    c.moveTo(o(cx + dx * s), o(cy));
    c.lineTo(o(cx), o(cy));
    c.lineTo(o(cx), o(cy + dy * s));
  }
  c.stroke();
  c.restore();
}

/** A luminous stroke: the line with a soft halo of its own colour (live vectors, ideal markers). */
export function neon(c: C, draw: (c: C) => void, color: string, w = 2, blur = 12) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowColor = alpha(color, 0.75);
  c.shadowBlur = blur;
  c.beginPath();
  draw(c);
  c.stroke();
  c.shadowBlur = 0;
  c.restore();
}

/** A polyline that fades in from its first point to its last (motion trails, recent history). */
export function trail(c: C, pts: { x: number; y: number }[], color: string, w = 2) {
  if (pts.length < 2) return;
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = color;
  c.lineWidth = w;
  for (let i = 1; i < pts.length; i++) {
    c.globalAlpha = (i / (pts.length - 1)) ** 1.5;
    c.beginPath();
    c.moveTo(pts[i - 1].x, pts[i - 1].y);
    c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
  }
  c.restore();
}

/** An expanding, fading ring: feedback for an event. p runs 0 → 1. */
export function ripple(c: C, x: number, y: number, r0: number, r1: number, p: number, color: string, w = 2) {
  if (p <= 0 || p >= 1) return;
  c.save();
  c.globalAlpha = (1 - p) ** 1.5;
  c.strokeStyle = color;
  c.lineWidth = w * (1 - p * 0.6);
  c.beginPath();
  c.arc(x, y, r0 + (r1 - r0) * (1 - (1 - p) ** 3), 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

/** A rounded bar (ledgers, meters): a body with light from above. Negative widths are allowed. */
export function bar(c: C, x: number, y: number, w: number, h: number, color = pal.ink, r = h / 3) {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (w < 0.5) return;
  c.save();
  rr(c, x, y, w, h, Math.min(r, w / 2));
  c.fillStyle = color;
  c.fill();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.14)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  c.fillStyle = g;
  c.fill();
  c.restore();
}
