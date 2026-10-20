// Stage juice: sparks, shockwaves, streak glow and tap ripples on a transparent canvas laid over the game.
// Purely presentational and event-driven: the loop only runs while something is alive, so an idle stage still
// costs nothing. It never reads or changes game state, and it is silent with reduced motion; "no flashes"
// keeps the particles but drops the full-edge flashes.
import { TAU, clamp, pal } from './draw';
import type { Tier } from './progress';
import { flashOK, reducedMotion } from './settings';
import { stageScale } from './stage';

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  drag: number;
  kind: 'dot' | 'spark' | 'chip';
  rot: number;
  vr: number;
}
interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  w: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const MAX_P = 420;

export class Fx {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ps: P[] = [];
  private rings: Ring[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private k = 1;
  private ro: ResizeObserver;
  private flashA = 0;
  private flashColor = '#fff';
  private streakNow = 0;
  private streakShown = 0;
  private shakeAmp = 0;
  private shakeT = 0;
  private dead = false;
  /** Current screen-shake offset (CSS px). The stage applies it to the game canvas only, never to input mapping. */
  sx = 0;
  sy = 0;
  /** Called when the shake offset changes, so the stage can redraw the game canvas. */
  onShake: () => void = () => {};

  /** `scale` gives the stage's logical scale when it differs from the default (e.g. the app's landscape fit). */
  constructor(
    private host: HTMLElement,
    private scale?: () => number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(host);
    this.fit();
  }

  /** Re-read the host size and scale (after the stage changed its layout scale). */
  refit() {
    this.fit();
  }

  private fit() {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(r.width));
    const ch = Math.max(1, Math.round(r.height));
    // Same logical units as the stage, so effects land where the game drew things.
    this.k = this.scale ? this.scale() : stageScale(cw, ch);
    this.w = cw / this.k;
    this.h = ch / this.k;
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
  }

  private get quiet() {
    return reducedMotion() || this.dead;
  }

  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  /** Radial spray of sparks. */
  burst(x: number, y: number, color: string, n = 18, speed = 220, size = 2.4) {
    if (this.quiet) return;
    for (let i = 0; i < n && this.ps.length < MAX_P; i++) {
      const a = rnd(0, TAU);
      const v = speed * rnd(0.25, 1);
      this.ps.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: rnd(0.45, 0.95),
        size: rnd(size * 0.5, size * 1.4),
        color,
        grav: 90,
        drag: 2.6,
        kind: Math.random() < 0.35 ? 'spark' : 'dot',
        rot: a,
        vr: 0,
      });
    }
    this.wake();
  }

  /** A directed spray (brake sparks, exhaust, splashes): `angle` in radians, `spread` either side. */
  spray(x: number, y: number, angle: number, spread: number, color: string, n = 3, speed = 160, size = 1.6, grav = 260) {
    if (this.quiet) return;
    for (let i = 0; i < n && this.ps.length < MAX_P; i++) {
      const a = angle + rnd(-spread, spread);
      const v = speed * rnd(0.4, 1);
      this.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(0.25, 0.6), size: rnd(size * 0.6, size * 1.3), color, grav, drag: 2, kind: 'spark', rot: 0, vr: 0 });
    }
    this.wake();
  }

  /** Falling confetti chips from a point (or a line across the top when x is omitted). */
  confetti(n = 70, x?: number, y = -10) {
    if (this.quiet) return;
    const cols = [pal.accent, pal.ink, '#FFB834', pal.signal];
    for (let i = 0; i < n && this.ps.length < MAX_P; i++) {
      const px = x ?? rnd(this.w * 0.15, this.w * 0.85);
      const a = x == null ? rnd(Math.PI * 0.3, Math.PI * 0.7) : rnd(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = x == null ? rnd(60, 240) : rnd(180, 520);
      this.ps.push({
        x: px,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: rnd(1.4, 2.4),
        size: rnd(3, 6),
        color: cols[i % cols.length],
        grav: 380,
        drag: 0.9,
        kind: 'chip',
        rot: rnd(0, TAU),
        vr: rnd(-9, 9),
      });
    }
    this.wake();
  }

  /** An expanding shockwave ring. */
  ring(x: number, y: number, color: string, r1 = 70, w = 2, max = 0.6, r0 = 4) {
    if (this.quiet) return;
    this.rings.push({ x, y, r0, r1, life: 0, max, color, w });
    this.wake();
  }

  /** A short, small jolt of the game canvas. */
  shake(amp = 3, dur = 0.22) {
    if (this.quiet || !flashOK()) return;
    this.shakeAmp = Math.max(this.shakeAmp, Math.min(amp, 6));
    this.shakeT = Math.max(this.shakeT, dur);
    this.wake();
  }

  /** The whole stage edge flashes once. Skipped with "no flashes". */
  flash(color: string, a = 0.22) {
    if (!flashOK()) return;
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, a);
    this.wake();
  }

  /** Sustained glow along the stage edge, growing with a streak of good rounds. */
  streak(n: number) {
    this.streakNow = n;
    this.wake();
  }

  /** The reaction to a judged round: bigger the better it was. */
  judge(tier: Tier, x: number, y: number, combo: number) {
    if (this.quiet) return;
    const accent = pal.accent;
    switch (tier) {
      case 'exact':
        this.burst(x, y, pal.ink, 26, 330, 2.6);
        this.burst(x, y, accent, 30, 260, 2.4);
        this.ring(x, y, accent, 120, 2.5, 0.8);
        this.ring(x, y, pal.ink, 70, 1.5, 0.55);
        this.flash(accent, 0.26);
        this.shake(3, 0.2);
        break;
      case 'excellent':
        this.burst(x, y, accent, 24, 270, 2.4);
        this.ring(x, y, accent, 90, 2, 0.65);
        this.flash(accent, 0.15);
        break;
      case 'great':
        this.burst(x, y, pal.ink, 12, 190, 2);
        this.ring(x, y, pal.ink2, 56, 1.5, 0.5);
        break;
      case 'good':
        this.burst(x, y, '#FFB834', 7, 130, 1.8);
        break;
      default:
        // A miss falls and dims: a few coral crumbs, a flick of the canvas.
        for (let i = 0; i < 8 && this.ps.length < MAX_P; i++)
          this.ps.push({ x: x + rnd(-14, 14), y, vx: rnd(-60, 60), vy: rnd(-70, -10), life: 0, max: rnd(0.5, 0.9), size: rnd(1.5, 2.6), color: pal.signal, grav: 420, drag: 0.6, kind: 'dot', rot: 0, vr: 0 });
        this.shake(2.2, 0.16);
        this.wake();
    }
    this.streak(combo);
  }

  /** The finish of an attempt: the better it is, the more there is to see. */
  celebrate(kind: 'perfect' | 'best' | 'near' | 'plain') {
    if (this.quiet) return;
    const cx = this.w / 2;
    const cy = this.h * 0.45;
    if (kind === 'perfect') {
      this.confetti(110);
      this.ring(cx, cy, pal.accent, Math.min(this.w, this.h) * 0.6, 3, 1.2, 10);
      this.ring(cx, cy, pal.ink, Math.min(this.w, this.h) * 0.4, 1.5, 0.9, 10);
      this.burst(cx, cy, pal.accent, 46, 420, 2.8);
      this.flash(pal.accent, 0.3);
    } else if (kind === 'best') {
      this.confetti(54);
      this.ring(cx, cy, '#FFB834', Math.min(this.w, this.h) * 0.45, 2.5, 1, 10);
      this.burst(cx, cy, '#FFB834', 28, 300, 2.4);
    } else if (kind === 'near') {
      this.ring(cx, cy, pal.accent, Math.min(this.w, this.h) * 0.3, 2, 0.8, 10);
      this.burst(cx, cy, pal.accent, 16, 200, 2.2);
    }
    this.streak(0);
  }

  /** A press on the stage: a small ripple under the finger. */
  tap(x: number, y: number) {
    if (this.quiet) return;
    this.ring(x, y, pal.accent, 22, 1.25, 0.34, 3);
  }

  private wake() {
    if (this.raf || this.dead) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.dead) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.ctx;
    c.setTransform(this.dpr * this.k, 0, 0, this.dpr * this.k, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    // streak glow eases towards its target
    this.streakShown += (this.streakNow - this.streakShown) * Math.min(1, dt * 6);
    if (this.streakShown > 0.05) this.drawStreak(c);
    if (this.flashA > 0.004) {
      const g = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, this.flashColor);
      c.globalAlpha = this.flashA;
      c.fillStyle = g;
      c.fillRect(0, 0, this.w, this.h);
      c.globalAlpha = 1;
      this.flashA *= Math.exp(-dt * 5.5);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      const t = r.life / r.max;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - (1 - t) ** 3;
      c.globalAlpha = (1 - t) ** 1.5;
      c.beginPath();
      c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, TAU);
      c.strokeStyle = r.color;
      c.lineWidth = Math.max(0.5, r.w * (1 - t * 0.6));
      c.stroke();
    }

    c.globalCompositeOperation = 'lighter';
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.ps[i] = this.ps[this.ps.length - 1];
        this.ps.pop();
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const t = p.life / p.max;
      c.globalAlpha = (1 - t) ** 1.4;
      c.fillStyle = p.color;
      c.strokeStyle = p.color;
      if (p.kind === 'dot') {
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, TAU);
        c.fill();
      } else if (p.kind === 'spark') {
        const sp = Math.hypot(p.vx, p.vy);
        const len = clamp(sp * 0.045, 2, 16);
        c.lineWidth = Math.max(0.8, p.size * 0.6);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(p.x - (p.vx / (sp || 1)) * len, p.y - (p.vy / (sp || 1)) * len);
        c.stroke();
      } else {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.9 + 0.1);
        c.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
        c.restore();
      }
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    // screen shake: a decaying, damped jitter
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = clamp(this.shakeT / 0.22, 0, 1);
      this.sx = (Math.random() * 2 - 1) * this.shakeAmp * k;
      this.sy = (Math.random() * 2 - 1) * this.shakeAmp * k * 0.6;
      if (this.shakeT <= 0) {
        this.shakeAmp = 0;
        this.sx = this.sy = 0;
      }
      this.onShake();
    }

    const alive = this.ps.length || this.rings.length || this.flashA > 0.004 || this.shakeT > 0 || Math.abs(this.streakNow - this.streakShown) > 0.02;
    if (alive || this.streakNow > 0.05) {
      // A held streak glow is static: keep drawing only while it is still easing.
      if (alive) this.raf = requestAnimationFrame(this.frame);
    }
  };

  private drawStreak(c: CanvasRenderingContext2D) {
    const n = this.streakShown;
    const col = n >= 8 ? '#F4F0E8' : n >= 5 ? '#FFB834' : pal.accent;
    const a = clamp(0.035 * n, 0, 0.3);
    const depth = 14 + Math.min(n, 10) * 4;
    c.globalAlpha = a;
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
      [0, 0, 0, depth, 0, 0, this.w, depth],
      [0, this.h, 0, this.h - depth, 0, this.h - depth, this.w, depth],
      [0, 0, depth, 0, 0, 0, depth, this.h],
      [this.w, 0, this.w - depth, 0, this.w - depth, 0, depth, this.h],
    ]) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(rx, ry, rw, rh);
    }
    c.globalAlpha = 1;
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
  }
}
