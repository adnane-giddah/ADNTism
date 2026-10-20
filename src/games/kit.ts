// Shared bench for the discrete-answer experiments (Density … Function Path): canvas buttons that are
// re-registered every frame they are drawn, owned timers, keyboard / pointer routing, tap-to-rank ordering
// and tie-aware pairwise ranking scores. Pure logic (Ranker, pairScore) is testable without a canvas.
import { circle, font, pal, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { alpha, rr } from '../core/materials';
import { targetScale } from '../core/settings';
import type { GameAPI, Result } from '../core/types';

type C = CanvasRenderingContext2D;
export type Pt = { x: number; y: number };

/** Intermediate states (neither the target cyan nor the error coral). */
export const AMBER = '#F2B84B';
export const VIOLET = '#A88BFF';
export const BLUE = '#6FA8FF';

interface Btn {
  x: number;
  y: number;
  w: number;
  h: number;
  run: () => void;
}

export interface BtnOpts {
  primary?: boolean;
  sel?: boolean;
  off?: boolean;
  key?: string;
  color?: string;
  px?: number;
}

export class Bench {
  private btns: Btn[] = [];
  private timers = new Set<number>();
  private offs: (() => void)[] = [];
  /** A press that is not on a button (stage px). */
  onTap: (p: Pt, e: PointerEvent) => void = () => {};
  onMove: (p: Pt, e: PointerEvent) => void = () => {};
  onUp: (p: Pt, e: PointerEvent) => void = () => {};
  /** A game key (not typed into a field, no modifiers). */
  onKey: (e: KeyboardEvent) => void = () => {};
  /** The page was hidden or lost focus. */
  onAway: (hidden: boolean) => void = () => {};

  constructor(private api: GameAPI) {
    const cv = api.stage.canvas;
    const down = (e: PointerEvent) => {
      if (!primary(e)) return;
      const p = api.stage.pt(e);
      const pad = 4 * targetScale();
      for (let i = this.btns.length - 1; i >= 0; i--) {
        const b = this.btns[i];
        if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
          e.preventDefault();
          api.sfx.tick();
          b.run();
          api.stage.request();
          return;
        }
      }
      this.onTap(p, e);
      api.stage.request();
    };
    const move = (e: PointerEvent) => primary(e) && this.onMove(api.stage.pt(e), e);
    const up = (e: PointerEvent) => primary(e) && this.onUp(api.stage.pt(e), e);
    const cancel = (e: PointerEvent) => this.onUp({ x: NaN, y: NaN }, e);
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', cancel);
    const vis = () => document.hidden && this.onAway(true);
    document.addEventListener('visibilitychange', vis);
    this.offs.push(
      () => {
        cv.removeEventListener('pointerdown', down);
        cv.removeEventListener('pointermove', move);
        cv.removeEventListener('pointerup', up);
        cv.removeEventListener('pointercancel', cancel);
        document.removeEventListener('visibilitychange', vis);
      },
      listen('keydown', (e) => {
        if (!gameKey(e) || e.defaultPrevented) return;
        this.onKey(e);
        api.stage.request();
      }),
      listen('blur', () => this.onAway(false)),
    );
  }

  /** Call first in every frame: buttons exist only while they are drawn. */
  frame() {
    this.btns = [];
  }

  button(c: C, x: number, y: number, w: number, h: number, label: string, run: () => void, o: BtnOpts = {}) {
    const on = !o.off;
    c.save();
    if (o.primary && on) {
      c.shadowColor = alpha(pal.accent, 0.4);
      c.shadowBlur = 14;
    }
    rr(c, x, y, w, h, 6);
    c.fillStyle = o.primary && on ? pal.ink : o.sel ? alpha(o.color ?? pal.accent, 0.16) : pal.paper2;
    c.fill();
    c.restore();
    rr(c, x + 0.5, y + 0.5, w - 1, h - 1, 6);
    c.strokeStyle = o.sel ? (o.color ?? pal.accent) : o.primary && on ? pal.ink : pal.line;
    c.lineWidth = o.sel ? 1.5 : 1;
    c.stroke();
    const fg = o.primary && on ? pal.paper : on ? (o.color ?? pal.ink) : pal.ink3;
    // Long labels on narrow buttons (phones) shrink to fit instead of spilling over their neighbours.
    let px = o.px ?? 13;
    c.font = font.sans(px, 550);
    while (px > 8 && c.measureText(label).width > w - 10) c.font = font.sans((px -= 0.5), 550);
    text(c, label, x + w / 2, y + h / 2 - (o.key ? 5 : 0), font.sans(px, 550), fg, 'center', 'middle');
    if (o.key) text(c, o.key, x + w / 2, y + h / 2 + 10, font.mono(9, 500), o.primary && on ? pal.paper : pal.ink3, 'center', 'middle');
    if (on) this.btns.push({ x, y, w, h, run });
  }

  /** A row of equal buttons centred on cx. Returns the row's height. */
  row(c: C, cx: number, y: number, maxW: number, items: { label: string; run: () => void; o?: BtnOpts }[], h = 44) {
    const gap = 8;
    const w = Math.min(170, (maxW - gap * (items.length - 1)) / items.length);
    const x0 = cx - (items.length * w + gap * (items.length - 1)) / 2;
    items.forEach((it, i) => this.button(c, x0 + i * (w + gap), y, w, h, it.label, it.run, it.o));
    return h;
  }

  /** A region that acts like a button but is drawn by the game. */
  hit(x: number, y: number, w: number, h: number, run: () => void) {
    this.btns.push({ x, y, w, h, run });
  }

  later(fn: () => void, ms: number) {
    const t = window.setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  /** Hand the result to the shell after a short settle (none with reduced motion). */
  finish(r: Result) {
    this.later(() => this.api.finish(r), this.api.motion() ? 600 : 0);
  }

  destroy() {
    this.clear();
    this.offs.forEach((f) => f());
  }
}

// ── Ranking ──────────────────────────────────────────────────────────────────────

/** Tap-to-rank: tap items in order; tapping a ranked item removes it. The last item fills itself in. */
export class Ranker {
  order: number[] = [];
  constructor(public n: number) {}
  reset(n = this.n) {
    this.n = n;
    this.order = [];
  }
  toggle(i: number) {
    if (i < 0 || i >= this.n) return;
    const at = this.order.indexOf(i);
    if (at >= 0) this.order.splice(at, 1);
    else {
      this.order.push(i);
      if (this.order.length === this.n - 1) for (let j = 0; j < this.n; j++) if (!this.order.includes(j)) this.order.push(j);
    }
  }
  undo() {
    this.order.pop();
    if (this.order.length === this.n - 1) this.order.pop();
  }
  rank(i: number) {
    return this.order.indexOf(i) + 1;
  }
  get done() {
    return this.order.length === this.n;
  }
}

/**
 * Pairwise ranking score. `order` lists item indices from first to last place; `desc` means first place
 * should have the largest value. Pairs whose values are equal within `tol` (relative) are ties: any order of
 * a tied pair is correct, and ties are not counted. Exact ⇔ no discordant pair.
 */
export function pairScore(order: number[], values: number[], desc = true, tol = 1e-9) {
  let wrong = 0;
  let total = 0;
  for (let p = 0; p < order.length; p++)
    for (let q = p + 1; q < order.length; q++) {
      const a = values[order[p]];
      const b = values[order[q]];
      if (Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12)) continue;
      total++;
      if (desc ? a < b : a > b) wrong++;
    }
  return { wrong, total, frac: total ? wrong / total : 0, exact: wrong === 0 };
}

/** The correct order (first place first), ties broken by index. */
export function trueOrder(values: number[], desc = true) {
  return values.map((_, i) => i).sort((a, b) => (desc ? values[b] - values[a] : values[a] - values[b]) || a - b);
}

/** A round rank badge (the number the player gave an item). */
export function badge(c: C, x: number, y: number, n: number, color = pal.accent) {
  circle(c, x, y, 11, color, pal.paper, 1.5);
  text(c, String(n), x, y + 0.5, font.mono(11, 600), color, 'center', 'middle');
}

/** Per-round marks along the bottom edge: done rounds show their mark, the current one a dot. */
export function roundStrip(c: C, w: number, y: number, marks: string[], total: number, cur: number) {
  const step = Math.min(46, (w - 32) / Math.max(1, total));
  for (let i = 0; i < total; i++)
    text(c, i < marks.length ? marks[i] : i === cur ? '•' : '·', w / 2 + (i - (total - 1) / 2) * step, y, font.mono(11, 500), i <= cur ? pal.ink : pal.ink3, 'center');
}

/** Mean of a list (0 for none). */
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Fisher–Yates with the game's seeded generator. */
export function shuffle<T>(a: T[], next: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
