// 09 · CENTER — centre of mass. Place points outside the ring; their (weighted) average must land on the cross.
// Easy: 3 points, running centre shown. Medium: 4 points. Hard: 5 weighted points, the cross vanishes.
import { bracket, circle, clamp, cross, easeInOut, easeOut, font, hair, line, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { glow, plate, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

type P = { x: number; y: number };
const CFG: Record<Level, { weights: number[]; excl: number }> = {
  easy: { weights: [1, 1, 1], excl: 16 },
  medium: { weights: [1, 1, 1, 1], excl: 20 },
  hard: { weights: [1, 2, 1, 3, 1], excl: 28 },
};

/**
 * Target and rules. The cross stays within ±16 u so that, with a ring of at most 28 u, every
 * direction leaves room inside the ±50 u field: a perfect final correction is always reachable
 * for some choice of earlier points.
 */
export function makeCenter(seed: number, level: Level) {
  const r = rng(seed);
  const cfg = CFG[level];
  return { W: cfg.weights, EXCL: cfg.excl, T: { x: r.range(-16, 16), y: r.range(-14, 14) } };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let T: P = { x: 0, y: 0 };
  let W: number[] = [1, 1, 1, 1];
  let EXCL = 20;
  let pts: P[] = [];
  let phase: 'place' | 'done' = 'place';
  let doneAt = 0;
  let rejectAt = -1e9;
  let rejectP: P | null = null;
  let cursor: P = { x: 0, y: 0 };
  let kb = false;
  const keys = new Set<string>();
  let lastT = 0;
  let finTimer = 0;
  let landed = false;

  const N = () => W.length;
  const hard = () => api.level === 'hard';
  const centre = (ps: P[], ws: number[]) => {
    const m = ws.slice(0, ps.length).reduce((a, b) => a + b, 0) || 1;
    return {
      x: ps.reduce((a, p, i) => a + p.x * ws[i], 0) / m,
      y: ps.reduce((a, p, i) => a + p.y * ws[i], 0) / m,
    };
  };

  const layout = () => {
    const Wd = stage.w;
    const H = stage.h;
    const F = Math.max(160, Math.min(Wd - 32, H - 120));
    return { k: F / 100, F, cx: Wd / 2, cy: 64 + (H - 64 - 30) / 2 };
  };

  function promptNext() {
    const i = pts.length;
    if (hard()) {
      if (i === 0) api.prompt('Five points, weighted ×1 ×2 ×1 ×3 ×1. Remember where ✛ is — it disappears after your first point.', 'The ring vanishes too');
      else if (i === N() - 1) api.prompt('Last point — weight ×1. It must correct everything.', 'From memory');
      else api.prompt(`Next point weighs ×${W[i]}.`, `${N() - i} left`);
      return;
    }
    if (i === 0)
      api.prompt(
        api.firstTime || api.level === 'easy' ? `Place ${N()} points anywhere outside the ring. Their average position must land on ✛.` : `${N()} points. Average on ✛.`,
        api.level === 'easy' ? 'The running centre is shown as you go' : 'The last point has to make up for the others',
      );
    else if (i === N() - 1) api.prompt('Last point. It decides everything.', '');
    else api.prompt('');
  }

  function reset(seed: number) {
    landed = false;
    clearTimeout(finTimer);
    ({ W, EXCL, T } = makeCenter(seed, api.level));
    pts = [];
    phase = 'place';
    kb = false;
    cursor = { x: T.x + EXCL + 10, y: T.y };
    keys.clear();
    api.progress(`0 / ${N()}`);
    promptNext();
    stage.request();
  }

  function place(p: P) {
    if (phase !== 'place') return;
    if (Math.abs(p.x) > 50 || Math.abs(p.y) > 50) return;
    if (Math.hypot(p.x - T.x, p.y - T.y) < EXCL) {
      rejectAt = performance.now();
      rejectP = p;
      api.sfx.over();
      api.buzz([8, 30, 8]);
      api.prompt('Too close to the cross.', 'Points inside the ring don’t count');
      stage.request();
      return;
    }
    pts.push(p);
    api.sfx.soft();
    api.buzz(6);
    api.progress(`${pts.length} / ${N()}`);
    if (pts.length === N()) finish();
    else promptNext();
    stage.request();
  }

  function finish() {
    phase = 'done';
    doneAt = performance.now();
    api.prompt('');
    const g = centre(pts, W);
    const err = Math.hypot(g.x - T.x, g.y - T.y);
    const total = W.reduce((a, b) => a + b, 0);
    const wl = W[N() - 1];
    const rest = pts.slice(0, -1).reduce((a, p, i) => ({ x: a.x + p.x * W[i], y: a.y + p.y * W[i] }), { x: 0, y: 0 });
    const ideal = { x: (total * T.x - rest.x) / wl, y: (total * T.y - rest.y) / wl };
    const lastOff = Math.hypot(ideal.x - pts[N() - 1].x, ideal.y - pts[N() - 1].y);
    // Feasibility: the earlier points may have pushed the needed correction off the field.
    const unreachable = Math.abs(ideal.x) > 50 || Math.abs(ideal.y) > 50 || Math.hypot(ideal.x - T.x, ideal.y - T.y) < EXCL;
    const disp = err.toFixed(1);
    api.sfx.release();
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: err,
          value: disp,
          unit: 'u',
          label: 'centre-of-mass error',
          headline:
            disp === '0.0'
              ? 'The average landed on the cross.'
              : `The ${W.some((w) => w !== 1) ? 'weighted ' : ''}average landed ${disp} u from ✛. Your last point was ${lastOff.toFixed(1)} u from where it needed to be.`,
          rows: [
            ['Centre error', disp + ' u'],
            ['Ideal last point', unreachable ? 'not placeable — earlier points left no exact fix' : `(${ideal.x.toFixed(1)}, ${ideal.y.toFixed(1)}) u`],
            ['Last point off by', lastOff.toFixed(1) + ' u'],
            ['Weights', W.map((w) => '×' + w).join(' ')],
            ['Leverage of the last point', `1 : ${total / wl - 1}`],
          ],
          perfect: disp === '0.0',
          near: err < 0.6,
          share: [`CENTER · ${api.level} — ${N()} points, one average`, `${disp} u from the cross`],
        }),
      api.motion() ? 1300 : 0,
    );
  }

  const toField = (x: number, y: number): P => {
    const { k, cx, cy } = layout();
    return { x: (x - cx) / k, y: (y - cy) / k };
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    kb = false;
    const p = stage.pt(e);
    place(toField(p.x, p.y));
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const p = stage.pt(e);
    cursor = toField(p.x, p.y);
    kb = false;
    stage.request();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.style.cursor = 'none';
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || phase !== 'place') return;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        kb = true;
        keys.add(e.key);
        lastT = performance.now();
        stage.request();
      } else if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        kb = true;
        place({ ...cursor });
      }
    }),
    listen('keyup', (e) => keys.delete(e.key)),
    listen('blur', () => keys.clear()),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const { k, F, cx, cy } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = false;

    if (keys.size) {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const sp = 30;
      if (keys.has('ArrowRight')) cursor.x += sp * dt;
      if (keys.has('ArrowLeft')) cursor.x -= sp * dt;
      if (keys.has('ArrowDown')) cursor.y += sp * dt;
      if (keys.has('ArrowUp')) cursor.y -= sp * dt;
      cursor.x = clamp(cursor.x, -50, 50);
      cursor.y = clamp(cursor.y, -50, 50);
      more = true;
    }

    // Field
    const x0 = cx - F / 2;
    const y0 = cy - F / 2;
    plate(c, x0, y0, F, F, 14);
    for (let i = 1; i < 10; i++) {
      hair(c, x0 + (F * i) / 10, y0, x0 + (F * i) / 10, y0 + F, pal.line2);
      hair(c, x0, y0 + (F * i) / 10, x0 + F, y0 + (F * i) / 10, pal.line2);
    }

    const done = phase === 'done';
    // Hard: the target and its ring disappear after the first point (until the reveal).
    const targetVisible = !hard() || pts.length === 0 || done;
    const shake = api.motion() ? Math.sin((now - rejectAt) / 20) * 5 * Math.max(0, 1 - (now - rejectAt) / 300) : 0;
    if (now - rejectAt < 300) more = true;
    if (targetVisible) {
      glow(c, X(T.x), Y(T.y), 40, pal.accent, 0.8);
      circle(c, X(T.x) + shake, Y(T.y), EXCL * k, now - rejectAt < 500 ? pal.signal : pal.ink3, pal.line2, 1, [3, 4]);
      cross(c, X(T.x), Y(T.y), 12, pal.accent, 1.75);
    }
    if (rejectP && now - rejectAt < 600) {
      c.globalAlpha = 1 - (now - rejectAt) / 600;
      circle(c, X(rejectP.x), Y(rejectP.y), 6, pal.signal, undefined, 1.5);
      c.globalAlpha = 1;
      more = true;
    }

    // Easy: the running centre of the points so far
    if (api.level === 'easy' && !done && pts.length >= 2) {
      const g = centre(pts, W);
      circle(c, X(g.x), Y(g.y), 4, pal.ink2, pal.paper, 1.5);
      tag(c, `centre of ${pts.length}`, X(g.x), Y(g.y) + 16, pal.ink3, 10);
    }

    // Points
    const t = done ? (api.motion() ? (now - doneAt) / 1000 : 2) : 0;
    if (done && t < 1.6) more = true;
    const g = centre(pts, W);
    pts.forEach((p, i) => {
      if (done) {
        const m = easeInOut(clamp(t / 0.7, 0, 1));
        line(c, X(p.x), Y(p.y), X(p.x + (g.x - p.x) * m), Y(p.y + (g.y - p.y) * m), pal.ink3, 1, [2, 3]);
      }
      const r = 6 + (W[i] - 1) * 3;
      // Placed points are small weights: a shadow and a shaded ball.
      softShadow(c, X(p.x), Y(p.y) + r * 0.7, r * 1.1, r * 0.35, 1.2);
      sphere(c, X(p.x), Y(p.y), r, pal.ink);
      text(c, W[i] > 1 ? `×${W[i]}` : String(i + 1), X(p.x), Y(p.y), font.mono(9, 600), pal.paper, 'center', 'middle');
    });

    if (done) {
      const m = easeOut(clamp((t - 0.6) / 0.5, 0, 1));
      if (m > 0) {
        const err = Math.hypot(g.x - T.x, g.y - T.y);
        const st = api.stars?.();
        const gcol = st && err <= st[2] ? pal.accent : pal.signal;
        if (!landed) {
          landed = true;
          api.fx.burst(X(g.x), Y(g.y), gcol, st && err <= st[0] ? 26 : 12, 200, 2.2);
          api.fx.ring(X(g.x), Y(g.y), gcol, 60, 2, 0.6);
        }
        c.globalAlpha = m;
        glow(c, X(g.x), Y(g.y), 36, gcol, m);
        circle(c, X(g.x), Y(g.y), 6, gcol, pal.paper, 2.5);
        if (Math.hypot(X(g.x) - X(T.x), Y(g.y) - Y(T.y)) > 3) bracket(c, X(T.x), Y(T.y), X(g.x), Y(g.y), pal.signal, 4, 1.5);
        tag(c, `${Math.hypot(g.x - T.x, g.y - T.y).toFixed(1)} u`, X(g.x) + 30, Y(g.y) - 16, pal.signal, 11);
        c.globalAlpha = 1;
      }
      // The lever rule, shown not told: centre of the others, ✛, and where the last point belonged.
      const m2 = easeOut(clamp((t - 1.0) / 0.5, 0, 1));
      if (m2 > 0) {
        const others = centre(pts.slice(0, -1), W);
        const wl = W[N() - 1];
        const wr = W.slice(0, -1).reduce((a, b) => a + b, 0);
        const ideal = { x: T.x + ((T.x - others.x) * wr) / wl, y: T.y + ((T.y - others.y) * wr) / wl };
        c.globalAlpha = m2;
        line(c, X(others.x), Y(others.y), X(ideal.x), Y(ideal.y), pal.ink3, 1, [4, 4]);
        circle(c, X(others.x), Y(others.y), 4, pal.ink2, pal.paper, 1.5);
        tag(c, `centre of 1–${N() - 1}`, X(others.x), Y(others.y) + 16, pal.ink2, 10);
        circle(c, X(ideal.x), Y(ideal.y), 8, pal.ink2, undefined, 1.5, [2, 2]);
        tag(c, `ideal ${N()}`, X(ideal.x), Y(ideal.y) - 18, pal.ink2, 10);
        tag(c, String(wl), X((others.x + T.x) / 2), Y((others.y + T.y) / 2), pal.ink3, 10);
        tag(c, String(wr), X((T.x + ideal.x) / 2), Y((T.y + ideal.y) / 2), pal.ink3, 10);
        c.globalAlpha = 1;
      }
    }

    // Custom cursor (mouse / keyboard). On Hard it never turns red — that would give the cross away.
    if (!done && (kb || matchMedia('(pointer: fine)').matches)) {
      const inside = !hard() && Math.hypot(cursor.x - T.x, cursor.y - T.y) < EXCL;
      cross(c, X(cursor.x), Y(cursor.y), 9, inside ? pal.signal : pal.ink2, 1, 3);
      if (!done && W[pts.length] > 1) text(c, `×${W[pts.length]}`, X(cursor.x) + 12, Y(cursor.y) - 12, font.mono(10, 500), pal.ink2, 'left');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      stage.canvas.style.cursor = '';
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
    },
  };
};

export default factory;
