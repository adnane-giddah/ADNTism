/**
 * How much a big stage magnifies its drawing. Experiments are drawn for a bench of about 1240 × 760 CSS px;
 * on a larger stage (big monitors, zoomed-out browsers) everything is scaled up so the apparatus fills the
 * bench instead of floating small in the middle. Small stages are never shrunk.
 */
export function stageScale(w: number, h: number) {
  return Math.max(1, Math.min(2.4, Math.min(w / 1240, h / 760)));
}

/**
 * A DPR-aware canvas that fills its host, redraws on demand, and cleans up after itself.
 * `draw(t)` returns true while it wants more frames (animations), false when idle — so
 * idle experiments cost nothing. `w`, `h` and `pt()` are in logical px (CSS px ÷ k).
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  /** Logical-to-CSS scale (≥ 1). */
  k = 1;
  /** Presentational screen-shake offset (CSS px), set by the stage effects layer. */
  shakeX = 0;
  shakeY = 0;
  /** Narrowest logical width a game can lay out in; below it the drawing is scaled down to fit (phones). */
  private minW = 0;
  draw: (t: number) => boolean | void = () => false;
  onResize: () => void = () => {};
  private raf = 0;
  private ro: ResizeObserver;
  private live = false;
  private cssW = 0;
  private cssH = 0;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(host);
    this.fit();
    document.addEventListener('visibilitychange', this.onVis);
    // Canvas text uses web fonts; redraw once they arrive.
    void document.fonts?.ready.then(() => this.request());
  }

  private onVis = () => {
    if (!document.hidden) this.request();
  };

  fit() {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.k = this.minW && w < this.minW ? w / this.minW : stageScale(w, h);
    // DOM overlays on the stage (prompt, judgements) scale with the drawing.
    this.host.style.setProperty('--stage-k', String(this.k));
    this.w = Math.round(w / this.k);
    this.h = Math.round(h / this.k);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.onResize();
    this.request();
  }

  /** Lay out at least `px` logical pixels wide (narrower screens scale the drawing down instead). */
  setMinWidth(px: number) {
    this.minW = px;
    this.cssW = 0;
    this.fit();
  }

  /** Ask for a frame. Cheap to call many times. */
  request() {
    if (this.raf || !this.live) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  start() {
    this.live = true;
    this.request();
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (!this.live) return;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Screen shake moves only what is drawn; pointer mapping (pt) stays on the untouched canvas rect.
    const s = this.dpr * this.k;
    c.setTransform(s, 0, 0, s, this.shakeX * this.dpr, this.shakeY * this.dpr);
    const more = this.draw(t);
    if (more && !document.hidden) this.request();
  };

  /** Pointer position in logical px relative to the canvas. */
  pt(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.k, y: (e.clientY - r.top) / this.k };
  }

  destroy() {
    this.live = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.canvas.remove();
  }
}
