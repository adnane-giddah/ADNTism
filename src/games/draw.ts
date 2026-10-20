// 04 · DRAW — shape memory. See a shape; draw it from memory in one stroke.
// Easy: the ring stays faintly visible. Medium: it vanishes when you start.
// Hard: a tilted ellipse, shown for 1.5 s, then it and its centre vanish on their own.
import { circle, clamp, cross, easeOut, font, hair, line, pal, tag, text, TAU } from '../core/draw';
import { signed } from '../core/format';
import { angularCoverage, validScore } from '../core/scoring';
import { capture, primary } from '../core/input';
import { alpha, glow, plate } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

type P = { x: number; y: number }; // field units, centre = (0,0), field spans −50..50
export interface Shape {
  x: number;
  y: number;
  a: number; // semi-axis along the tilt
  b: number; // semi-axis across it
  rot: number; // radians
  /** Shapes mode: a regular polygon with this many sides (circumradius a). Absent = ellipse. */
  sides?: number;
}

/** Polygon corners (Shapes mode). */
export function corners(s: Shape): P[] {
  const n = s.sides ?? 0;
  return Array.from({ length: n }, (_, i) => {
    const t = s.rot - Math.PI / 2 + (i / n) * TAU;
    return { x: s.x + Math.cos(t) * s.a, y: s.y + Math.sin(t) * s.a };
  });
}
const SHOW_HARD = 1500;

/** Points along the shape (dense), for distance queries and drawing. */
export function outline(s: Shape, n = 720): P[] {
  if (s.sides) {
    // Even spacing along the perimeter.
    const cs = corners(s);
    const per = Math.floor(n / cs.length);
    return cs.flatMap((a, i) => {
      const b = cs[(i + 1) % cs.length];
      return Array.from({ length: per }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / per, y: a.y + ((b.y - a.y) * k) / per }));
    });
  }
  const c = Math.cos(s.rot);
  const sn = Math.sin(s.rot);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * TAU;
    const u = Math.cos(t) * s.a;
    const v = Math.sin(t) * s.b;
    return { x: s.x + u * c - v * sn, y: s.y + u * sn + v * c };
  });
}

/** Signed distance (outside > 0) from p to the shape outline. */
export function signedDist(p: P, s: Shape, ol: P[]) {
  let best = Infinity;
  for (const q of ol) {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) best = d;
  }
  if (s.sides) {
    // Ray casting: inside a polygon.
    const cs = corners(s);
    let inside = false;
    for (let i = 0, j = cs.length - 1; i < cs.length; j = i++) {
      const a = cs[i];
      const b = cs[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return Math.sqrt(best) * (inside ? -1 : 1);
  }
  const c = Math.cos(-s.rot);
  const sn = Math.sin(-s.rot);
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const u = dx * c - dy * sn;
  const v = dx * sn + dy * c;
  const inside = (u / s.a) ** 2 + (v / s.b) ** 2 < 1;
  return Math.sqrt(best) * (inside ? -1 : 1);
}

/**
 * Shapes mode: a square or a triangle instead of a ring. Easy: upright. Medium: turned at random.
 * Hard: turned, and shown for 1.5 s only (like Hard's ellipse).
 */
export function makePolygon(seed: number, level: Level): Shape {
  const r = rng(seed ^ 0x7f4a7c15);
  const sides = r.pick([3, 4]);
  const a = r.range(18, 34);
  const rot = level === 'easy' ? (sides === 4 ? Math.PI / 4 : 0) : r.range(0, TAU);
  return { x: r.range(-8, 8), y: r.range(-6, 6), a, b: a, rot, sides };
}

export function makeShape(seed: number, level: Level): Shape {
  const r = rng(seed);
  if (level === 'hard') {
    const a = r.range(22, 38);
    const b = a * r.range(0.45, 0.75);
    return { x: r.range(-8, 8), y: r.range(-6, 6), a, b, rot: r.range(0, Math.PI) };
  }
  const R = r.range(14, 36);
  return { x: r.range(-10, 10), y: r.range(-8, 8), a: R, b: R, rot: 0 };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let shape: Shape = { x: 0, y: 0, a: 30, b: 30, rot: 0 };
  let ol: P[] = [];
  let pts: P[] = [];
  let phase: 'look' | 'draw' | 'reveal' | 'done' = 'look';
  let shownAt = 0;
  let revealAt = 0;
  let hideAt = 0;
  let finTimer = 0;
  let hideTimer = 0;
  let metrics: { rms: number; offset: number; closure: number; sweep: number; samples: { a: number; e: number }[] } | null = null;
  const isRing = () => shape.a === shape.b && !shape.sides;
  const polyName = () => (shape.sides === 3 ? 'triangle' : 'square');

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const strip = H > 520 ? 90 : 0;
    const F = Math.max(140, Math.min(W - 32, H - 110 - strip));
    return { k: F / 100, F, cx: W / 2, cy: 70 + (H - 70 - strip) / 2 - 10, strip };
  };

  /** Hard: the shape is only visible for a moment after (re)showing. */
  function show() {
    shownAt = performance.now();
    clearTimeout(hideTimer);
    if (api.level === 'hard') hideTimer = window.setTimeout(() => stage.request(), SHOW_HARD + 40);
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    shape = api.mode === 'shapes' ? makePolygon(seed, api.level) : makeShape(seed, api.level);
    ol = outline(shape);
    pts = [];
    metrics = null;
    phase = 'look';
    api.progress('');
    if (api.mode === 'mirror') api.prompt(api.level === 'easy' ? 'Trace the ring — but your pen is mirrored left–right.' : 'Remember the ring. Your pen will be mirrored.', 'Move left and the line goes right · one stroke, all the way round');
    else if (shape.sides) api.prompt(`Study the ${polyName()}. Then draw it from memory — corners, size, turn.`, api.level === 'hard' ? 'You get a second and a half' : 'One stroke, all the way round');
    else if (api.level === 'hard') api.prompt('Watch. You get a second and a half.', 'Then draw the ellipse — tilt, size and place');
    else if (api.level === 'easy') api.prompt('Trace the ring, all the way round, in one stroke.', 'It stays faintly visible');
    else api.prompt(api.firstTime ? 'Look at the ring. It disappears the moment you start drawing.' : 'Remember it.', 'Then draw it — all the way round, one stroke');
    show();
    stage.request();
  }

  const visibleNow = (now: number) => phase === 'look' && (api.level !== 'hard' || now - shownAt < SHOW_HARD);

  function analyse() {
    let wsum = 0;
    let e2 = 0;
    let esum = 0;
    let sweep = 0;
    const samples: { a: number; e: number }[] = [];
    let prevA = Math.atan2(pts[0].y - shape.y, pts[0].x - shape.x);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      // Weight every sample by stroke length so slow and fast sections count equally.
      const w = Math.hypot(b.x - a.x, b.y - a.y);
      const e = signedDist({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, shape, ol);
      e2 += w * e * e;
      esum += w * e;
      wsum += w;
      const ang = Math.atan2(b.y - shape.y, b.x - shape.x);
      let da = ang - prevA;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      sweep += da;
      prevA = ang;
      samples.push({ a: sweep, e });
    }
    if (wsum <= 0) return null;
    const s = pts[0];
    const t = pts[pts.length - 1];
    return { rms: Math.sqrt(e2 / wsum), offset: esum / wsum, closure: Math.hypot(s.x - t.x, s.y - t.y), sweep: Math.abs(sweep), samples };
  }

  function end() {
    if (phase !== 'draw') return;
    const m = pts.length > 8 ? analyse() : null;
    // Coverage is checked separately from sweep: a short, accurate arc must not pass as a full shape.
    const coverage = angularCoverage(pts, shape);
    if (!m || !validScore(m.rms) || m.sweep < (330 * Math.PI) / 180 || coverage < 0.9) {
      phase = 'look';
      pts = [];
      api.sfx.over();
      api.prompt(
        m && coverage < 0.9 && m.sweep >= (330 * Math.PI) / 180
          ? `Your stroke only covered ${Math.round(coverage * 100)}% of the directions round the centre. Go all the way.`
          : m
            ? `Only ${Math.round((m.sweep * 180) / Math.PI)}° of the way round. Go all the way.`
            : 'Draw all the way around the shape.',
        api.level === 'hard' ? 'That one didn’t count — watch again' : 'That one didn’t count — the ring is back',
      );
      show();
      stage.request();
      return;
    }
    metrics = m;
    phase = 'reveal';
    revealAt = performance.now();
    api.sfx.release();
    api.buzz(10);
    api.prompt('');
    const disp = m.rms.toFixed(2);
    const deg = Math.round((((shape.rot * 180) / Math.PI) % 180 + 180) % 180);
    const rows: [string, string][] = shape.sides
      ? [
          ['True side', (2 * shape.a * Math.sin(Math.PI / shape.sides)).toFixed(1) + ' u'],
          ['Turn', Math.round((((shape.rot * 180) / Math.PI) % (360 / shape.sides) + 360 / shape.sides) % (360 / shape.sides)) + '°'],
          ['Your average offset', signed(m.offset, 1) + ' u'],
        ]
      : isRing()
      ? [
          ['True radius', shape.a.toFixed(1) + ' u'],
          ['Your average offset', signed(m.offset, 1) + ' u'],
        ]
      : [
          ['True axes', `${(shape.a * 2).toFixed(1)} × ${(shape.b * 2).toFixed(1)} u`],
          ['Tilt', deg + '°'],
          ['Your average offset', signed(m.offset, 1) + ' u'],
        ];
    rows.push(['Closure gap', m.closure.toFixed(1) + ' u'], ['Swept', Math.round((m.sweep * 180) / Math.PI) + '°'], ['Coverage', Math.round(coverage * 100) + '% of directions']);
    finTimer = window.setTimeout(
      () => {
        phase = 'done';
        api.finish({
          score: m.rms,
          value: disp,
          unit: 'u',
          label: `RMS distance from the ${shape.sides ? polyName() : isRing() ? 'ring' : 'ellipse'}`,
          headline:
            Math.abs(m.offset) > m.rms * 0.6
              ? `On average you drew ${Math.abs(m.offset).toFixed(1)} u ${m.offset > 0 ? 'outside' : 'inside'} it — memory, more than shape.`
              : `Right size. The wobble cost you most of the ${disp} u.`,
          rows,
          accuracy: 1 - m.rms / shape.b,
          perfect: disp === '0.00',
          near: m.rms < (api.level === 'hard' ? 1.2 : 0.6),
          share: [`DRAW · ${api.level} — ${shape.sides ? 'a ' + polyName() : isRing() ? 'a ring' : 'a tilted ellipse'} from memory`, `RMS ${disp} u`],
        });
      },
      api.motion() ? 900 : 0,
    );
    stage.request();
  }

  const toField = (x: number, y: number): P => {
    const { k, cx, cy } = layout();
    const p = { x: (x - cx) / k, y: (y - cy) / k };
    hand = p;
    // Mirror hand: the pen lands reflected left–right through the shape's centre.
    return api.mode === 'mirror' ? { x: 2 * shape.x - p.x, y: p.y } : p;
  };
  let hand: P | null = null;

  const onDown = (e: PointerEvent) => {
    if (!primary(e) || phase === 'reveal' || phase === 'done') return;
    capture(stage.canvas, e.pointerId);
    phase = 'draw';
    hideAt = performance.now();
    clearTimeout(hideTimer);
    const p = stage.pt(e);
    pts = [toField(p.x, p.y)];
    api.prompt('');
    api.sfx.tick();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    if (phase !== 'draw' || !primary(e)) return;
    // Coalesced events: every sample the hardware delivered, not just one per frame.
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = stage.pt(ev);
      pts.push(toField(p.x, p.y));
    }
    stage.request();
  };
  const onUp = (e: PointerEvent) => primary(e) && end();
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  const onCancel = (e: PointerEvent) => {
    if (phase !== 'draw' || !primary(e)) return;
    phase = 'look';
    pts = [];
    api.prompt('Stroke interrupted — it didn’t count.', 'Try again');
    show();
    stage.request();
  };
  stage.canvas.addEventListener('pointercancel', onCancel);
  stage.canvas.style.cursor = 'crosshair';

  const strokeShape = (c: CanvasRenderingContext2D, X: (u: number) => number, Y: (u: number) => number, color: string, w: number, dash?: number[]) => {
    c.beginPath();
    ol.forEach((q, i) => (i ? c.lineTo(X(q.x), Y(q.y)) : c.moveTo(X(q.x), Y(q.y))));
    c.closePath();
    c.setLineDash(dash ?? []);
    c.strokeStyle = color;
    c.lineWidth = w;
    c.stroke();
    c.setLineDash([]);
  };

  stage.draw = (now) => {
    const c = stage.ctx;
    const { k, F, cx, cy, strip } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = false;

    // Field frame
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

    const reveal = phase === 'reveal' || phase === 'done';
    const hard = api.level === 'hard';
    // Centre: always visible below Hard; on Hard only while the shape is.
    if (!hard || visibleNow(now) || reveal) cross(c, X(shape.x), Y(shape.y), 9, pal.ink, 1.25, 3);

    if (visibleNow(now)) {
      // The model, lifted off the paper by a faint shadow.
      strokeShape(c, (u) => X(u) + 1.5, (u) => Y(u) + 2.5, pal.shade, 3);
      strokeShape(c, X, Y, pal.ink, 2);
      if (hard) {
        // A thin countdown bar under the field: how long you have left to look.
        const left = 1 - (now - shownAt) / SHOW_HARD;
        line(c, x0, y0 + F + 12, x0 + F * left, y0 + F + 12, pal.signal, 2);
        more = true;
      }
    } else if (phase === 'look' && hard) {
      text(c, 'gone — draw it', cx, cy, font.mono(11, 500), pal.ink3, 'center', 'middle');
    } else if (phase === 'draw') {
      if (api.level === 'easy') strokeShape(c, X, Y, pal.line, 1.5);
      else if (api.motion() && !hard) {
        const f = 1 - clamp((now - hideAt) / 90, 0, 1);
        if (f > 0) {
          c.globalAlpha = f;
          strokeShape(c, X, Y, pal.ink, 2);
          c.globalAlpha = 1;
          more = true;
        }
      }
    }

    const rp = reveal ? (api.motion() ? easeOut((now - revealAt) / 600) : 1) : 0;
    if (reveal && rp < 1) more = true;

    if (reveal && metrics) {
      c.globalAlpha = rp;
      strokeShape(c, X, Y, alpha(pal.ink, 0.85), 1.5, [5, 5]);
      // Error spikes: from each stroke point to the nearest point on the shape, every few degrees.
      let lastA = -1e9;
      for (let i = 1; i < pts.length; i++) {
        const s = metrics.samples[i - 1]?.a ?? 0;
        if (Math.abs(s - lastA) < 0.07) continue;
        lastA = s;
        const p = pts[i];
        let best = ol[0];
        let bd = Infinity;
        for (const q of ol) {
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        line(c, X(best.x), Y(best.y), X(p.x), Y(p.y), pal.signal, 1);
      }
      if (shape.sides) {
        // Corners, so a rounded or skewed corner is easy to spot.
        for (const q of corners(shape)) circle(c, X(q.x), Y(q.y), 3.5, pal.ink2, undefined, 1.5);
      } else if (isRing()) {
        const ang = -Math.PI / 4;
        line(c, X(shape.x), Y(shape.y), X(shape.x + Math.cos(ang) * shape.a), Y(shape.y + Math.sin(ang) * shape.a), pal.ink3, 1, [2, 3]);
        tag(c, `r ${shape.a.toFixed(1)}`, X(shape.x + Math.cos(ang) * shape.a * 0.55), Y(shape.y + Math.sin(ang) * shape.a * 0.55), pal.ink2, 10);
      } else {
        const ca = Math.cos(shape.rot);
        const sa = Math.sin(shape.rot);
        line(c, X(shape.x - ca * shape.a), Y(shape.y - sa * shape.a), X(shape.x + ca * shape.a), Y(shape.y + sa * shape.a), pal.ink3, 1, [2, 3]);
        line(c, X(shape.x + sa * shape.b), Y(shape.y - ca * shape.b), X(shape.x - sa * shape.b), Y(shape.y + ca * shape.b), pal.ink3, 1, [2, 3]);
      }
      c.globalAlpha = 1;
    }

    // Stroke
    if (pts.length > 1) {
      c.lineJoin = 'round';
      c.lineCap = 'round';
      if (reveal && metrics && metrics.samples.length >= pts.length - 1) {
        // Heat map: each stretch of your line coloured by how far it strayed — cyan on the line, amber, coral.
        // Thresholds from the level's star targets (absolute), so a great drawing really does glow cyan.
        const st = api.stars?.();
        const maxE = Math.max(0.5, ...metrics.samples.map((s) => Math.abs(s.e)));
        const [t1, t2] = st ? [st[2] * 1.5, st[0] * 1.5] : [maxE * 0.33, maxE * 0.66];
        for (let i = 1; i < pts.length; i++) {
          const e = Math.abs(metrics.samples[i - 1]?.e ?? 0);
          c.strokeStyle = e < t1 ? pal.accent : e < t2 ? '#FFB834' : pal.signal;
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(X(pts[i - 1].x), Y(pts[i - 1].y));
          c.lineTo(X(pts[i].x), Y(pts[i].y));
          c.stroke();
        }
      } else {
        // The pen: a luminous line, brighter while it is moving.
        c.save();
        c.shadowColor = alpha(pal.accent, 0.7);
        c.shadowBlur = phase === 'draw' ? 14 : 6;
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
        c.strokeStyle = pal.accent;
        c.lineWidth = 2.5;
        c.stroke();
        c.restore();
      }
      circle(c, X(pts[0].x), Y(pts[0].y), 3.5, pal.accent, pal.paper, 1.5);
      // The pen tip, lit while you draw.
      if (phase === 'draw') {
        const tp = pts[pts.length - 1];
        glow(c, X(tp.x), Y(tp.y), 30, pal.accent, 0.9);
        circle(c, X(tp.x), Y(tp.y), 4, undefined, pal.ink);
        // Mirror hand: where your hand really is, and the mirror line between it and the pen.
        if (api.mode === 'mirror' && hand) {
          circle(c, X(hand.x), Y(hand.y), 6, alpha(pal.ink, 0.35), undefined, 1.25, [2, 2]);
          hair(c, X(shape.x), Y(shape.y) - 60 * k, X(shape.x), Y(shape.y) + 60 * k, alpha('#FFB834', 0.35), [4, 6]);
        }
      }
    }

    // Unwrapped strip: your distance from the shape, all the way round.
    if (strip && reveal && metrics) {
      const sy = stage.h - strip / 2 - 6;
      const L = Math.max(72, cx - Math.min(stage.w * 0.4, 360));
      const R = stage.w - L;
      const maxE = Math.max(2, ...metrics.samples.map((s) => Math.abs(s.e)));
      const sc = (strip / 2 - 12) / maxE;
      const total = Math.max(metrics.sweep, 1e-6);
      c.globalAlpha = rp;
      plate(c, L - 12, sy - strip / 2 - 6, R - L + 24, strip + 4, 12);
      hair(c, L, sy, R, sy, pal.ink, [3, 3]);
      text(c, 'YOUR LINE, ALL THE WAY ROUND', L, sy - strip / 2 + 8, font.mono(9, 500), pal.ink3, 'left');
      text(c, `±${maxE.toFixed(1)} u`, R, sy - strip / 2 + 8, font.mono(9, 500), pal.ink3, 'right');
      const sx = (s: { a: number }) => L + (Math.abs(s.a) / total) * (R - L) * rp;
      // The error band: shaded between your line and the shape.
      if (metrics.samples.length > 1) {
        c.beginPath();
        c.moveTo(sx(metrics.samples[0]), sy);
        for (const s of metrics.samples) c.lineTo(sx(s), sy - s.e * sc);
        c.lineTo(sx(metrics.samples[metrics.samples.length - 1]), sy);
        c.closePath();
        c.fillStyle = pal.signalSoft;
        c.fill();
      }
      c.beginPath();
      metrics.samples.forEach((s, i) => {
        const x = sx(s);
        const y = sy - s.e * sc;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.strokeStyle = pal.signal;
      c.lineWidth = 1.5;
      c.stroke();
      text(c, 'outside', L - 6, sy - 10, font.mono(9), pal.ink3, 'right', 'middle');
      text(c, 'inside', L - 6, sy + 10, font.mono(9), pal.ink3, 'right', 'middle');
      c.globalAlpha = 1;
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
