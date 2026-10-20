// 03 · CLOSE THE LOOP — vector closure. Draw, on a separate pad, the one arrow that brings the path home.
import { arrow, bracket, circle, clamp, easeInOut, font, hair, hatch, pal, tag, text } from '../core/draw';
import { capture, gameKey, listen, primary } from '../core/input';
import { glow, knob, plate } from '../core/materials';
import { rng } from '../core/rng';
import { padToField as padToFieldPure } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

type V = { x: number; y: number };
interface Round {
  vecs: V[];
  origin: V; // in field units (field spans −50..50)
  scale: number; // pad vector × scale = field vector
  rot: number; // radians; pad rotated clockwise by this
  mirror: boolean; // pad flipped left↔right
}

const ROUNDS = 5;
type Spec = { n: number; scale: number; rot: number; mirror?: boolean };
const SPECS: Record<Level, Spec[]> = {
  easy: [
    { n: 2, scale: 1, rot: 0 },
    { n: 2, scale: 1, rot: 0 },
    { n: 3, scale: 1, rot: 0 },
    { n: 3, scale: 1, rot: 0 },
    { n: 3, scale: 1, rot: 0 },
  ],
  medium: [
    { n: 2, scale: 1, rot: 0 },
    { n: 3, scale: 1, rot: 0 },
    { n: 4, scale: 1, rot: 0 },
    { n: 3, scale: 2, rot: 0 },
    { n: 3, scale: 1, rot: Math.PI / 2 },
  ],
  // Hard: long paths, and every pad is scaled AND turned by an awkward angle. One is a mirror.
  hard: [
    { n: 5, scale: 2, rot: 0.645772 },
    { n: 5, scale: 1.5, rot: 2.495821 },
    { n: 6, scale: 2, rot: -1.239184, mirror: true },
    { n: 5, scale: 1.25, rot: 3.682645 },
    { n: 6, scale: 2, rot: 1.710423 },
  ],
};
let SPEC = SPECS.medium;

export function makeRounds(seed: number, level: Level): Round[] {
  const r = rng(seed);
  SPEC = SPECS[level];
  return SPEC.map((sp) => {
    for (let tries = 0; tries < 3000; tries++) {
      const vecs: V[] = [];
      let a = r.range(0, Math.PI * 2);
      for (let i = 0; i < sp.n; i++) {
        a += r.range(0.7, 2.2) * r.sign();
        const len = sp.n >= 5 ? r.range(15, 30) : r.range(20, 40);
        vecs.push({ x: Math.cos(a) * len, y: Math.sin(a) * len });
      }
      const pts: V[] = [{ x: 0, y: 0 }];
      for (const v of vecs) pts.push({ x: pts[pts.length - 1].x + v.x, y: pts[pts.length - 1].y + v.y });
      const end = pts[pts.length - 1];
      const d = Math.hypot(end.x, end.y);
      const maxD = 44;
      if (d < 16 || d > maxD) continue;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w > 84 || h > 84) continue;
      const origin = { x: -(Math.max(...xs) + Math.min(...xs)) / 2, y: -(Math.max(...ys) + Math.min(...ys)) / 2 };
      return { vecs, origin, scale: sp.scale, rot: sp.rot, mirror: !!sp.mirror };
    }
    return { vecs: [{ x: 30, y: 0 }, { x: 0, y: -25 }], origin: { x: -15, y: 12 }, scale: sp.scale, rot: sp.rot, mirror: !!sp.mirror };
  });
}

/** A field direction as it appears on the pad (inverse of padToField, without scale). */
function fieldDirOnPad(f: V, rd: Round): V {
  const c = Math.cos(rd.rot);
  const s = Math.sin(rd.rot);
  const v = { x: f.x * c - f.y * s, y: f.x * s + f.y * c };
  return rd.mirror ? { x: -v.x, y: v.y } : v;
}

/** Map a vector drawn on the pad to the field (pure version in core/scoring). */
const padToField = (v0: V, rd: Round): V => padToFieldPure(v0, rd);

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: Round[] = [];
  let ri = 0;
  let tip: V | null = null; // pad-space units
  let phase: 'aim' | 'drag' | 'reveal' | 'done' = 'aim';
  let gaps: number[] = [];
  let needs: number[] = [];
  let committed: V | null = null;
  let revealAt = 0;
  let finTimer = 0;
  const keys = new Set<string>();
  let lastT = 0;

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 76;
    const bottom = 46;
    const gap = 20;
    const side = W >= H * 1.15;
    let F: number;
    if (side) F = Math.min((W - gap * 3) / 2, H - top - bottom);
    else F = Math.min(W - gap * 2, (H - top - bottom - gap) / 2);
    F = Math.max(120, F);
    const k = F / 100;
    let field: V;
    let pad: V;
    if (side) {
      const total = F * 2 + gap * 1.5;
      field = { x: (W - total) / 2 + F / 2, y: top + (H - top - bottom) / 2 };
      pad = { x: field.x + F + gap * 1.5, y: field.y };
    } else {
      const total = F * 2 + gap;
      field = { x: W / 2, y: top + (H - top - bottom - total) / 2 + F / 2 };
      pad = { x: W / 2, y: field.y + F + gap };
    }
    return { F, k, field, pad };
  };

  function promptRound() {
    api.progress(`${ri + 1} / ${ROUNDS}`);
    const rd = rounds[ri];
    if (api.level === 'hard') {
      const parts = [`pad ×${(1 / rd.scale).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} size`, `turned ${Math.round((((rd.rot * 180) / Math.PI) % 360 + 360) % 360)}°`];
      if (rd.mirror) parts.push('mirrored');
      api.prompt(`${rd.vecs.length} arrows. Memorise them — they vanish when you touch the pad.`, parts.join(' · '));
      return;
    }
    if (ri === 0 && api.firstTime) api.prompt('Draw the arrow that leads from the end of the path back to ○.', 'Drag on the pad · release to send it');
    else if (rd.scale === 2) api.prompt('This pad is half size. Your arrow will count double.', 'Pad × 2');
    else if (rd.rot) api.prompt('This pad is turned a quarter clockwise. Mind the arrow marked “up”.', 'Pad rotated 90°');
    else api.prompt(ri === 0 ? 'Close the loop.' : `${rd.vecs.length} arrows. Close the loop.`, 'Drag on the pad');
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = makeRounds(seed, api.level);
    ri = 0;
    tip = null;
    committed = null;
    gaps = [];
    needs = [];
    phase = 'aim';
    keys.clear();
    promptRound();
    stage.request();
  }

  const endOf = (rd: Round) => rd.vecs.reduce((p, v) => ({ x: p.x + v.x, y: p.y + v.y }), { ...rd.origin });

  function commit() {
    if (!tip || (phase !== 'aim' && phase !== 'drag')) return;
    const rd = rounds[ri];
    committed = padToField(tip, rd);
    const end = endOf(rd);
    const hit = { x: end.x + committed.x, y: end.y + committed.y };
    const gap = Math.hypot(hit.x - rd.origin.x, hit.y - rd.origin.y);
    const { k, field } = layout();
    api.judge(gap, { x: field.x + rd.origin.x * k, y: field.y + rd.origin.y * k - 34 });
    gaps.push(gap);
    needs.push(Math.hypot(end.x - rd.origin.x, end.y - rd.origin.y));
    phase = 'reveal';
    revealAt = performance.now();
    api.sfx.release();
    api.buzz(10);
    window.setTimeout(() => {
      if (phase !== 'reveal' && phase !== 'done') return;
      if (gap < 0.5) api.sfx.near();
    }, 500);
    api.prompt(`${gap.toFixed(1)} u from home`, ri < ROUNDS - 1 ? 'Press the pad for the next path' : '');
    if (ri === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    ri++;
    tip = null;
    committed = null;
    phase = 'aim';
    promptRound();
  }

  function finish() {
    phase = 'done';
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const acc = 1 - gaps.reduce((a, g, i) => a + g / needs[i], 0) / gaps.length;
    const disp = mean.toFixed(1);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'u',
          label: 'mean closure gap',
          headline: disp === '0.0' ? 'Five loops, closed.' : `Your arrows stopped ${disp} u from home on average — ${(acc * 100).toFixed(1)}% closed.`,
          rows: [
            ...gaps.map((g, i) => [`Loop ${i + 1} · ${SPEC[i].n} arrows${SPEC[i].scale !== 1 ? ` · ×${SPEC[i].scale}` : ''}${SPEC[i].rot ? ` · ${Math.round((SPEC[i].rot * 180) / Math.PI)}°` : ''}${SPEC[i].mirror ? ' · mirror' : ''}`, g.toFixed(1) + ' u'] as [string, string]),
            ['Closure', (acc * 100).toFixed(1) + '%'],
          ],
          accuracy: acc,
          perfect: disp === '0.0',
          near: mean < 1.5,
          share: ['CLOSE THE LOOP — five paths, one arrow each', `mean gap ${disp} u`],
        }),
      api.motion() ? 1000 : 0,
    );
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  const padVec = (x: number, y: number): V => {
    const { k, pad } = layout();
    return { x: (x - pad.x) / k, y: (y - pad.y) / k };
  };
  const inPad = (x: number, y: number) => {
    const { F, pad } = layout();
    return Math.abs(x - pad.x) < F / 2 + 24 && Math.abs(y - pad.y) < F / 2 + 24;
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e) || phase === 'done') return;
    const p = stage.pt(e);
    if (!inPad(p.x, p.y)) return;
    if (phase === 'reveal') next();
    capture(stage.canvas, e.pointerId);
    phase = 'drag';
    tip = padVec(p.x, p.y);
    api.sfx.tick();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    const p = stage.pt(e);
    stage.canvas.style.cursor = inPad(p.x, p.y) && phase !== 'done' ? 'crosshair' : '';
    if (phase !== 'drag' || !primary(e)) return;
    tip = padVec(p.x, p.y);
    stage.request();
  };
  const onUp = (e: PointerEvent) => {
    if (phase !== 'drag' || !primary(e)) return;
    if (tip && Math.hypot(tip.x, tip.y) < 1) {
      phase = 'aim';
      tip = null;
      stage.request();
      return;
    }
    commit();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  const onCancel = (e: PointerEvent) => {
    if (phase !== 'drag' || !primary(e)) return;
    phase = 'aim';
    tip = null;
    stage.request();
  };
  stage.canvas.addEventListener('pointercancel', onCancel);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || phase === 'done') return;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (phase === 'reveal') next();
        if (!tip) tip = { x: 0, y: 0 };
        keys.add(e.key);
        lastT = performance.now();
        stage.request();
      } else if ((e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        if (phase === 'reveal') {
          next();
          stage.request();
        } else if (tip) commit();
      }
    }),
    listen('keyup', (e) => keys.delete(e.key)),
    listen('blur', () => keys.clear()),
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  stage.draw = (now) => {
    const c = stage.ctx;
    const { F, k, field, pad } = layout();
    const rd = rounds[ri];
    if (!rd) return false;
    let more = false;

    if (keys.size && tip && (phase === 'aim' || phase === 'drag')) {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const sp = 14;
      if (keys.has('ArrowRight')) tip.x += sp * dt;
      if (keys.has('ArrowLeft')) tip.x -= sp * dt;
      if (keys.has('ArrowDown')) tip.y += sp * dt;
      if (keys.has('ArrowUp')) tip.y -= sp * dt;
      more = true;
    }

    const FX = (u: number) => field.x + u * k;
    const FY = (u: number) => field.y + u * k;

    // Panels
    const panel = (cx: number, cy: number, label: string) => {
      const x0 = cx - F / 2;
      const y0 = cy - F / 2;
      // A graph-paper plate.
      plate(c, x0, y0, F, F, 12);
      for (let i = 1; i < 10; i++) {
        hair(c, x0 + (F * i) / 10, y0, x0 + (F * i) / 10, y0 + F, pal.line2);
        hair(c, x0, y0 + (F * i) / 10, x0 + F, y0 + (F * i) / 10, pal.line2);
      }
      text(c, label, x0, y0 - 8, font.mono(10, 500), pal.ink3, 'left');
    };
    panel(field.x, field.y, 'PATH');
    const padLabel = ['PAD'];
    if (rd.scale !== 1) padLabel.push(`YOUR ARROW × ${rd.scale}`);
    if (rd.rot) padLabel.push(`TURNED ${Math.round((((rd.rot * 180) / Math.PI) % 360 + 360) % 360)}°`);
    if (rd.mirror) padLabel.push('MIRRORED');
    panel(pad.x, pad.y, padLabel.join(' · '));
    // Hard: the whole path vanishes while you draw.
    const vanish = api.level === 'hard' && phase === 'drag';
    if (vanish) c.globalAlpha = 0;

    // Path
    let p = { ...rd.origin };
    const pts = [p];
    for (const v of rd.vecs) {
      const q = { x: p.x + v.x, y: p.y + v.y };
      arrow(c, FX(p.x), FY(p.y), FX(q.x), FY(q.y), pal.ink, 2, 10);
      p = q;
      pts.push(q);
    }
    const end = p;
    // Waypoints: where each leg turns.
    for (const q of pts.slice(1, -1)) circle(c, FX(q.x), FY(q.y), 2.5, undefined, pal.ink2);
    // Home ring, softly lit — the place the path must return to.
    glow(c, FX(rd.origin.x), FY(rd.origin.y), 40, pal.accent, 0.9);
    circle(c, FX(rd.origin.x), FY(rd.origin.y), 9, pal.accent, pal.paper, 1.75);
    circle(c, FX(rd.origin.x), FY(rd.origin.y), 2.5, undefined, pal.accent);
    text(c, 'HOME', FX(rd.origin.x), FY(rd.origin.y) - 18, font.mono(9, 600), pal.accent, 'center');
    circle(c, FX(end.x), FY(end.y), 3, undefined, pal.ink2);
    c.globalAlpha = 1;
    if (vanish) text(c, 'from memory', field.x, field.y, font.mono(11, 500), pal.ink3, 'center', 'middle');

    // Pad: centre, "up" marker, live arrow
    circle(c, pad.x, pad.y, 4, undefined, pal.ink);
    if (rd.rot || rd.scale !== 1 || rd.mirror) {
      // The field's "up" and "right" as seen inside the pad
      const L = F * 0.42;
      for (const [f, lbl, len] of [
        [{ x: 0, y: -1 }, 'UP', L],
        [{ x: 1, y: 0 }, 'RIGHT', L * 0.75],
      ] as const) {
        const d = fieldDirOnPad(f, rd);
        const ux = pad.x + d.x * len;
        const uy = pad.y + d.y * len;
        arrow(c, pad.x + d.x * (len - 24), pad.y + d.y * (len - 24), ux, uy, pal.ink3, 1.25, 7);
        tag(c, lbl, ux + d.x * 16, uy + d.y * 16, pal.ink3, 9);
      }
    }
    if (tip && (phase === 'aim' || phase === 'drag' || phase === 'reveal' || phase === 'done')) {
      const tx = pad.x + tip.x * k;
      const ty = pad.y + tip.y * k;
      const aiming = phase === 'drag' || phase === 'aim';
      if (aiming) glow(c, tx, ty, 40, pal.accent, phase === 'drag' ? 0.8 : 0.4);
      arrow(c, pad.x, pad.y, tx, ty, aiming ? pal.accent : pal.ink3, 2.25, 11);
      // The grip at the arrow's head (lit while you drag it).
      if (aiming) knob(c, tx, ty, 5, pal.accent, phase === 'drag');
      // Practice only: your arrow's components after the pad transform, in field units.
      if (api.practice && (phase === 'aim' || phase === 'drag')) {
        const f = padToField(tip, rd);
        tag(c, `→ ${f.x >= 0 ? '+' : '−'}${Math.abs(f.x).toFixed(1)}   ↓ ${f.y >= 0 ? '+' : '−'}${Math.abs(f.y).toFixed(1)} u`, pad.x, pad.y + F / 2 - 14, pal.ink2, 10);
      }
    } else if (phase === 'aim' && api.firstTime && api.motion()) {
      const t = (now % 2400) / 2400;
      const e = easeInOut(clamp(t * 1.6, 0, 1));
      c.globalAlpha = 1 - clamp((t - 0.7) * 3, 0, 1);
      arrow(c, pad.x, pad.y, pad.x + F * 0.22 * e, pad.y - F * 0.12 * e, pal.ink3, 1.5, 8, [4, 4]);
      c.globalAlpha = 1;
      more = true;
    }

    // Transport + reveal
    if (committed && (phase === 'reveal' || phase === 'done')) {
      const t = api.motion() ? (now - revealAt) / 700 : 1;
      if (t < 1.4) more = true;
      const m = easeInOut(clamp(t, 0, 1));
      // Fly from the pad into place
      const sx = pad.x;
      const sy = pad.y;
      const ex = FX(end.x);
      const ey = FY(end.y);
      const bx = sx + (ex - sx) * m;
      const by = sy + (ey - sy) * m;
      const drawn = tip!;
      const shown = { x: drawn.x + (committed.x - drawn.x) * m, y: drawn.y + (committed.y - drawn.y) * m };
      const hx = bx + shown.x * k;
      const hy = by + shown.y * k;
      if (m >= 1) {
        c.beginPath();
        pts.forEach((q, i) => (i ? c.lineTo(FX(q.x), FY(q.y)) : c.moveTo(FX(q.x), FY(q.y))));
        c.lineTo(hx, hy);
        c.closePath();
        c.fillStyle = hatch(c, pal.line, 7);
        c.fill();
      }
      arrow(c, bx, by, hx, hy, pal.signal, 2.25, 11);
      if (m >= 1) {
        const gap = gaps[gaps.length - 1];
        const ox = FX(rd.origin.x);
        const oy = FY(rd.origin.y);
        if (Math.hypot(hx - ox, hy - oy) > 4) bracket(c, hx, hy, ox, oy, pal.signal, 4, 1.5);
        tag(c, `${gap.toFixed(1)} u`, (hx + ox) / 2 + 22, (hy + oy) / 2 - 16, pal.signal, 12);
        // Ideal arrow ghost
        arrow(c, ex, ey, ox, oy, pal.accent, 1.25, 8, [3, 4]);
      }
    }

    // Round strip
    const sy2 = stage.h - 20;
    for (let i = 0; i < ROUNDS; i++) {
      const x = stage.w / 2 + (i - 2) * Math.min(64, stage.w / 7);
      if (i < gaps.length) text(c, gaps[i].toFixed(1), x, sy2, font.mono(11, 500), pal.ink, 'center');
      else text(c, i === ri ? '•' : '·', x, sy2, font.mono(12), i === ri ? pal.ink : pal.ink3, 'center');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onCancel);
    },
  };
};

export default factory;
