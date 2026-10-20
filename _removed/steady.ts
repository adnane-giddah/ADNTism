// 29 · STEADY HAND — follow a curved corridor from start to end without straying.
// Primary metric: length-weighted RMS distance from the corridor's centre line (u). Also reported: share of
// your path outside the corridor, how often you left it, the widest point, and (optional detail) "wobble" —
// your path length ÷ the corridor's length. A game result, not a medical or clinical measurement.
import { circle, clamp, cross, font, hair, line, pal, text } from '../core/draw';
import { capture, gameKey, listen, primary } from '../core/input';
import { rng } from '../core/rng';
import { type V } from '../core/scoring';
import { sensitivity, targetScale } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 3;
export const HALF_W: Record<Level, number> = { easy: 6, medium: 4, hard: 2.5 };

export interface SteadyPath {
  pts: V[]; // dense polyline
  cum: number[]; // cumulative length
  w: number; // corridor half-width
}

/** Catmull-Rom spline through control points, sampled densely. */
function spline(ctrl: V[], perSeg = 40): V[] {
  const out: V[] = [];
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(P[i - 1].x, P[i].x, P[i + 1].x, P[i + 2].x), y: f(P[i - 1].y, P[i].y, P[i + 1].y, P[i + 2].y) });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

export function makeSteady(seed: number, level: Level): SteadyPath[] {
  const r = rng(seed);
  return Array.from({ length: ROUNDS }, () => {
    const n = level === 'easy' ? 4 : level === 'medium' ? 6 : 8;
    const amp = level === 'easy' ? 18 : level === 'medium' ? 28 : 34;
    const ctrl: V[] = Array.from({ length: n }, (_, i) => ({ x: -40 + (80 * i) / (n - 1), y: r.range(-amp, amp) }));
    const pts = spline(ctrl).map((p) => ({ x: p.x, y: clamp(p.y, -42, 42) }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, cum, w: HALF_W[level] };
  });
}

/** Nearest point on the path: distance and arc-length position. */
export function nearestOnPath(path: SteadyPath, p: V) {
  let best = { d: Infinity, s: 0 };
  for (let i = 1; i < path.pts.length; i++) {
    const a = path.pts[i - 1];
    const b = path.pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1);
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best.d) best = { d, s: path.cum[i - 1] + Math.sqrt(L2) * t };
  }
  return best;
}

export function analyseSteady(path: SteadyPath, stroke: V[]) {
  const total = path.cum[path.cum.length - 1];
  let w = 0;
  let e2 = 0;
  let e1 = 0;
  let out = 0;
  let maxD = 0;
  let exits = 0;
  let wasOut = false;
  let progress = 0;
  const profile: { s: number; d: number }[] = [];
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const nm = nearestOnPath(path, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    w += len;
    e2 += len * nm.d * nm.d;
    e1 += len * nm.d;
    maxD = Math.max(maxD, nm.d);
    const isOut = nm.d > path.w;
    if (isOut) out += len;
    if (isOut && !wasOut) exits++;
    wasOut = isOut;
    progress = Math.max(progress, nm.s);
    profile.push(nm);
  }
  if (w === 0) return null;
  return {
    rms: Math.sqrt(e2 / w),
    mean: e1 / w,
    maxD,
    outside: out / w,
    exits,
    progress: progress / total,
    wobble: w / total,
    startMiss: Math.hypot(stroke[0].x - path.pts[0].x, stroke[0].y - path.pts[0].y),
    endMiss: Math.hypot(stroke[stroke.length - 1].x - path.pts[path.pts.length - 1].x, stroke[stroke.length - 1].y - path.pts[path.pts.length - 1].y),
    profile,
  };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let paths: SteadyPath[] = [];
  let round = 0;
  let stroke: V[] = [];
  /** Per segment: outside the corridor? Computed once when the point arrives, not every frame. */
  let outs: boolean[] = [];
  const addPoint = (p: V) => {
    const a = stroke[stroke.length - 1];
    stroke.push(p);
    if (a) outs.push(nearestOnPath(path(), { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 }).d > path().w);
  };
  let phase: 'ready' | 'trace' | 'reveal' | 'done' = 'ready';
  let results: NonNullable<ReturnType<typeof analyseSteady>>[] = [];
  let finTimer = 0;
  let kb = false;
  const keys = new Set<string>();
  let fine = false;
  let lastK = 0;

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const strip = H > 560 ? 70 : 0;
    const F = Math.max(160, Math.min(W - 32, H - 96 - strip, 640));
    return { k: F / 100, F, cx: W / 2, cy: 70 + F / 2, strip };
  };
  const toField = (x: number, y: number): V => {
    const { k, cx, cy } = layout();
    return { x: (x - cx) / k, y: (y - cy) / k };
  };
  const path = () => paths[round];
  const endTol = () => path().w + 4 * targetScale();

  function setRound() {
    stroke = [];
    phase = 'ready';
    kb = false;
    keys.clear();
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('Trace the corridor from ● to ◎ without leaving it.', 'Press on ● and draw · keys: Space starts an arrow-key cursor');
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    paths = makeSteady(seed, api.level);
    round = 0;
    results = [];
    setRound();
    stage.request();
  }

  function begin(p: V) {
    phase = 'trace';
    stroke = [p];
    outs = [];
    api.prompt('');
    api.sfx.tick();
  }

  function end() {
    if (phase !== 'trace') return;
    const res = analyseSteady(path(), stroke);
    const ok = res && res.progress >= 0.95 && res.endMiss <= endTol();
    if (!ok) {
      phase = 'ready';
      stroke = [];
      api.sfx.over();
      api.prompt(res ? `Only ${Math.round(res.progress * 100)}% of the way — finish at ◎.` : 'Draw from ● to ◎.', 'That one didn’t count');
      stage.request();
      return;
    }
    results.push(res!);
    phase = 'reveal';
    api.sfx.release();
    api.prompt(`RMS ${res!.rms.toFixed(2)} u · ${Math.round(res!.outside * 100)}% outside · left the corridor ${res!.exits}×.`, round < ROUNDS - 1 ? 'Tap for the next corridor' : '');
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, r) => a + r.rms, 0) / results.length;
    const disp = mean.toFixed(2);
    const outside = results.reduce((a, r) => a + r.outside, 0) / results.length;
    const rows: [string, string][] = results.map((r, i) => [`Corridor ${i + 1}`, `RMS ${r.rms.toFixed(2)} u · widest ${r.maxD.toFixed(1)} u · ${Math.round(r.outside * 100)}% outside · ${r.exits} exits`]);
    rows.push(['Corridor half-width', `${HALF_W[api.level]} u`]);
    rows.push(['Wobble (optional detail)', `${(results.reduce((a, r) => a + r.wobble, 0) / results.length).toFixed(3)} × the corridor length (1.000 = no extra wiggle)`]);
    rows.push(['Note', 'a game measurement of this task — not a medical or clinical assessment']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'u',
          label: 'RMS distance from the centre line',
          headline: `${disp} u from the centre line on average, ${Math.round(outside * 100)}% of the way outside the corridor.`,
          rows,
          perfect: disp === '0.00',
          near: mean < 0.8,
          share: [`STEADY HAND · ${api.level} — follow the corridor`, `RMS ${disp} u`],
        }),
      api.motion() ? 600 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') return next();
    if (phase !== 'ready') return;
    const p0 = stage.pt(e);
    const p = toField(p0.x, p0.y);
    if (Math.hypot(p.x - path().pts[0].x, p.y - path().pts[0].y) > path().w + 4 * targetScale()) {
      api.prompt('Start on ●.', 'Press on the start dot and draw');
      return;
    }
    capture(stage.canvas, e.pointerId);
    kb = false;
    begin(p);
  };
  const onMove = (e: PointerEvent) => {
    if (phase !== 'trace' || kb || !primary(e)) return;
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) {
      const q = stage.pt(ev);
      addPoint(toField(q.x, q.y));
    }
    stage.request();
  };
  const onUp = (e: PointerEvent) => {
    if (!kb && primary(e)) end();
  };
  const onCancel = () => {
    if (phase === 'trace' && !kb) {
      phase = 'ready';
      stroke = [];
      api.prompt('Stroke interrupted — it didn’t count.', 'Try again from ●');
      stage.request();
    }
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onCancel);
  stage.canvas.style.cursor = 'crosshair';
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e)) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (phase === 'ready') {
          kb = true;
          api.setInput('keyboard');
          begin({ ...path().pts[0] });
          stage.request();
        } else if (phase === 'reveal') next();
        return;
      }
      if (e.key === 'Enter' && phase === 'reveal' && !e.repeat) return next();
      if (e.key.startsWith('Arrow') && phase === 'trace' && kb) {
        e.preventDefault();
        if (!keys.size) lastK = performance.now();
        keys.add(e.key);
        stage.request();
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
    const pt = path();
    if (!pt) return false;
    const { k, F, cx, cy, strip } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = false;
    if (kb && phase === 'trace' && keys.size) {
      const dt = Math.min(0.05, (now - lastK) / 1000);
      lastK = now;
      const sp = (fine ? 6 : 22) * sensitivity();
      const last = stroke[stroke.length - 1];
      const np = {
        x: clamp(last.x + ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * sp * dt, -50, 50),
        y: clamp(last.y + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * sp * dt, -50, 50),
      };
      addPoint(np);
      const endP = pt.pts[pt.pts.length - 1];
      if (Math.hypot(np.x - endP.x, np.y - endP.y) < pt.w) end();
      more = true;
    }
    c.strokeStyle = pal.line2;
    c.strokeRect(cx - F / 2 + 0.5, cy - F / 2 + 0.5, F, F);
    // The corridor: a band with edges, centre line faint.
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    pt.pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
    c.strokeStyle = pal.ink2;
    c.lineWidth = 2 * pt.w * k + 3;
    c.stroke();
    c.strokeStyle = pal.paper2;
    c.lineWidth = 2 * pt.w * k;
    c.stroke();
    c.restore();
    c.beginPath();
    pt.pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
    c.setLineDash([3, 5]);
    c.strokeStyle = pal.line;
    c.lineWidth = 1;
    c.stroke();
    c.setLineDash([]);
    const s0 = pt.pts[0];
    const s1 = pt.pts[pt.pts.length - 1];
    circle(c, X(s0.x), Y(s0.y), 6, undefined, pal.ink);
    circle(c, X(s1.x), Y(s1.y), 7, pal.ink, undefined, 2);
    circle(c, X(s1.x), Y(s1.y), 2.5, undefined, pal.ink);
    // Your path: ink inside the corridor, signal (and thicker) outside it.
    if (stroke.length > 1) {
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1];
        const b = stroke[i];
        const outside = outs[i - 1] ?? false;
        line(c, X(a.x), Y(a.y), X(b.x), Y(b.y), outside ? pal.signal : pal.ink, outside ? 2.5 : 1.75);
      }
      if (kb && phase === 'trace') {
        const l = stroke[stroke.length - 1];
        cross(c, X(l.x), Y(l.y), 8, pal.signal, 1.5, 2);
      }
    }
    if ((phase === 'reveal' || phase === 'done') && strip) {
      const res = results[results.length - 1];
      const sy = stage.h - strip / 2 - 6;
      const Ls = cx - F / 2;
      const Rs = cx + F / 2;
      const total = pt.cum[pt.cum.length - 1];
      const maxE = Math.max(pt.w * 1.5, res.maxD);
      const base = sy + strip / 2 - 12;
      hair(c, Ls, base, Rs, base, pal.ink3);
      hair(c, Ls, base - (pt.w / maxE) * (strip - 20), Rs, base - (pt.w / maxE) * (strip - 20), pal.ink3, [3, 3]);
      text(c, 'DISTANCE FROM CENTRE, START → END · dashed = corridor edge', Ls, sy - strip / 2, font.mono(9, 500), pal.ink3, 'left');
      c.beginPath();
      [...res.profile].sort((a, b) => a.s - b.s).forEach((q, i) => {
        const x = Ls + (q.s / total) * (Rs - Ls);
        const y = base - (q.d / maxE) * (strip - 20);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.strokeStyle = pal.signal;
      c.lineWidth = 1.25;
      c.stroke();
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
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onCancel);
    },
  };
};

export default factory;
