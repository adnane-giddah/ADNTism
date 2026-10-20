// Building blocks of the app's "Obsidian Telemetry" interface: HUD frames with corner reticles, mono labels,
// sharp buttons, segmented switches, metric tiles, sparklines and live previews of each game's mechanic.
import { h, icon } from '../core/dom';
import { font, pal, text } from '../core/draw';
import { stats } from '../core/records';
import { reducedMotion } from '../core/settings';
import type { GameMeta } from '../core/types';
import { previews } from '../pages/previews';

type Child = Node | string | null | undefined | false;

/** A telemetry panel: surface-frame plate, hairline border, four corner reticles. */
export function frame(cls: string, ...children: Child[]) {
  return h('div', { class: `a-frame ${cls}` }, h('i', { class: 'rt tl' }), h('i', { class: 'rt tr' }), h('i', { class: 'rt bl' }), h('i', { class: 'rt br' }), ...(children.filter(Boolean) as Node[]));
}

/** Micro label: uppercase JetBrains Mono, wide tracking. */
export const label = (s: string, tone = '') => h('span', { class: `a-label ${tone}` }, s);

export function btn(textOrNode: string, run: () => void, o: { kind?: 'primary' | 'ghost' | 'coral' | 'gold'; icon?: string; kbd?: string; cls?: string; disabled?: boolean } = {}) {
  const b = h(
    'button',
    { class: `a-btn ${o.kind ?? 'ghost'} ${o.cls ?? ''}`, type: 'button' },
    o.icon ? icon(o.icon) : null,
    h('span', null, textOrNode),
    o.kbd ? h('kbd', null, o.kbd) : null,
  );
  b.disabled = !!o.disabled;
  b.addEventListener('click', () => !b.disabled && run());
  return b;
}

/** Segmented switch (difficulty, scoring mode). */
export function segmented<T extends string>(opts: { v: T; label: string; tone?: string; locked?: boolean; title?: string }[], value: T, onPick: (v: T) => void) {
  const wrap = h('div', { class: 'a-seg', role: 'radiogroup' });
  const paint = (cur: T) =>
    wrap.replaceChildren(
      ...opts.map((o) => {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.v === cur), class: `${o.tone ?? ''} ${o.locked ? 'locked' : ''}`, title: o.title ?? '' }, o.label, o.locked ? h('small', null, ' ⌁ locked') : null);
        b.addEventListener('click', () => {
          onPick(o.v);
        });
        return b;
      }),
    );
  paint(value);
  return { el: wrap, paint };
}

export function metric(name: string, value: string, unit: string, sub: string, tone = '') {
  return h('div', { class: `a-metric ${tone}` }, label(name), h('div', { class: 'mv' }, h('b', null, value), unit ? h('small', null, unit) : null), sub ? h('p', null, sub) : null);
}

/** Recent ranked scores as a teal trace (better = up; errors on a log scale). */
export function sparkline(cv: HTMLCanvasElement, g: GameMeta, rid: string) {
  const s = stats(rid, g.better);
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width;
  const H = r.height;
  const data = s.history;
  c.strokeStyle = pal.line;
  c.setLineDash([2, 4]);
  c.beginPath();
  c.moveTo(0, H / 2);
  c.lineTo(W, H / 2);
  c.stroke();
  c.setLineDash([]);
  if (data.length < 2) {
    text(c, data.length ? 'ONE RANKED RUN SO FAR' : 'NO RANKED RUNS YET', 6, H / 2 - 6, font.mono(9, 600), pal.ink3);
    return;
  }
  const useLog = g.better === 'lower' && data.every((v) => v > 0);
  const f = (v: number) => (useLog ? Math.log10(v) : v);
  const vals = data.map(f);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const y = (v: number) => {
    const n = (f(v) - lo) / (hi - lo);
    return 4 + (g.better === 'lower' ? n : 1 - n) * (H - 10);
  };
  const x = (i: number) => (i / (data.length - 1)) * (W - 8) + 4;
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(45,212,191,0.28)');
  grad.addColorStop(1, 'rgba(45,212,191,0)');
  c.beginPath();
  data.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
  c.lineTo(x(data.length - 1), H);
  c.lineTo(x(0), H);
  c.closePath();
  c.fillStyle = grad;
  c.fill();
  c.beginPath();
  data.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
  c.strokeStyle = pal.accent;
  c.lineWidth = 1.5;
  c.lineJoin = 'round';
  c.stroke();
  const li = data.length - 1;
  c.fillStyle = pal.signal;
  c.fillRect(x(li) - 3, y(data[li]) - 3, 6, 6);
}

/** One animation loop for every visible game preview on a screen. */
export class PreviewLoop {
  private cvs = new Map<HTMLCanvasElement, string>();
  private visible = new Set<HTMLCanvasElement>();
  private sizes = new Map<HTMLCanvasElement, { w: number; h: number; dpr: number }>();
  private raf = 0;
  private t0 = performance.now();
  private ro = new ResizeObserver((es) => {
    for (const e of es) {
      const cv = e.target as HTMLCanvasElement;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(e.contentRect.width * dpr);
      cv.height = Math.round(e.contentRect.height * dpr);
      this.sizes.set(cv, { w: e.contentRect.width, h: e.contentRect.height, dpr });
    }
    this.kick();
  });
  private io = new IntersectionObserver((es) => {
    for (const e of es) e.isIntersecting ? this.visible.add(e.target as HTMLCanvasElement) : this.visible.delete(e.target as HTMLCanvasElement);
    this.kick();
  });

  add(id: string) {
    const cv = h('canvas', { 'aria-hidden': 'true' });
    this.cvs.set(cv, id);
    this.ro.observe(cv);
    this.io.observe(cv);
    return cv;
  }

  private frame = (now: number) => {
    this.raf = 0;
    const still = reducedMotion();
    const t = still ? 2.6 : (now - this.t0) / 1000;
    for (const cv of this.visible) {
      const sz = this.sizes.get(cv);
      if (!sz) continue;
      const c = cv.getContext('2d')!;
      c.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
      c.clearRect(0, 0, sz.w, sz.h);
      const id = this.cvs.get(cv)!;
      previews[id]?.(c, sz.w, sz.h, t + (id.length % 3) * 0.7);
    }
    if (!still && this.visible.size && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  };

  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
  }
}
