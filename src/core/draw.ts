import { flashOK, textScale } from './settings';
// Shared canvas vocabulary: hairlines, ghosts, error brackets, readouts.

export interface Palette {
  paper: string;
  paper2: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  signal: string;
  /** Electric cyan: ideal markers, targets, precision. Coral (signal) stays reserved for error. */
  accent: string;
  signalSoft: string;
  liquid: string;
  liquidDeep: string;
  glass: string;
  shade: string;
}

export const pal: Palette = {
  paper: '#0A0A0C',
  paper2: '#111215',
  ink: '#F4F0E8',
  ink2: '#A2A5AD',
  ink3: '#6B6F7A',
  line: 'rgba(244,240,232,.16)',
  line2: 'rgba(244,240,232,.08)',
  signal: '#FF6B53',
  accent: '#2EE9D7',
  signalSoft: 'rgba(255,107,83,.16)',
  liquid: 'rgba(110,165,205,.26)',
  liquidDeep: 'rgba(120,175,215,.42)',
  glass: 'rgba(255,255,255,.08)',
  shade: 'rgba(0,0,0,.55)',
};

/** Re-read the CSS tokens (after theme / contrast changes). */
export function refreshPalette() {
  const s = getComputedStyle(document.documentElement);
  const g = (n: string) => s.getPropertyValue(n).trim();
  pal.paper = g('--paper');
  pal.paper2 = g('--paper-2');
  pal.ink = g('--ink');
  pal.ink2 = g('--ink-2');
  pal.ink3 = g('--ink-3');
  pal.line = g('--line');
  pal.line2 = g('--line-2');
  pal.signal = g('--signal');
  pal.accent = g('--accent');
  pal.signalSoft = g('--signal-soft');
  pal.liquid = g('--liquid');
  pal.liquidDeep = g('--liquid-deep');
  pal.glass = g('--glass');
  pal.shade = g('--shade');
}

// Canvas text follows the "large text" setting.
const sz = (px: number) => Math.round(px * textScale() * 10) / 10;
export const font = {
  mono: (px: number, w = 450) => `${w} ${sz(px)}px "JetBrains Mono Variable", ui-monospace, Menlo, monospace`,
  sans: (px: number, w = 450) => `${w} ${sz(px)}px "Inter Variable", system-ui, sans-serif`,
  serif: (px: number, italic = false) => `${italic ? 'italic ' : ''}400 ${sz(px)}px "Playfair Display Variable", Georgia, serif`,
};

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeInOut = (t: number) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
/** Damped spring settle 0→1 with a little overshoot. */
export const springOut = (t: number) => {
  t = clamp(t, 0, 1);
  return 1 - Math.exp(-6 * t) * Math.cos(9 * t);
};

type C = CanvasRenderingContext2D;

export function line(c: C, x1: number, y1: number, x2: number, y2: number, color: string, w = 1, dash?: number[]) {
  c.beginPath();
  c.setLineDash(dash ?? []);
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = w;
  c.stroke();
  c.setLineDash([]);
}

/** Crisp 1px line on pixel centres. */
export function hair(c: C, x1: number, y1: number, x2: number, y2: number, color: string, dash?: number[]) {
  const o = (v: number) => Math.round(v) + 0.5;
  line(c, o(x1), o(y1), o(x2), o(y2), color, 1, dash);
}

export function circle(c: C, x: number, y: number, r: number, stroke?: string, fill?: string, w = 1, dash?: number[]) {
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, TAU);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.setLineDash(dash ?? []);
    c.strokeStyle = stroke;
    c.lineWidth = w;
    c.stroke();
    c.setLineDash([]);
  }
}

export function arrow(c: C, x1: number, y1: number, x2: number, y2: number, color: string, w = 1.5, head = 9, dash?: number[]) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const hh = Math.min(head, len * 0.45);
  const bx = x2 - Math.cos(a) * hh * 0.85;
  const by = y2 - Math.sin(a) * hh * 0.85;
  line(c, x1, y1, bx, by, color, w, dash);
  if (len < 1) return;
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(x2 - Math.cos(a - 0.38) * hh, y2 - Math.sin(a - 0.38) * hh);
  c.lineTo(x2 - Math.cos(a + 0.38) * hh, y2 - Math.sin(a + 0.38) * hh);
  c.closePath();
  c.fillStyle = color;
  c.fill();
}

export function cross(c: C, x: number, y: number, s: number, color: string, w = 1, gap = 0) {
  line(c, x - s, y, x - gap, y, color, w);
  line(c, x + gap, y, x + s, y, color, w);
  line(c, x, y - s, x, y - gap, color, w);
  line(c, x, y + gap, x, y + s, color, w);
}

export function text(
  c: C,
  s: string,
  x: number,
  y: number,
  f: string,
  color: string,
  align: CanvasTextAlign = 'left',
  base: CanvasTextBaseline = 'alphabetic',
) {
  c.font = f;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = base;
  c.fillText(s, x, y);
}

/** Label with a paper-coloured knockout so it stays readable over lines. */
export function tag(c: C, s: string, x: number, y: number, color: string, px = 11, align: CanvasTextAlign = 'center') {
  c.font = font.mono(px, 500);
  const w = c.measureText(s).width;
  const pad = 4;
  const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const ph = px * textScale();
  // A rounded paper pill with a hairline edge, so labels read as labels, not as part of the drawing.
  const bx = lx - pad - 1;
  const by = y - ph * 0.75 - pad + 1;
  const bw = w + pad * 2 + 2;
  const bh = ph + pad * 2 - 2;
  const r = Math.min(bh / 2, 6);
  c.beginPath();
  c.moveTo(bx + r, by);
  c.arcTo(bx + bw, by, bx + bw, by + bh, r);
  c.arcTo(bx + bw, by + bh, bx, by + bh, r);
  c.arcTo(bx, by + bh, bx, by, r);
  c.arcTo(bx, by, bx + bw, by, r);
  c.closePath();
  c.fillStyle = pal.paper;
  c.fill();
  c.strokeStyle = pal.line2;
  c.lineWidth = 1;
  c.stroke();
  text(c, s, x, y, font.mono(px, 500), color, align, 'middle');
}

/** Dimension line with end ticks, like an engineering drawing. Used for every error. */
export function bracket(c: C, x1: number, y1: number, x2: number, y2: number, color: string, tick = 5, w = 1.25) {
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
  const dx = Math.cos(a) * tick;
  const dy = Math.sin(a) * tick;
  line(c, x1, y1, x2, y2, color, w);
  line(c, x1 - dx, y1 - dy, x1 + dx, y1 + dy, color, w);
  line(c, x2 - dx, y2 - dy, x2 + dx, y2 + dy, color, w);
}

let hatchCache: { key: string; p: CanvasPattern | null } = { key: '', p: null };
/** Diagonal hatch pattern: a colour-independent way to mark "error" areas. */
export function hatch(c: C, color: string, gap = 6) {
  const key = color + gap;
  if (hatchCache.key === key && hatchCache.p) return hatchCache.p;
  const t = document.createElement('canvas');
  const s = gap * 2;
  t.width = t.height = s;
  const x = t.getContext('2d')!;
  x.strokeStyle = color;
  x.lineWidth = 1;
  x.beginPath();
  for (let i = -s; i <= s * 2; i += gap) {
    x.moveTo(i, 0);
    x.lineTo(i + s, s);
  }
  x.stroke();
  const p = c.createPattern(t, 'repeat');
  hatchCache = { key, p };
  return p!;
}

/** Ruler ticks along a horizontal axis. */
export function ruler(
  c: C,
  x0: number,
  x1: number,
  y: number,
  from: number,
  to: number,
  minor: number,
  major: number,
  label: (v: number) => string,
  color = pal.ink3,
) {
  const span = to - from;
  const steps = Math.round(span / minor);
  for (let i = 0; i <= steps; i++) {
    const v = from + i * minor;
    const x = x0 + ((v - from) / span) * (x1 - x0);
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    hair(c, x, y, x, y + (isMajor ? 9 : 4), isMajor ? pal.ink2 : color);
    if (isMajor) text(c, label(v), x, y + 22, font.mono(10), pal.ink3, 'center');
  }
}

/**
 * A beat lamp. `flash` is 1 at the beat and fades to 0. With flashes allowed it lights in the signal colour
 * with an expanding ring; with "no flashes" (or reduced motion) it only glows gently — the cue stays visible.
 */
export function beatLamp(c: C, x: number, y: number, r: number, flash: number) {
  if (flashOK()) {
    if (flash > 0) {
      // A soft bloom around the lit lamp.
      const g = c.createRadialGradient(x, y, r * 0.5, x, y, r * 3);
      g.addColorStop(0, 'rgba(46,233,215,.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = flash;
      c.fillStyle = g;
      c.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
      c.globalAlpha = 1;
    }
    circle(c, x, y, r, pal.ink2, flash > 0 ? pal.accent : undefined, 1.5);
    if (flash > 0) {
      c.globalAlpha = flash;
      circle(c, x, y, r + r * 0.6 * (1 - flash), pal.accent, undefined, 2);
      c.globalAlpha = 1;
    }
  } else {
    circle(c, x, y, r, pal.ink2, undefined, 1.5);
    if (flash > 0) {
      c.globalAlpha = 0.35 * flash;
      circle(c, x, y, r - 2, undefined, pal.ink);
      c.globalAlpha = 1;
    }
  }
}
