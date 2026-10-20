// Canvas controls shared by the adjust-then-lock experiments (Phaseshift, Perception, Afterimage, Intersect):
// labelled sliders without numbers, a lock button, and a keyboard path (↑ ↓ choose, ← → adjust, Shift fine,
// Enter lock). Values live here; experiments read them — the renderer never decides a score.
import { capture, gameKey, listen, primary } from './input';
import { circle, clamp, font, hair, line, pal, text } from './draw';
import { alpha, glow, rr, slot, softShadow } from './materials';
import { sensitivity, targetScale } from './settings';
import type { Stage } from './stage';

export interface Knob {
  id: string;
  label: string;
  lo: number;
  hi: number;
  value: number;
  /** Keyboard speed in value units per second (Shift = an eighth). */
  speed: number;
  /** Called on every change with the input's own timestamp (ms). */
  onChange?: (v: number, t: number) => void;
  /** Optional readout (most knobs deliberately show no number). */
  readout?: (v: number) => string;
  /** Hidden knobs are skipped (e.g. not used at this level). */
  hidden?: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const inside = (r: Rect | null, x: number, y: number) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class Controls {
  knobs: Knob[] = [];
  sel = 0;
  enabled = true;
  lockLabel = 'Lock';
  /** Shown only when at least one knob has been touched (no accidental zero-effort locks). */
  touched = false;
  private rects: Rect[] = [];
  private btn: Rect | null = null;
  private drag = -1;
  private dragDx = 0;
  private keys = new Set<string>();
  private fine = false;
  private lastT = 0;
  private offs: (() => void)[] = [];

  constructor(
    private stage: Stage,
    private onLock: (t: number) => void,
  ) {
    const c = stage.canvas;
    c.addEventListener('pointerdown', this.down, true);
    c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerup', this.up);
    c.addEventListener('pointercancel', this.cancel);
    this.offs.push(
      listen('keydown', this.keydown),
      listen('keyup', (e) => {
        this.fine = e.shiftKey;
        this.keys.delete(e.key);
      }),
      listen('blur', () => this.keys.clear()),
    );
  }

  set(knobs: Knob[]) {
    this.knobs = knobs;
    this.sel = Math.max(0, knobs.findIndex((k) => !k.hidden));
    this.touched = false;
    this.drag = -1;
    this.keys.clear();
  }

  get(id: string) {
    return this.knobs.find((k) => k.id === id)!;
  }

  private visible() {
    return this.knobs.map((k, i) => ({ k, i })).filter(({ k }) => !k.hidden);
  }

  private setValue(i: number, v: number, t: number) {
    const k = this.knobs[i];
    const nv = clamp(v, k.lo, k.hi);
    if (nv === k.value) return;
    k.value = nv;
    this.touched = true;
    k.onChange?.(nv, t);
    this.stage.request();
  }

  private fromX(i: number, x: number) {
    const r = this.rects[i];
    const k = this.knobs[i];
    return k.lo + clamp((x - r.x) / r.w, 0, 1) * (k.hi - k.lo);
  }

  /** Capture phase: if the press lands on a control, the experiment never sees it. */
  private down = (e: PointerEvent) => {
    if (!primary(e) || !this.enabled) return;
    const p = this.stage.pt(e);
    if (inside(this.btn, p.x, p.y)) {
      e.stopImmediatePropagation();
      if (this.touched) this.onLock(e.timeStamp);
      return;
    }
    for (const { i } of this.visible()) {
      const r = this.rects[i];
      const pad = 20 * targetScale();
      if (!r || !inside({ x: r.x - 14, y: r.y - pad, w: r.w + 28, h: r.h + 2 * pad }, p.x, p.y)) continue;
      e.stopImmediatePropagation();
      capture(this.stage.canvas, e.pointerId);
      this.drag = i;
      this.sel = i;
      // Grab the knob where it is: pressing beside it does not make it jump.
      const k = this.knobs[i];
      const kx = r.x + ((k.value - k.lo) / (k.hi - k.lo)) * r.w;
      this.dragDx = Math.abs(p.x - kx) < 22 * targetScale() ? p.x - kx : 0;
      this.setValue(i, this.fromX(i, p.x - this.dragDx), e.timeStamp);
      this.stage.request();
      return;
    }
  };

  private move = (e: PointerEvent) => {
    if (this.drag < 0 || !primary(e)) return;
    const evs = e.getCoalescedEvents?.() ?? [];
    const last = evs.length ? evs[evs.length - 1] : e;
    this.setValue(this.drag, this.fromX(this.drag, this.stage.pt(last).x - this.dragDx), e.timeStamp);
  };

  private up = (e: PointerEvent) => {
    if (primary(e)) this.drag = -1;
  };
  private cancel = () => {
    this.drag = -1;
  };

  get dragging() {
    return this.drag >= 0;
  }

  private keydown = (e: KeyboardEvent) => {
    this.fine = e.shiftKey;
    if (!gameKey(e) || !this.enabled) return;
    // Enter works even with no sliders (a lone Lock / Done / Launch button).
    if (e.key === 'Enter' && !e.repeat) {
      // Only claim Enter when it actually locks; otherwise the experiment may use it (e.g. "start").
      if (this.touched) {
        e.preventDefault();
        this.onLock(e.timeStamp);
      }
      return;
    }
    const vis = this.visible();
    if (!vis.length) return;
    const pos = vis.findIndex(({ i }) => i === this.sel);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (vis.length < 2) return;
      const n = (pos + (e.key === 'ArrowDown' ? 1 : -1) + vis.length) % vis.length;
      this.sel = vis[n].i;
      this.stage.request();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!this.keys.size) this.lastT = performance.now();
      this.keys.add(e.key);
      this.stage.request();
    }
  };

  /** Advance keyboard adjustment. Call once per frame; returns true while keys are held. */
  tick(now: number) {
    if (!this.keys.size || !this.enabled) return false;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const k = this.knobs[this.sel];
    if (!k || k.hidden) return false;
    const sp = k.speed * (this.fine ? 0.125 : 1) * sensitivity();
    const dir = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    if (dir) this.setValue(this.sel, k.value + dir * sp * dt, performance.now());
    return true;
  }

  /**
   * Lay out and draw the visible knobs in a column from (x, y), each `w` wide, plus the lock button.
   * Returns the height used.
   */
  draw(c: CanvasRenderingContext2D, x: number, y: number, w: number, opts: { lock?: boolean } = {}) {
    const vis = this.visible();
    const rowH = 54;
    const lockW = opts.lock === false ? 0 : 92;
    const tw = w - (lockW ? lockW + 18 : 0);
    vis.forEach(({ k, i }, n) => {
      const ty = y + n * rowH + 28;
      const r = { x: x + 10, y: ty - 3, w: tw - 20, h: 6 };
      this.rects[i] = r;
      const selected = i === this.sel && vis.length > 1;
      text(c, k.label.toUpperCase(), x, ty - 14, font.mono(10, 500), selected ? pal.ink : pal.ink3, 'left');
      if (k.readout) text(c, k.readout(k.value), x + tw, ty - 14, font.mono(10, 500), pal.ink2, 'right');
      if (selected) text(c, '◂ ▸', x + tw - (k.readout ? 64 : 0), ty - 14, font.mono(10, 500), pal.ink3, 'right');
      // A recessed track with end stops, and a knob that sits on it (lit while you drag it).
      slot(c, r.x, ty, r.x + r.w, ty, selected ? 7 : 6);
      hair(c, r.x, ty - 6, r.x, ty + 6, pal.ink3);
      hair(c, r.x + r.w, ty - 6, r.x + r.w, ty + 6, pal.ink3);
      const kx = r.x + ((k.value - k.lo) / (k.hi - k.lo)) * r.w;
      const kr = (this.drag === i ? 10 : 8) * targetScale();
      const live = this.drag === i || (selected && this.keys.size > 0);
      // The travelled part of the track, lit in the lab's cyan (it shows only what the knob already shows).
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = alpha(pal.accent, live ? 0.75 : 0.4);
      c.lineWidth = 2;
      if (live) {
        c.shadowColor = alpha(pal.accent, 0.6);
        c.shadowBlur = 8;
      }
      c.beginPath();
      c.moveTo(r.x, ty);
      c.lineTo(kx, ty);
      c.stroke();
      c.restore();
      if (live) glow(c, kx, ty, kr * 3.4, pal.accent, 0.8);
      softShadow(c, kx, ty + kr * 0.6, kr * 1.2, kr * 0.4, 1.3);
      circle(c, kx, ty, kr, live ? pal.accent : pal.ink, pal.paper, 2);
      circle(c, kx, ty, 2.5, undefined, live ? pal.accent : pal.ink);
    });
    if (lockW) {
      const bh = 40;
      const by = y + Math.max(0, (vis.length * rowH - bh) / 2) + 8;
      this.btn = { x: x + w - lockW, y: by, w: lockW, h: bh };
      const on = this.touched && this.enabled;
      c.save();
      if (on) {
        // Primary trigger: solid alabaster with a cyan halo.
        c.shadowColor = alpha(pal.accent, 0.45);
        c.shadowBlur = 16;
      }
      rr(c, this.btn.x, by, lockW, bh, 4);
      c.fillStyle = on ? pal.ink : pal.paper2;
      c.fill();
      c.restore();
      rr(c, this.btn.x + 0.5, by + 0.5, lockW - 1, bh - 1, 4);
      c.strokeStyle = on ? pal.ink : pal.line;
      c.lineWidth = 1;
      c.stroke();
      text(c, this.lockLabel, this.btn.x + lockW / 2, by + bh / 2 - 5, font.sans(14, 550), on ? pal.paper : pal.ink3, 'center', 'middle');
      text(c, 'Enter', this.btn.x + lockW / 2, by + bh / 2 + 11, font.mono(9, 500), on ? pal.paper : pal.ink3, 'center', 'middle');
    } else this.btn = null;
    return vis.length * rowH + 8;
  }

  destroy() {
    const c = this.stage.canvas;
    c.removeEventListener('pointerdown', this.down, true);
    c.removeEventListener('pointermove', this.move);
    c.removeEventListener('pointerup', this.up);
    c.removeEventListener('pointercancel', this.cancel);
    this.offs.forEach((f) => f());
  }
}

/** A small "selected" marker that does not rely on colour: brackets around a point. */
export function selectMarks(c: CanvasRenderingContext2D, x: number, y: number, r: number, color = pal.ink) {
  const s = 6;
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    line(c, x + dx * r, y + dy * r, x + dx * (r - s), y + dy * r, color, 1.5);
    line(c, x + dx * r, y + dy * r, x + dx * r, y + dy * (r - s), color, 1.5);
  }
}
