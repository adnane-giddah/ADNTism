// 10 · PLUMB — straightness. Draw one stroke from one dot to the other, as straight as you can.
// Easy: a faint guide stays. Medium: the guide vanishes when you start. Hard: the guide and the far
// dot are shown for 1.2 s, then both vanish — you draw towards a remembered point.
import { circle, clamp, cross, easeOut, font, hair, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, primary } from '../core/input';
import { glow, neon, plate, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import { lineDistance, lineParam, validScore, type V } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

const SHOW_HARD = 1200;
const END_TOL = 8; // u: a stroke must start/finish this close to the dots
const MIN_SPAN = 0.9; // fraction of the segment the stroke must cover

export interface PlumbLine {
  a: V;
  b: V;
}

/** Endpoints in field units (field spans −50..50). Length 50–85 u, any direction on Hard. */
export function makePlumb(seed: number, level: Level): PlumbLine {
  const r = rng(seed);
  for (let i = 0; i < 1000; i++) {
    const len = r.range(50, 85);
    const ang = level === 'hard' ? r.range(0, Math.PI * 2) : level === 'easy' ? r.pick([0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) + r.range(-0.15, 0.15) : r.range(0, Math.PI * 2);
    const cx = r.range(-8, 8);
    const cy = r.range(-8, 8);
    const a = { x: cx - (Math.cos(ang) * len) / 2, y: cy - (Math.sin(ang) * len) / 2 };
    const b = { x: cx + (Math.cos(ang) * len) / 2, y: cy + (Math.sin(ang) * len) / 2 };
    if (Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y)) < 46) return { a, b };
  }
  return { a: { x: -35, y: 10 }, b: { x: 35, y: -10 } };
}

export interface PlumbMetrics {
  rms: number;
  maxDev: number;
  bow: number; // mean signed offset
  span: number; // fraction of [0,1] covered
  startMiss: number;
  endMiss: number;
  profile: { t: number; d: number }[];
}

/**
 * Score only the intended segment: points are projected onto A→B; the part outside [0,1] is ignored
 * (and reported), the rest is length-weighted. The stroke may go either way (A→B or B→A).
 */
export function analysePlumb(pts: V[], ln: PlumbLine): PlumbMetrics | null {
  if (pts.length < 2) return null;
  const s0 = pts[0];
  const s1 = pts[pts.length - 1];
  const fwd = Math.hypot(s0.x - ln.a.x, s0.y - ln.a.y) + Math.hypot(s1.x - ln.b.x, s1.y - ln.b.y);
  const rev = Math.hypot(s0.x - ln.b.x, s0.y - ln.b.y) + Math.hypot(s1.x - ln.a.x, s1.y - ln.a.y);
  const [from, to] = fwd <= rev ? [ln.a, ln.b] : [ln.b, ln.a];
  const bins = new Uint8Array(100);
  let w = 0;
  let e2 = 0;
  let e1 = 0;
  let maxDev = 0;
  const profile: { t: number; d: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len === 0) continue;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const t = lineParam(m, ln.a, ln.b);
    if (t < 0 || t > 1) continue;
    const d = lineDistance(m, ln.a, ln.b);
    w += len;
    e2 += len * d * d;
    e1 += len * d;
    maxDev = Math.max(maxDev, Math.abs(d));
    profile.push({ t, d });
    // mark covered fraction (interpolated)
    const t0 = clamp(lineParam(p, ln.a, ln.b), 0, 1);
    const t1 = clamp(lineParam(q, ln.a, ln.b), 0, 1);
    for (let k = Math.floor(Math.min(t0, t1) * 100); k <= Math.min(99, Math.floor(Math.max(t0, t1) * 100)); k++) bins[k] = 1;
  }
  if (w === 0) return null;
  return {
    rms: Math.sqrt(e2 / w),
    maxDev,
    bow: e1 / w,
    span: bins.reduce((a, b) => a + b, 0) / 100,
    startMiss: Math.hypot(s0.x - from.x, s0.y - from.y),
    endMiss: Math.hypot(s1.x - to.x, s1.y - to.y),
    profile: profile.sort((a, b) => a.t - b.t),
  };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let ln: PlumbLine = makePlumb(1, 'medium');
  let pts: V[] = [];
  let phase: 'look' | 'draw' | 'done' = 'look';
  let shownAt = 0;
  let doneAt = 0;
  let finTimer = 0;
  let hideTimer = 0;
  let m: PlumbMetrics | null = null;
  const hard = () => api.level === 'hard';

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const strip = H > 520 ? 80 : 0;
    const F = Math.max(140, Math.min(W - 32, H - 110 - strip));
    return { k: F / 100, F, cx: W / 2, cy: 70 + (H - 70 - strip) / 2 - 10, strip };
  };

  function show() {
    shownAt = performance.now();
    clearTimeout(hideTimer);
    if (hard()) hideTimer = window.setTimeout(() => stage.request(), SHOW_HARD + 40);
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    ln = makePlumb(seed, api.level);
    pts = [];
    m = null;
    phase = 'look';
    api.progress('');
    if (hard()) api.prompt('Remember where the second dot is. It disappears in a moment.', 'Then draw from ● to where it was — one straight stroke');
    else if (api.level === 'easy') api.prompt('Draw a straight line from one dot to the other.', 'The faint guide stays · one stroke');
    else api.prompt(api.firstTime ? 'Draw a straight line from one dot to the other. The guide vanishes as you start.' : 'Dot to dot. Straight.', 'One stroke, either direction');
    show();
    stage.request();
  }

  const guideVisible = (now: number) => {
    if (phase === 'done') return true;
    if (api.level === 'easy') return true;
    if (api.level === 'medium') return phase === 'look';
    return phase === 'look' && now - shownAt < SHOW_HARD;
  };
  const farDotVisible = (now: number) => phase === 'done' || !hard() || now - shownAt < SHOW_HARD;

  function end() {
    if (phase !== 'draw') return;
    const res = analysePlumb(pts, ln);
    const ok = res && validScore(res.rms) && res.span >= MIN_SPAN && res.startMiss <= END_TOL && res.endMiss <= END_TOL;
    if (!ok) {
      phase = 'look';
      pts = [];
      api.sfx.over();
      api.prompt(
        !res
          ? 'Draw from one dot to the other.'
          : res.startMiss > END_TOL
            ? 'Start on a dot.'
            : res.endMiss > END_TOL
              ? `You stopped ${res.endMiss.toFixed(0)} u from the other dot. Finish on it.`
              : `Only ${Math.round(res.span * 100)}% of the way. Go dot to dot.`,
        hard() ? 'That one didn’t count — look again' : 'That one didn’t count',
      );
      show();
      stage.request();
      return;
    }
    m = res!;
    phase = 'done';
    doneAt = performance.now();
    api.sfx.release();
    api.buzz(10);
    api.prompt('');
    const disp = m.rms.toFixed(2);
    const L = Math.hypot(ln.b.x - ln.a.x, ln.b.y - ln.a.y);
    const bowWord = Math.abs(m.bow) < 0.15 ? 'no consistent bow' : `a ${Math.abs(m.bow).toFixed(1)} u bow to one side`;
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: m!.rms,
          value: disp,
          unit: 'u',
          label: 'RMS distance from the true line',
          headline: disp === '0.00' ? 'Plumb straight.' : `Your stroke wandered ${disp} u from the true line on average, with ${bowWord}. Widest point: ${m!.maxDev.toFixed(1)} u.`,
          rows: [
            ['Widest deviation', m!.maxDev.toFixed(1) + ' u'],
            ['Bow (mean signed offset)', signed(m!.bow, 2) + ' u'],
            ['Segment covered', Math.round(m!.span * 100) + '%'],
            ['Start miss', m!.startMiss.toFixed(1) + ' u'],
            ['End miss', m!.endMiss.toFixed(1) + ' u'],
            ['Line length', L.toFixed(1) + ' u'],
          ],
          accuracy: 1 - m!.rms / L,
          perfect: disp === '0.00',
          near: m!.rms < (hard() ? 0.8 : 0.4),
          share: [`PLUMB · ${api.level} — one straight stroke, dot to dot`, `RMS ${disp} u`],
        }),
      api.motion() ? 800 : 0,
    );
    stage.request();
  }

  const toField = (x: number, y: number): V => {
    const { k, cx, cy } = layout();
    return { x: (x - cx) / k, y: (y - cy) / k };
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e) || phase === 'done') return;
    capture(stage.canvas, e.pointerId);
    phase = 'draw';
    clearTimeout(hideTimer);
    const p = stage.pt(e);
    pts = [toField(p.x, p.y)];
    api.prompt('');
    api.sfx.tick();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    if (phase !== 'draw' || !primary(e)) return;
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = stage.pt(ev);
      pts.push(toField(p.x, p.y));
    }
    stage.request();
  };
  const onUp = (e: PointerEvent) => primary(e) && end();
  const onCancel = (e: PointerEvent) => {
    if (phase !== 'draw' || !primary(e)) return;
    phase = 'look';
    pts = [];
    api.prompt('Stroke interrupted — it didn’t count.', 'Try again');
    show();
    stage.request();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onCancel);
  stage.canvas.style.cursor = 'crosshair';

  stage.draw = (now) => {
    const c = stage.ctx;
    const { k, F, cx, cy, strip } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = false;

    // Field
    const x0 = cx - F / 2;
    const y0 = cy - F / 2;
    plate(c, x0, y0, F, F, 14);
    for (const [a, b] of [
      [x0, y0],
      [x0 + F, y0],
      [x0, y0 + F],
      [x0 + F, y0 + F],
    ])
      cross(c, a, b, 5, pal.ink3);

    const done = phase === 'done';
    const gv = guideVisible(now);
    if (gv) {
      const faint = api.level === 'easy' && phase === 'draw';
      line(c, X(ln.a.x), Y(ln.a.y), X(ln.b.x), Y(ln.b.y), done ? pal.accent : faint ? pal.line : pal.ink3, done ? 1.5 : 1.25, done ? [5, 5] : [3, 4]);
    }
    if (hard() && phase === 'look') {
      if (now - shownAt < SHOW_HARD) {
        const left = 1 - (now - shownAt) / SHOW_HARD;
        line(c, x0, y0 + F + 12, x0 + F * left, y0 + F + 12, pal.signal, 2);
        more = true;
      }
    }
    // Dots: two pins in the paper.
    const pin = (x: number, y: number) => {
      softShadow(c, x + 1, y + 4, 7, 2.5, 1.3);
      sphere(c, x, y, 6, pal.ink);
    };
    if (phase !== 'done' && pts.length === 0) {
      glow(c, X(ln.a.x), Y(ln.a.y), 34, pal.accent, 0.9);
      if (farDotVisible(now)) glow(c, X(ln.b.x), Y(ln.b.y), 34, pal.accent, 0.6);
    }
    pin(X(ln.a.x), Y(ln.a.y));
    if (farDotVisible(now)) pin(X(ln.b.x), Y(ln.b.y));

    // Stroke
    if (pts.length > 1) {
      neon(c, (cc) => pts.forEach((p, i) => (i ? cc.lineTo(X(p.x), Y(p.y)) : cc.moveTo(X(p.x), Y(p.y)))), done ? pal.ink : pal.accent, 2.5, phase === 'draw' ? 14 : 4);
      if (phase === 'draw') {
        const tp = pts[pts.length - 1];
        glow(c, X(tp.x), Y(tp.y), 30, pal.accent, 0.9);
        circle(c, X(tp.x), Y(tp.y), 4, undefined, pal.ink);
      }
    }

    // Reveal: deviation spikes, widest point, profile strip
    if (done && m) {
      const rp = api.motion() ? easeOut((now - doneAt) / 600) : 1;
      if (rp < 1) more = true;
      c.globalAlpha = rp;
      const dx = ln.b.x - ln.a.x;
      const dy = ln.b.y - ln.a.y;
      const L = Math.hypot(dx, dy);
      const nx = -dy / L;
      const ny = dx / L;
      let lastT = -1;
      let widest = m.profile[0];
      for (const s of m.profile) {
        if (Math.abs(s.d) > Math.abs(widest.d)) widest = s;
        if (s.t - lastT < 0.02) continue;
        lastT = s.t;
        const bx = ln.a.x + dx * s.t;
        const by = ln.a.y + dy * s.t;
        // lineDistance is positive on the (−dy, dx) side in screen coordinates
        line(c, X(bx), Y(by), X(bx + nx * s.d), Y(by + ny * s.d), pal.signal, 1);
      }
      if (widest) {
        const bx = ln.a.x + dx * widest.t;
        const by = ln.a.y + dy * widest.t;
        tag(c, `${Math.abs(widest.d).toFixed(1)} u`, X(bx + nx * widest.d * 1.6), Y(by + ny * widest.d * 1.6), pal.signal, 11);
      }
      c.globalAlpha = 1;

      if (strip) {
        const sy = stage.h - strip / 2 - 6;
        const Ls = Math.max(72, cx - Math.min(stage.w * 0.4, 360));
        const Rs = stage.w - Ls;
        const maxE = Math.max(1, ...m.profile.map((s) => Math.abs(s.d)));
        const sc = (strip / 2 - 12) / maxE;
        c.globalAlpha = rp;
        plate(c, Ls - 12, sy - strip / 2 - 6, Rs - Ls + 24, strip + 4, 12);
        hair(c, Ls, sy, Rs, sy, pal.ink, [3, 3]);
        text(c, 'YOUR DEVIATION, END TO END', Ls, sy - strip / 2 + 8, font.mono(9, 500), pal.ink3, 'left');
        text(c, `±${maxE.toFixed(1)} u`, Rs, sy - strip / 2 + 8, font.mono(9, 500), pal.ink3, 'right');
        if (m.profile.length > 1) {
          c.beginPath();
          c.moveTo(Ls + m.profile[0].t * (Rs - Ls), sy);
          for (const s of m.profile) c.lineTo(Ls + s.t * (Rs - Ls), sy - s.d * sc);
          c.lineTo(Ls + m.profile[m.profile.length - 1].t * (Rs - Ls), sy);
          c.closePath();
          c.fillStyle = pal.signalSoft;
          c.fill();
        }
        c.beginPath();
        m.profile.forEach((s, i) => {
          const x = Ls + s.t * (Rs - Ls);
          const y = sy - s.d * sc;
          if (i) c.lineTo(x, y);
          else c.moveTo(x, y);
        });
        c.strokeStyle = pal.signal;
        c.lineWidth = 1.5;
        c.stroke();
        c.globalAlpha = 1;
      }
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      clearTimeout(hideTimer);
      stage.canvas.style.cursor = '';
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onCancel);
    },
  };
};

export default factory;
