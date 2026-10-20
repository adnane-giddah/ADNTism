// 18 · MIRROR — tap where the reflection lands.
// A point ● and a mirror line. Its reflection is exact: p' = 2·foot − p, where foot is the perpendicular foot
// on the line. Hard reflects twice — across mirror 1, then mirror 2 — which is secretly a rotation by twice
// the angle between them. Score: mean distance from your tap to the true image, in u.
import { circle, clamp, cross, easeOut, font, hair, line, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { glow, neon, plate, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import { reflect, type V } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 6;

export interface MirrorRound {
  p: V;
  mirrors: { a: V; b: V }[];
  image: V;
  /** Transforms mode: a rotation round instead (centre, degrees clockwise). */
  rot?: { c: V; deg: number };
}

/** Rotate p about c by deg degrees clockwise (screen coordinates, y down). */
export function rotateAbout(p: V, c: V, deg: number): V {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/**
 * Transforms mode: rounds alternate reflections (as in the level) and rotations about a marked centre.
 * Easy: quarter and half turns. Medium: multiples of 30°. Hard: any angle from 25° to 155°, either way.
 */
export function makeTransforms(seed: number, level: Level): MirrorRound[] {
  const refl = makeMirror(seed, level);
  const r = rng(seed ^ 0x51ed27);
  return refl.map((rd, i) => {
    if (i % 2 === 0) return rd;
    for (let t = 0; t < 500; t++) {
      const c = { x: r.range(-15, 15), y: r.range(-15, 15) };
      const p = { x: r.range(-38, 38), y: r.range(-38, 38) };
      const deg = level === 'easy' ? r.pick([90, 180, 270]) : level === 'medium' ? r.pick([30, 60, 90, 120, 150, 210, 240, 270, 300, 330]) : r.sign() * r.range(25, 155);
      const image = rotateAbout(p, c, deg);
      if (Math.max(Math.abs(image.x), Math.abs(image.y)) > 42) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) < 14) continue;
      return { p, mirrors: [], image, rot: { c, deg } };
    }
    return rd;
  });
}

export const imageOf = (p: V, mirrors: { a: V; b: V }[]) => mirrors.reduce((q, m) => reflect(q, m.a, m.b), p);

function mirrorLine(r: ReturnType<typeof rng>, level: Level) {
  const ang = level === 'easy' ? r.pick([0, Math.PI / 2]) : r.range(0, Math.PI);
  const c = { x: r.range(-12, 12), y: r.range(-12, 12) };
  return { a: { x: c.x - Math.cos(ang) * 80, y: c.y - Math.sin(ang) * 80 }, b: { x: c.x + Math.cos(ang) * 80, y: c.y + Math.sin(ang) * 80 } };
}

export function makeMirror(seed: number, level: Level): MirrorRound[] {
  const r = rng(seed);
  const out: MirrorRound[] = [];
  while (out.length < ROUNDS) {
    const mirrors = level === 'hard' ? [mirrorLine(r, level), mirrorLine(r, level)] : [mirrorLine(r, level)];
    const p = { x: r.range(-40, 40), y: r.range(-40, 40) };
    const image = imageOf(p, mirrors);
    // Keep everything inside the field, and the image far enough from the point to need a real reflection.
    if (Math.max(Math.abs(image.x), Math.abs(image.y)) > 42) continue;
    if (Math.hypot(image.x - p.x, image.y - p.y) < 14) continue;
    if (level === 'hard') {
      const mid = reflect(p, mirrors[0].a, mirrors[0].b);
      const d1 = Math.atan2(mirrors[0].b.y - mirrors[0].a.y, mirrors[0].b.x - mirrors[0].a.x);
      const d2 = Math.atan2(mirrors[1].b.y - mirrors[1].a.y, mirrors[1].b.x - mirrors[1].a.x);
      // Angle between the two lines, in [0, π/2]; nearly parallel mirrors make a near-identity puzzle.
      const m = (((d2 - d1) % Math.PI) + Math.PI) % Math.PI;
      const between = Math.min(m, Math.PI - m);
      if (between < 0.35 || Math.max(Math.abs(mid.x), Math.abs(mid.y)) > 60) continue;
    }
    out.push({ p, mirrors, image });
  }
  return out;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: MirrorRound[] = [];
  let round = 0;
  let taps: V[] = [];
  let phase: 'aim' | 'reveal' | 'done' = 'aim';
  let revealAt = 0;
  let cursor: V = { x: 0, y: 0 };
  let kbAim = false;
  let finTimer = 0;
  const keys = new Set<string>();
  let fine = false;
  let lastK = 0;

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const F = Math.max(150, Math.min(W - 32, H - 120, 640));
    return { k: F / 100, F, cx: W / 2, cy: 70 + F / 2 };
  };
  const toField = (x: number, y: number): V => {
    const { k, cx, cy } = layout();
    return { x: (x - cx) / k, y: (y - cy) / k };
  };

  function promptRound() {
    api.progress(`${round + 1} / ${ROUNDS}`);
    const rot = rounds[round].rot;
    if (rot) {
      const d = Math.round(Math.abs(rot.deg));
      api.prompt(`Turn ● ${d}° ${rot.deg > 0 ? 'clockwise' : 'anticlockwise'} around ✛. Tap where it lands.`, 'A rotation keeps the distance to ✛ the same');
      return;
    }
    const two = rounds[round].mirrors.length > 1;
    api.prompt(two ? 'Reflect ● in mirror 1, then reflect that in mirror 2. Tap where it lands.' : 'Tap where ● appears in the mirror.', round === 0 && api.firstTime ? 'Tap once · keys: arrows move, Enter places' : two ? 'Order matters' : '');
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = api.mode === 'transforms' ? makeTransforms(seed, api.level) : makeMirror(seed, api.level);
    round = 0;
    taps = [];
    phase = 'aim';
    kbAim = false;
    cursor = { x: 0, y: 0 };
    keys.clear();
    promptRound();
    stage.request();
  }

  function place(p: V) {
    if (phase !== 'aim') return;
    const rd = rounds[round];
    taps.push(p);
    phase = 'reveal';
    revealAt = performance.now();
    const d = Math.hypot(p.x - rd.image.x, p.y - rd.image.y);
    {
      const { k, cx, cy } = layout();
      api.judge(d, { x: cx + rd.image.x * k, y: cy + rd.image.y * k - 36 });
    }
    if (d < 0.5) api.sfx.near();
    else api.sfx.release();
    api.buzz(8);
    api.prompt(`${d.toFixed(1)} u from the true image.`, round < ROUNDS - 1 ? 'Tap / Enter for the next' : '');
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    phase = 'aim';
    promptRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const errs = rounds.map((rd, i) => Math.hypot(taps[i].x - rd.image.x, taps[i].y - rd.image.y));
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const disp = mean.toFixed(1);
    // Along / across the mirror (one-mirror levels): distance error vs. sliding along the mirror.
    const rows: [string, string][] = errs.map((e, i) => [`Round ${i + 1}`, e.toFixed(1) + ' u']);
    if (api.level !== 'hard' && api.mode !== 'transforms') {
      let along = 0;
      let across = 0;
      rounds.forEach((rd, i) => {
        const m = rd.mirrors[0];
        const dx = m.b.x - m.a.x;
        const dy = m.b.y - m.a.y;
        const L = Math.hypot(dx, dy);
        const ex = taps[i].x - rd.image.x;
        const ey = taps[i].y - rd.image.y;
        along += Math.abs((ex * dx + ey * dy) / L);
        across += Math.abs((ex * -dy + ey * dx) / L);
      });
      rows.push(['Mean error along the mirror', (along / ROUNDS).toFixed(1) + ' u']);
      rows.push(['Mean error across it (distance)', (across / ROUNDS).toFixed(1) + ' u']);
    }
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'u',
          label: 'mean distance to the image',
          headline: disp === '0.0' ? 'Six perfect reflections.' : `Your taps landed ${disp} u from the true images on average. Worst: ${Math.max(...errs).toFixed(1)} u.`,
          rows,
          perfect: disp === '0.0',
          near: mean < 0.8,
          share: [`MIRROR · ${api.level} — tap where the reflection lands`, `${disp} u mean error`],
        }),
      api.motion() ? 700 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') return next();
    const p = stage.pt(e);
    kbAim = false;
    place(toField(p.x, p.y));
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.style.cursor = 'crosshair';
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e)) return;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (phase !== 'aim') return;
        kbAim = true;
        keys.add(e.key);
        lastK = performance.now();
        stage.request();
      } else if ((e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        if (phase === 'reveal') next();
        else if (phase === 'aim' && kbAim) place({ ...cursor });
      }
    }),
    listen('keyup', (e) => {
      fine = e.shiftKey;
      keys.delete(e.key);
    }),
    listen('blur', () => keys.clear()),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const { k, F, cx, cy } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = false;
    if (keys.size && phase === 'aim') {
      const dt = Math.min(0.05, (now - lastK) / 1000);
      lastK = now;
      const sp = fine ? 6 : 30;
      cursor = {
        x: clamp(cursor.x + ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * sp * dt, -50, 50),
        y: clamp(cursor.y + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * sp * dt, -50, 50),
      };
      more = true;
    }
    plate(c, cx - F / 2, cy - F / 2, F, F, 14);
    c.save();
    c.beginPath();
    c.rect(cx - F / 2, cy - F / 2, F, F);
    c.clip();
    if (api.level === 'easy') for (let u = -40; u <= 40; u += 10) {
      hair(c, X(u), Y(-50), X(u), Y(50), pal.line2);
      hair(c, X(-50), Y(u), X(50), Y(u), pal.line2);
    }
    rd.mirrors.forEach((m, i) => {
      // A silvered mirror: a dark backing and a bright glass face.
      const mx = X(m.b.x) - X(m.a.x);
      const my = Y(m.b.y) - Y(m.a.y);
      const ml = Math.hypot(mx, my) || 1;
      const nx = (-my / ml) * 2.2;
      const ny = (mx / ml) * 2.2;
      line(c, X(m.a.x) - nx, Y(m.a.y) - ny, X(m.b.x) - nx, Y(m.b.y) - ny, pal.line, 3);
      neon(c, (cc) => (cc.moveTo(X(m.a.x), Y(m.a.y)), cc.lineTo(X(m.b.x), Y(m.b.y))), pal.accent, 2.5, 14);
      line(c, X(m.a.x) + nx * 0.6, Y(m.a.y) + ny * 0.6, X(m.b.x) + nx * 0.6, Y(m.b.y) + ny * 0.6, pal.glass, 1);
      if (rd.mirrors.length > 1) {
        const t = 0.62 + i * 0.06;
        tag(c, `mirror ${i + 1}`, X(m.a.x + (m.b.x - m.a.x) * t), Y(m.a.y + (m.b.y - m.a.y) * t), pal.ink, 10);
      }
    });
    c.restore();
    if (rd.rot) {
      // Centre and direction of the turn.
      glow(c, X(rd.rot.c.x), Y(rd.rot.c.y), 26, pal.ink3, 0.9);
      cross(c, X(rd.rot.c.x), Y(rd.rot.c.y), 9, pal.ink, 2);
      const rr = Math.hypot(rd.p.x - rd.rot.c.x, rd.p.y - rd.rot.c.y) * k;
      const a0 = Math.atan2(rd.p.y - rd.rot.c.y, rd.p.x - rd.rot.c.x);
      const sweep = Math.sign(rd.rot.deg) * 0.5;
      c.beginPath();
      c.arc(X(rd.rot.c.x), Y(rd.rot.c.y), rr, Math.min(a0, a0 + sweep), Math.max(a0, a0 + sweep));
      c.strokeStyle = pal.ink3;
      c.lineWidth = 1.25;
      c.stroke();
      const ae = a0 + sweep;
      const ex = X(rd.rot.c.x) + Math.cos(ae) * rr;
      const ey = Y(rd.rot.c.y) + Math.sin(ae) * rr;
      const tx = -Math.sin(ae) * Math.sign(sweep);
      const ty = Math.cos(ae) * Math.sign(sweep);
      line(c, ex, ey, ex - tx * 8 + ty * 4, ey - ty * 8 - tx * 4, pal.ink3, 1.25);
      line(c, ex, ey, ex - tx * 8 - ty * 4, ey - ty * 8 + tx * 4, pal.ink3, 1.25);
      tag(c, `${Math.round(Math.abs(rd.rot.deg))}° ${rd.rot.deg > 0 ? '↻' : '↺'}`, X(rd.rot.c.x), Y(rd.rot.c.y) + 18, pal.ink, 10);
    }
    softShadow(c, X(rd.p.x), Y(rd.p.y) + 5, 7, 2.3, 1.1);
    sphere(c, X(rd.p.x), Y(rd.p.y), 6, pal.ink);
    if (phase === 'aim' && kbAim) cross(c, X(cursor.x), Y(cursor.y), 10, pal.accent, 1.5, 3);

    if (phase !== 'aim') {
      const tp = taps[round];
      const p = api.motion() ? easeOut((now - revealAt) / 450) : 1;
      if (p < 1) more = true;
      c.globalAlpha = p;
      if (rd.rot) {
        // Both radii and the swept angle: the image is as far from ✛ as ● was.
        line(c, X(rd.rot.c.x), Y(rd.rot.c.y), X(rd.p.x), Y(rd.p.y), pal.ink3, 1, [3, 3]);
        line(c, X(rd.rot.c.x), Y(rd.rot.c.y), X(rd.image.x), Y(rd.image.y), pal.ink3, 1, [3, 3]);
      } else if (rd.mirrors.length > 1) {
        const mid = reflect(rd.p, rd.mirrors[0].a, rd.mirrors[0].b);
        line(c, X(rd.p.x), Y(rd.p.y), X(mid.x), Y(mid.y), pal.ink3, 1, [3, 3]);
        line(c, X(mid.x), Y(mid.y), X(rd.image.x), Y(rd.image.y), pal.ink3, 1, [3, 3]);
        circle(c, X(mid.x), Y(mid.y), 4, pal.ink3, undefined, 1.25);
      } else if (!rd.rot) line(c, X(rd.p.x), Y(rd.p.y), X(rd.image.x), Y(rd.image.y), pal.ink3, 1, [3, 3]);
      // The reflection travels out to where it really lands.
      if (p < 1 && !rd.rot && rd.mirrors.length === 1) {
        const q = { x: rd.p.x + (rd.image.x - rd.p.x) * p, y: rd.p.y + (rd.image.y - rd.p.y) * p };
        glow(c, X(q.x), Y(q.y), 26, pal.accent, 0.9);
        circle(c, X(q.x), Y(q.y), 4, undefined, pal.accent);
      }
      glow(c, X(rd.image.x), Y(rd.image.y), 30, pal.accent, 0.8 * p);
      circle(c, X(rd.image.x), Y(rd.image.y), 6, pal.accent, undefined, 2);
      cross(c, X(tp.x), Y(tp.y), 8, pal.signal, 2);
      const d = Math.hypot(tp.x - rd.image.x, tp.y - rd.image.y);
      if (d * k > 3) line(c, X(tp.x), Y(tp.y), X(rd.image.x), Y(rd.image.y), pal.signal, 1.5);
      tag(c, `${d.toFixed(1)} u`, X((tp.x + rd.image.x) / 2), Y((tp.y + rd.image.y) / 2) - 12, pal.signal, 11);
      c.globalAlpha = 1;
    }
    const sy = stage.h - 14;
    for (let i = 0; i < ROUNDS; i++) {
      const x = stage.w / 2 + (i - (ROUNDS - 1) / 2) * 52;
      text(c, i < taps.length ? Math.hypot(taps[i].x - rounds[i].image.x, taps[i].y - rounds[i].image.y).toFixed(1) : i === round ? '•' : '·', x, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      stage.canvas.style.cursor = '';
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
