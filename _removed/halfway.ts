// 19 · HALFWAY IS A LIE — set the waterline of a round vessel at an exact fraction of its volume.
// Unlike Pour (a flat tank, filled by time), these are real round vessels: the volume below height h is
// V(h) = ∫₀ʰ π·r(y)² dy, so a wide part holds far more than its height suggests. You place the waterline
// directly; the reveal shows the requested volume, yours, the height midpoint and the volume midpoint.
import { Controls } from '../core/controls';
import { clamp, easeOut, font, hatch, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { glassWall, liquidBody, liquidSurface, softShadow } from '../core/materials';
import { rng } from '../core/rng';
import { levelFor, revolveTable, volumeAt } from '../core/scoring';
import { sensitivity } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 5;
/** Vessel height in field units. 1 u = 2 mm, so the vessel is 14 cm tall and volumes read in mL. */
export const VH = 70;
const ML_PER_U3 = 0.008; // (0.2 cm)³ = 0.008 cm³ = 0.008 mL

export type VesselKind = 'cone' | 'flask' | 'sphere' | 'hourglass' | 'steps' | 'bulb' | 'tulip';
export const TARGETS = [0.1, 0.25, 1 / 3, 0.37, 0.5, 0.625, 0.75];

export interface HalfwayRound {
  kind: VesselKind;
  /** Profile knots (y from the bottom, radius), interpolated smoothly — or stepwise for `steps`. */
  knots: [number, number][];
  f: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Inner radius at height y. */
export function radiusAt(rd: HalfwayRound, y: number) {
  const k = rd.knots;
  const yy = clamp(y, 0, VH);
  for (let i = 1; i < k.length; i++) {
    if (yy <= k[i][0]) {
      const [y0, r0] = k[i - 1];
      const [y1, r1] = k[i];
      const t = (yy - y0) / Math.max(1e-9, y1 - y0);
      return rd.kind === 'steps' ? (t < 1 ? r0 : r1) : r0 + (r1 - r0) * smooth(t);
    }
  }
  return k[k.length - 1][1];
}

function profile(kind: VesselKind, r: ReturnType<typeof rng>): [number, number][] {
  const W = r.range(22, 30);
  switch (kind) {
    case 'cone': // narrow bottom, wide top
      return [
        [0, r.range(4, 7)],
        [VH, W],
      ];
    case 'flask': // wide bottom, narrow neck
      return [
        [0, W],
        [VH * 0.45, W * 0.95],
        [VH * 0.72, r.range(5, 7)],
        [VH, r.range(5, 7)],
      ];
    case 'sphere': {
      // A round bulb with a short neck: r = √(R² − (y − R)²).
      const R = VH * 0.4;
      const neck = r.range(5, 7);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 16; i++) {
        const y = (2 * R * i) / 16;
        pts.push([y, Math.max(neck, Math.sqrt(Math.max(0, R * R - (y - R) ** 2)) * (W / R) * 0.95)]);
      }
      pts[0][1] = Math.max(pts[0][1], 3);
      pts.push([VH, neck]);
      return pts;
    }
    case 'hourglass':
      return [
        [0, W],
        [VH * 0.5, r.range(5, 8)],
        [VH, W],
      ];
    case 'steps': {
      // Several abrupt changes in cross-section.
      const a = r.range(8, 12);
      const b = r.range(22, 28);
      const c = r.range(12, 16);
      return [
        [0, a],
        [VH * 0.25, b],
        [VH * 0.55, c],
        [VH * 0.8, b * 0.8],
        [VH, b * 0.8],
      ];
    }
    case 'bulb': // a bulb sitting high on a narrow stem-like base
      return [
        [0, r.range(5, 8)],
        [VH * 0.3, r.range(6, 9)],
        [VH * 0.65, W],
        [VH * 0.88, W * 0.7],
        [VH, r.range(8, 12)],
      ];
    case 'tulip':
      return [
        [0, r.range(10, 14)],
        [VH * 0.35, W],
        [VH * 0.7, r.range(9, 12)],
        [VH, W * 0.85],
      ];
  }
}

export function makeHalfway(seed: number, level: Level): HalfwayRound[] {
  const r = rng(seed);
  const kinds: VesselKind[] = level === 'easy' ? ['cone', 'flask', 'cone', 'flask', 'sphere'] : level === 'medium' ? ['sphere', 'hourglass', 'steps', 'cone', 'flask'] : ['steps', 'bulb', 'tulip', 'hourglass', 'sphere'];
  const targets = level === 'easy' ? [0.25, 0.5, 0.75] : level === 'medium' ? [0.25, 1 / 3, 0.5, 0.625, 0.75] : TARGETS;
  const order = [...kinds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, ROUNDS).map((kind) => {
    const knots = profile(kind, r);
    // Prefer targets whose height differs from the same fraction of the height — that's the lesson.
    let f = r.pick(targets);
    const rd = { kind, knots, f };
    const tab = revolveTable((y) => radiusAt(rd, y), VH);
    for (let i = 0; i < 12; i++) {
      const h = levelFor(tab, f * tab.total);
      if (Math.abs(h / VH - f) > 0.06 || level === 'easy') break;
      f = r.pick(targets);
      rd.f = f;
    }
    return rd;
  });
}

export const fracText = (f: number) => (Math.abs(f - 1 / 3) < 1e-9 ? '33.3%' : Math.abs(f - 0.625) < 1e-9 ? '62.5%' : `${Math.round(f * 100)}%`);

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: HalfwayRound[] = [];
  let round = 0;
  let tab = revolveTable(() => 1, VH);
  let h = VH * 0.3; // your waterline height (u above the bottom)
  let phase: 'set' | 'reveal' | 'done' = 'set';
  let revealAt = 0;
  let dragging = false;
  let results: { h: number; V: number; err: number; signedPts: number }[] = [];
  let finTimer = 0;
  const keys = new Set<string>();
  let fine = false;
  let lastK = 0;
  const controls = new Controls(stage, () => lock());
  const blind = () => api.level === 'hard';

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 70;
    const F = Math.max(160, Math.min(W - 32, H - top - 70, 600));
    return { k: F / 100, F, cx: W / 2, cy: top + F / 2, ctrlY: top + F + 4 };
  };

  function setRound() {
    const rd = rounds[round];
    tab = revolveTable((y) => radiusAt(rd, y), VH);
    h = VH * (0.15 + 0.7 * rng(round * 7919 + 13).next());
    phase = 'set';
    controls.set([]);
    controls.lockLabel = 'Lock';
    controls.enabled = true;
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt(`Set the waterline at ${fracText(rd.f)} of the volume.`, blind() ? 'Drag up/down to place the line — the liquid appears only after you lock' : 'Drag up/down (or ↑ ↓, Shift fine) · Lock');
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = makeHalfway(seed, api.level);
    round = 0;
    results = [];
    keys.clear();
    setRound();
    stage.request();
  }

  function lock() {
    if (phase !== 'set') return;
    const rd = rounds[round];
    const V = volumeAt(tab, h);
    const err = Math.abs(V / tab.total - rd.f) * 100;
    results.push({ h, V, err, signedPts: (V / tab.total - rd.f) * 100 });
    phase = 'reveal';
    revealAt = performance.now();
    controls.enabled = false;
    api.sfx.release();
    api.buzz(10);
    const hT = levelFor(tab, rd.f * tab.total);
    const halfH = volumeAt(tab, VH / 2) / tab.total;
    api.prompt(
      `${signed((V / tab.total - rd.f) * 100, 1)} points: you held ${((V / tab.total) * 100).toFixed(1)}% of the volume.`,
      `${fracText(rd.f)} of the volume sits at ${((hT / VH) * 100).toFixed(0)}% of the height · the lower half of this vessel holds ${(halfH * 100).toFixed(0)}% of it${round < ROUNDS - 1 ? ' · tap for the next' : ''}`,
    );
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
    const mean = results.reduce((a, r) => a + r.err, 0) / results.length;
    const disp = mean.toFixed(1);
    const rows: [string, string][] = results.map((res, i) => {
      const rd = rounds[i];
      const t = revolveTable((y) => radiusAt(rd, y), VH);
      return [`${i + 1} · ${rd.kind}, asked ${fracText(rd.f)}`, `${((rd.f * t.total * ML_PER_U3)).toFixed(0)} mL asked · ${(res.V * ML_PER_U3).toFixed(0)} mL yours · ${signed(res.signedPts, 1)} pts`];
    });
    const bias = results.reduce((a, r) => a + r.signedPts, 0) / results.length;
    rows.push(['Bias', `${signed(bias, 1)} pts — ${Math.abs(bias) < 1 ? 'centred' : bias > 0 ? 'you overfill' : 'you underfill'}`]);
    rows.push(['Rule', 'V(h) = ∫₀ʰ π·r(y)² dy — volume grows with the square of the radius, not with height']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '%',
          label: 'volume error (points of capacity)',
          headline: disp === '0.0' ? 'Five vessels, every waterline exact. Height didn’t fool you.' : `Off by ${disp} points of capacity on average${Math.abs(bias) >= 1.5 ? ` — you tend to ${bias > 0 ? 'overfill' : 'underfill'}` : ''}.`,
          rows,
          accuracy: 1 - mean / 100,
          perfect: disp === '0.0',
          near: mean < 1,
          share: [`HALFWAY IS A LIE · ${api.level} — waterlines by volume, not height`, `${disp} points off`],
        }),
      api.motion() ? 700 : 0,
    );
  }

  // Input: drag anywhere vertically — the line follows your pointer's height.
  const setFromY = (y: number) => {
    const { k, cy } = layout();
    h = clamp(VH / 2 - (y - cy) / k, 0, VH);
    controls.touched = true;
    stage.request();
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') return next();
    if (phase !== 'set') return;
    capture(stage.canvas, e.pointerId);
    dragging = true;
    setFromY(stage.pt(e).y);
  };
  const onMove = (e: PointerEvent) => {
    if (dragging && primary(e)) setFromY(stage.pt(e).y);
  };
  const onUp = () => (dragging = false);
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e) || e.defaultPrevented) return;
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && phase === 'set') {
        e.preventDefault();
        if (!keys.size) lastK = performance.now();
        keys.add(e.key);
        controls.touched = true;
        stage.request();
      } else if ((e.key === 'Enter' || e.code === 'Space') && phase === 'reveal' && !e.repeat) {
        e.preventDefault();
        next();
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
    const { k, cx, cy, ctrlY } = layout();
    let more = false;
    if (keys.size && phase === 'set') {
      const dt = Math.min(0.05, (now - lastK) / 1000);
      lastK = now;
      const sp = (fine ? 3 : 18) * sensitivity();
      h = clamp(h + ((keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)) * sp * dt, 0, VH);
      more = true;
    }
    const X = (u: number) => cx + u * k;
    const Yb = (y: number) => cy + (VH / 2 - y) * k;
    const N = 120;
    const edge = (y: number, side: number) => X((side * radiusAt(rd, y)) / 1);
    const showH = phase === 'set' ? h : results[round].h;
    const showLiquid = !blind() || phase !== 'set';

    softShadow(c, cx, Yb(0) + 5, (radiusAt(rd, 0) + 8) * k, 7);
    if (showLiquid && showH > 0) {
      liquidBody(
        c,
        (cc) => {
          for (let i = 0; i <= N; i++) {
            const y = (showH * i) / N;
            if (i) cc.lineTo(edge(y, -1), Yb(y));
            else cc.moveTo(edge(y, -1), Yb(y));
          }
          for (let i = N; i >= 0; i--) cc.lineTo(edge((showH * i) / N, 1), Yb((showH * i) / N));
        },
        Yb(showH),
        Yb(0),
      );
      liquidSurface(c, edge(showH, -1), edge(showH, 1), Yb(showH));
    }
    for (const side of [-1, 1]) glassWall(c, Array.from({ length: N + 1 }, (_, i) => ({ x: edge((VH * i) / N, side), y: Yb((VH * i) / N) })), -side, 2.5);
    line(c, edge(0, -1), Yb(0), edge(0, 1), Yb(0), pal.ink, 2.5);

    // Your waterline handle (always visible while setting).
    if (phase === 'set') {
      const yl = Yb(h);
      line(c, X(-38), yl, X(38), yl, blind() ? pal.ink : pal.ink2, 1.5, [6, 4]);
      c.fillStyle = pal.ink;
      c.beginPath();
      c.moveTo(X(40), yl);
      c.lineTo(X(44), yl - 5);
      c.lineTo(X(44), yl + 5);
      c.closePath();
      c.fill();
      controls.draw(c, cx - Math.min(stage.w - 32, 200) / 2, ctrlY - 8, Math.min(stage.w - 32, 200));
    } else {
      // Reveal: requested level, height midpoint vs volume midpoint, and the hatched difference.
      const p = api.motion() ? easeOut((now - revealAt) / 600) : 1;
      if (p < 1) more = true;
      c.globalAlpha = p;
      const hT = levelFor(tab, rd.f * tab.total);
      const hHalfV = levelFor(tab, tab.total / 2);
      const L = X(-46);
      const R = X(46);
      line(c, L, Yb(hT), R, Yb(hT), pal.ink, 1.5, [6, 4]);
      line(c, L, Yb(VH / 2), R, Yb(VH / 2), pal.ink3, 1, [1, 3]);
      line(c, L + 20, Yb(hHalfV), R - 20, Yb(hHalfV), pal.ink2, 1, [8, 3, 2, 3]);
      // Labels on the left, pushed apart vertically so close lines stay readable.
      const labels = [
        { y: Yb(hT), s: `${fracText(rd.f)} of the volume`, col: pal.ink },
        { y: Yb(VH / 2), s: 'half the height', col: pal.ink3 },
        { y: Yb(hHalfV), s: 'half the volume', col: pal.ink2 },
      ].sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 16);
      for (const lb of labels) tag(c, lb.s, L - 6, lb.y, lb.col, 10, 'right');
      const yourH = results[round].h;
      if (Math.abs(yourH - hT) * k > 1.5) {
        const lo = Math.min(yourH, hT);
        const hi = Math.max(yourH, hT);
        c.beginPath();
        for (let i = 0; i <= 30; i++) {
          const y = lo + ((hi - lo) * i) / 30;
          if (i) c.lineTo(edge(y, -1), Yb(y));
          else c.moveTo(edge(y, -1), Yb(y));
        }
        for (let i = 30; i >= 0; i--) {
          const y = lo + ((hi - lo) * i) / 30;
          c.lineTo(edge(y, 1), Yb(y));
        }
        c.closePath();
        c.fillStyle = hatch(c, pal.signal, 5);
        c.fill();
      }
      c.globalAlpha = 1;
      if (round < ROUNDS - 1) text(c, 'tap for the next vessel ▸', cx, ctrlY + 22, font.mono(11, 500), pal.ink2, 'center');
    }
    text(c, `TARGET ${fracText(rd.f)} OF THE VOLUME`, X(-49), Yb(VH) - 18, font.mono(10, 500), pal.ink2, 'left');
    const sy = stage.h - 10;
    for (let i = 0; i < ROUNDS; i++) text(c, i < results.length ? results[i].err.toFixed(1) : i === round ? '•' : '·', stage.w / 2 + (i - 2) * 52, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      controls.destroy();
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;
