// 53 · MOIRÉ — tune two gratings until their interference has a target property.
// Each layer is a line grating with unit normal n = (cos θ, sin θ), period p and phase φ:
//   g(x) = ½ + ½ cos(2π k·x + φ), k = n / p.
// The two layers are multiplied (light through two printed sheets). The product contains a slow term
//   ¼ cos(2π (kA − kB)·x + φA − φB),
// the moiré. Its wave vector km = kA − kB fixes every measurable property used here: band spacing 1/|km|,
// band count across the window D·|km| (D = 2, the window spans −1…1), band direction (perpendicular to km),
// and band position (bright where the slow phase is a multiple of 2π). Targets are checked against these
// formulas, never against pixels. The picture is rendered at a fixed internal resolution with 2 × 2
// supersampling, independent of the device pixel ratio, and every period stays above 10 samples.
import { font, pal, text, TAU } from '../core/draw';
import { alpha, plate } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { Bench, roundStrip, type Pt } from './kit';
import { famChip, Session, Sliders, type Band, type Family } from './lab';

export interface Grating {
  /** Normal direction, degrees. */
  th: number;
  /** Period, window units. */
  p: number;
  /** Shift along the normal, window units. */
  off: number;
}
export type Ctrl = 'rot' | 'per' | 'off';
export interface Target {
  count?: number;
  /** Band direction, degrees in [0, 180). */
  dir?: number;
  spacing?: number;
  /** Marker a bright band must pass through. */
  mark?: { x: number; y: number };
}
export interface MoireRound {
  kind: 'count' | 'orient' | 'align' | 'spacing' | 'match' | 'minimal';
  A: Grating;
  /** B's starting state (controls are deltas from A for rotation, ratio for period). */
  B0: Grating;
  ctrls: Ctrl[];
  /** Slider ranges: rotation (deg, relative to A), period ratio pB / pA, offset (units). */
  rot: [number, number];
  per: [number, number];
  target: Target;
  /** Tolerances in the target's own units. */
  tol: Target;
  /** A configuration that meets the target (proof of attainability). */
  witness: Grating;
  /** Minimal-movement family: the smallest normalised movement that reaches the target. */
  minMove?: number;
}

export const D = 2;
const rad = (d: number) => (d * Math.PI) / 180;
const kvec = (g: Grating) => ({ x: Math.cos(rad(g.th)) / g.p, y: Math.sin(rad(g.th)) / g.p });

export function moireK(A: Grating, B: Grating) {
  const a = kvec(A);
  const b = kvec(B);
  return { x: a.x - b.x, y: a.y - b.y };
}
export const bandCount = (A: Grating, B: Grating) => D * Math.hypot(moireK(A, B).x, moireK(A, B).y);
export const spacingOf = (A: Grating, B: Grating) => 1 / Math.max(1e-9, Math.hypot(moireK(A, B).x, moireK(A, B).y));
/** Direction the bands run along (perpendicular to km), in [0, 180). */
export function bandDir(A: Grating, B: Grating) {
  const k = moireK(A, B);
  const a = (Math.atan2(k.y, k.x) * 180) / Math.PI + 90;
  return ((a % 180) + 180) % 180;
}
const dirErr = (a: number, b: number) => {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
};
/** Distance from the marker to the nearest bright band centre, in band spacings (0 … 0.5). */
export function bandPhaseErr(A: Grating, B: Grating, m: { x: number; y: number }) {
  const k = moireK(A, B);
  const phA = (-TAU * A.off) / A.p;
  const phB = (-TAU * B.off) / B.p;
  const u = k.x * m.x + k.y * m.y + (phA - phB) / TAU;
  return Math.abs(u - Math.round(u));
}

/** Normalised error of a configuration against the round's target: ≤ 1 means within tolerance. */
export function targetErr(rd: MoireRound, B: Grating) {
  const { A, target: t, tol } = rd;
  let e = 0;
  if (t.count !== undefined) e = Math.max(e, Math.abs(bandCount(A, B) - t.count) / tol.count!);
  if (t.dir !== undefined) e = Math.max(e, dirErr(bandDir(A, B), t.dir) / tol.dir!);
  if (t.spacing !== undefined) e = Math.max(e, Math.abs(spacingOf(A, B) - t.spacing) / t.spacing / tol.spacing!);
  if (t.mark) e = Math.max(e, bandPhaseErr(A, B, t.mark) / 0.08);
  return e;
}

/** Normalised movement between two B states over the controls in play (each range counts as 1). */
export function moveOf(rd: MoireRound, B: Grating) {
  let m = 0;
  if (rd.ctrls.includes('rot')) m += Math.abs(B.th - rd.B0.th) / (rd.rot[1] - rd.rot[0]);
  if (rd.ctrls.includes('per')) m += Math.abs(B.p / rd.A.p - rd.B0.p / rd.A.p) / (rd.per[1] - rd.per[0]);
  return m;
}

const mk = (A: Grating, d: number, ratio: number, off = 0): Grating => ({ th: A.th + d, p: A.p * ratio, off });

function baseA(r: Rng, band: Band): Grating {
  // Periods ≥ 0.05 units: ≥ 12 internal samples (240 per 2 units, ×2 supersampling).
  return { th: r.range(0, 180), p: r.range(0.06, 0.075) - band * 0.003, off: 0 };
}

function genCount(r: Rng, band: Band): MoireRound | null {
  const A = baseA(r, band);
  const N = r.int(2, [4, 6, 8, 9][band]);
  // |km| = 2 sin(δ/2) / p for equal periods.
  const d = (2 * Math.asin((N * A.p) / (2 * D)) * 180) / Math.PI;
  const rot: [number, number] = [-12, 12];
  if (d > rot[1] - 0.5) return null;
  const start = r.range(rot[0], rot[1]);
  const B0 = mk(A, start, 1);
  if (Math.abs(bandCount(A, B0) - N) < 1.2) return null;
  return { kind: 'count', A, B0, ctrls: ['rot'], rot, per: [1, 1], target: { count: N }, tol: { count: [0.3, 0.25, 0.18, 0.14][band] }, witness: mk(A, r.sign() * d, 1) };
}

function genOrient(r: Rng, band: Band): MoireRound | null {
  const A = baseA(r, band);
  const d = r.sign() * r.range(2.5, 5);
  const per: [number, number] = [0.85, 1.15];
  const ratio = r.range(per[0] + 0.02, per[1] - 0.02);
  const w = mk(A, d, ratio);
  const dir = bandDir(A, w);
  const B0 = mk(A, d, r.range(per[0], per[1]));
  if (dirErr(bandDir(A, B0), dir) < 15) return null;
  // The moiré must stay legible over the window at the witness (at least 1.5 bands, at most 10).
  const n = bandCount(A, w);
  if (n < 1.5 || n > 10) return null;
  return { kind: 'orient', A, B0, ctrls: ['per'], rot: [d, d], per, target: { dir }, tol: { dir: [7, 5, 3.5, 2.5][band] }, witness: w };
}

function genAlign(r: Rng, band: Band): MoireRound | null {
  const A = baseA(r, band);
  const d = r.sign() * r.range(3, 6);
  const B0 = mk(A, d, 1, r.range(0, A.p));
  const mark = { x: r.range(-0.6, 0.6), y: r.range(-0.6, 0.6) };
  if (bandPhaseErr(A, B0, mark) < 0.2) return null;
  // Witness: solve the offset that puts the marker on a bright band.
  const w = { ...B0 };
  for (let i = 0; i < 400 && bandPhaseErr(A, w, mark) > 0.004; i++) w.off = (w.off + A.p / 400) % A.p;
  if (bandPhaseErr(A, w, mark) > 0.01) return null;
  return { kind: 'align', A, B0, ctrls: ['off'], rot: [d, d], per: [1, 1], target: { mark }, tol: {}, witness: w };
}

function genSpacing(r: Rng, band: Band): MoireRound | null {
  const A = baseA(r, band);
  const per: [number, number] = [0.8, 1.2];
  // Parallel gratings beat with spacing pA·pB / |pA − pB|.
  const ratio = r.sign() > 0 ? r.range(1.04, 1.18) : r.range(0.82, 0.96);
  const w = mk(A, 0, ratio);
  const spacing = spacingOf(A, w);
  if (spacing > 1.4) return null;
  const B0 = mk(A, 0, r.range(per[0], per[1]));
  if (Math.abs(spacingOf(A, B0) - spacing) / spacing < 0.4) return null;
  return { kind: 'spacing', A, B0, ctrls: ['per'], rot: [0, 0], per, target: { spacing }, tol: { spacing: [0.1, 0.07, 0.05, 0.04][band] }, witness: w };
}

function genMatch(r: Rng, band: Band, minimal = false): MoireRound | null {
  const A = baseA(r, band);
  const rot: [number, number] = [-10, 10];
  const per: [number, number] = [0.85, 1.15];
  const w = mk(A, r.range(-8, 8), r.range(0.88, 1.12));
  const count = bandCount(A, w);
  if (count < 2 || count > 8) return null;
  const B0 = mk(A, r.range(rot[0], rot[1]), r.range(per[0], per[1]));
  const rd: MoireRound = {
    kind: minimal ? 'minimal' : 'match',
    A,
    B0,
    ctrls: ['rot', 'per'],
    rot,
    per,
    target: minimal ? { count: Math.round(count * 2) / 2 } : { count: Math.round(count * 10) / 10, dir: bandDir(A, w) },
    tol: { count: [0.35, 0.3, 0.22, 0.18][band], dir: [8, 6, 4.5, 3.5][band] },
    witness: w,
  };
  if (minimal) {
    // The solution set is a curve in (rotation, period); the nearest point to the start is found by search.
    let best = Infinity;
    for (let i = 0; i <= 240; i++)
      for (let j = 0; j <= 120; j++) {
        const B = mk(A, rot[0] + ((rot[1] - rot[0]) * i) / 240, per[0] + ((per[1] - per[0]) * j) / 120);
        if (targetErr(rd, B) <= 0.5 && moveOf(rd, B) < best) {
          best = moveOf(rd, B);
          rd.witness = B;
        }
      }
    if (!Number.isFinite(best) || targetErr(rd, B0) < 2) return null;
    rd.minMove = best;
  } else if (targetErr(rd, B0) < 2) return null;
  return rd;
}

export const FAMILIES: Family<MoireRound>[] = [
  { id: 'count', name: 'Band count', teach: 'Turn the top sheet. A tiny turn makes broad bands; a larger turn packs more in. Count the bright bands.', bands: [0, 3], intro: true, gen: genCount, sig: (rd) => `${rd.target.count}|${Math.round(rd.A.th / 30)}` },
  { id: 'orient', name: 'Orientation', teach: 'Only the spacing moves now — watch how a small change of spacing swings the bands round.', bands: [1, 3], gen: genOrient, sig: (rd) => `${Math.round(rd.target.dir! / 20)}|${Math.round(rd.A.th / 30)}` },
  { id: 'align', name: 'Centre alignment', teach: 'Slide the top sheet. The bands move many times faster than the sheet — put a bright band on the marker.', bands: [0, 3], gen: genAlign, sig: (rd) => `${Math.round(rd.target.mark!.x * 3)},${Math.round(rd.target.mark!.y * 3)}|${Math.sign(rd.rot[0])}` },
  { id: 'spacing', name: 'Spacing', teach: 'The sheets are parallel: they beat. The closer the two spacings, the wider the bands.', bands: [0, 3], gen: genSpacing, sig: (rd) => `${Math.round(rd.target.spacing! * 10)}|${rd.witness.p > rd.A.p ? '+' : '−'}` },
  { id: 'match', name: 'Pattern match', teach: 'Two controls, two properties: match the band count and the band direction of the target.', bands: [1, 3], gen: (r, b) => genMatch(r, b), sig: (rd) => `${rd.target.count}|${Math.round(rd.target.dir! / 20)}` },
  { id: 'minimal', name: 'Minimal move', teach: 'Many settings give this band count. Reach one with the smallest total movement from the start.', bands: [2, 3], gen: (r, b) => genMatch(r, b, true), sig: (rd) => `${rd.target.count}|${Math.round(rd.B0.th - rd.A.th)}` },
];

export const ROUNDS = 5;

// ── Rendering ────────────────────────────────────────────────────────────────────

const RES = 240;
const SS = 2;

/** Render the transmission of two gratings into an RGBA buffer (pure). */
export function renderMoire(A: Grating, B: Grating | null, res = RES, ink: [number, number, number] = [244, 240, 232], paper: [number, number, number] = [10, 10, 12]) {
  const out = new Uint8ClampedArray(res * res * 4);
  const kA = kvec(A);
  const kB = B ? kvec(B) : { x: 0, y: 0 };
  const phA = (-TAU * A.off) / A.p;
  const phB = B ? (-TAU * B.off) / B.p : 0;
  const n = res * SS;
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      let acc = 0;
      for (let sj = 0; sj < SS; sj++)
        for (let si = 0; si < SS; si++) {
          const x = ((i * SS + si + 0.5) / n) * 2 - 1;
          const y = ((j * SS + sj + 0.5) / n) * 2 - 1;
          // A sharpened profile (thin dark lines) keeps the sheets looking printed; the fundamental is unchanged.
          const a = 0.5 + 0.5 * Math.cos(TAU * (kA.x * x + kA.y * y) + phA);
          const b = B ? 0.5 + 0.5 * Math.cos(TAU * (kB.x * x + kB.y * y) + phB) : 1;
          acc += Math.sqrt(a) * Math.sqrt(b);
        }
      const v = acc / (SS * SS);
      const o = (j * res + i) * 4;
      out[o] = paper[0] + (ink[0] - paper[0]) * v;
      out[o + 1] = paper[1] + (ink[1] - paper[1]) * v;
      out[o + 2] = paper[2] + (ink[2] - paper[2]) * v;
      out[o + 3] = 255;
    }
  return out;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sliders = new Sliders();
  const sess = new Session<MoireRound>(api, 'moire', FAMILIES, ROUNDS);
  let rd: MoireRound;
  let B: Grating = { th: 0, p: 0.06, off: 0 };
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let cv: HTMLCanvasElement | null = null;
  let thumb: HTMLCanvasElement | null = null;
  let key = '';

  const canvasOf = (buf: Uint8ClampedArray, res: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const x = c.getContext('2d')!;
    const img = x.createImageData(res, res);
    img.data.set(buf);
    x.putImageData(img, 0, 0);
    return c;
  };
  const rgb = (css: string): [number, number, number] => {
    const m = css.match(/\d+(\.\d+)?/g);
    if (css.startsWith('#') && css.length >= 7) return [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)];
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [244, 240, 232];
  };

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    B = { ...rd.B0 };
    phase = 'play';
    key = '';
    sliders.focus = 0;
    thumb = rd.kind === 'match' ? canvasOf(renderMoire(rd.A, rd.witness, 120, rgb(pal.ink), rgb(pal.paper)), 120) : null;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const t = rd.target;
    const ask =
      rd.kind === 'count'
        ? `Make exactly ${t.count} bright bands across the window.`
        : rd.kind === 'orient'
          ? `Make the bands run at ${t.dir!.toFixed(0)}° (the cyan guide).`
          : rd.kind === 'align'
            ? 'Put the centre of a bright band on the cyan marker.'
            : rd.kind === 'spacing'
              ? 'Make the band spacing match the cyan bracket.'
              : rd.kind === 'match'
                ? `Match the target: ${t.count!.toFixed(1)} bands running at ${t.dir!.toFixed(0)}°.`
                : `Make ${t.count} bands — with the smallest total movement of the controls.`;
    api.prompt(ask, sess.teach || 'Drag the sliders (↑ ↓ choose, ← → nudge, Shift fine) · Lock when it matches');
    stage.request();
  }

  function setB(nb: Grating) {
    if (phase !== 'play') return;
    B = nb;
    stage.request();
  }

  function lock() {
    if (phase !== 'play') return;
    const e = targetErr(rd, B);
    let pen = e <= 1 ? 0.15 * e : Math.min(1, 0.15 + (0.85 * (e - 1)) / 2);
    const t = rd.target;
    const parts: string[] = [];
    if (t.count !== undefined) parts.push(`${bandCount(rd.A, B).toFixed(2)} bands (target ${t.count})`);
    if (t.dir !== undefined) parts.push(`direction ${bandDir(rd.A, B).toFixed(1)}° (target ${t.dir.toFixed(1)}°)`);
    if (t.spacing !== undefined) parts.push(`spacing ${spacingOf(rd.A, B).toFixed(3)} u (target ${t.spacing.toFixed(3)})`);
    if (t.mark) parts.push(`${(bandPhaseErr(rd.A, B, t.mark) * 100).toFixed(1)}% of a band from the marker`);
    let extra = '';
    if (rd.kind === 'minimal' && e <= 1) {
      const mv = moveOf(rd, B);
      const excess = Math.max(0, mv - rd.minMove!);
      pen = Math.min(1, pen + excess * 1.2);
      extra = ` Movement ${mv.toFixed(3)} vs the minimum ${rd.minMove!.toFixed(3)}.`;
    }
    const why =
      rd.kind === 'count' || rd.kind === 'spacing'
        ? 'Band spacing is 1/|kA − kB|: the closer the two sheets’ wave vectors, the wider the bands.'
        : rd.kind === 'orient'
          ? 'The bands run perpendicular to kA − kB, so a 1% change of spacing can turn them by tens of degrees.'
          : rd.kind === 'align'
            ? `A shift of the sheet moves the bands ${(spacingOf(rd.A, B) / rd.A.p).toFixed(0)}× as far — moiré magnifies motion.`
            : 'Count and direction both follow from kA − kB.';
    phase = 'reveal';
    sess.done(pen, parts.join(' · ') + extra, { x: stage.w / 2, y: 120 });
    api.sfx[e <= 1 ? 'press' : 'release']();
    api.prompt(e <= 1 ? `Within tolerance — ${parts.join(', ')}.` : `Off: ${parts.join(', ')}.`, `${why}${extra}${sess.last ? '' : ' · Tap for the next'}`);
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per pattern (target error, then extra movement)', share: 'MOIRÉ' });
      if (r) bench.finish(r);
    }
  }

  bench.onTap = (p: Pt) => {
    if (phase === 'reveal') return begin();
    if (phase === 'play') sliders.down(p);
  };
  bench.onMove = (p) => sliders.move(p) && stage.request();
  bench.onUp = () => sliders.up();
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase !== 'play') return;
    if (sliders.key(e)) e.preventDefault();
    else if (e.key === 'Enter') {
      e.preventDefault();
      lock();
    }
  };

  stage.draw = () => {
    bench.frame();
    sliders.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const wide = W >= 720;
    const top = 112;
    const side = wide ? Math.min(H - top - 40, W * 0.5, 460) : Math.min(W - 32, H - top - 230, 400);
    const wx = wide ? Math.max(16, W / 2 - side - 20) : (W - side) / 2;
    const wy = top;
    const k = `${B.th.toFixed(4)}|${B.p.toFixed(5)}|${B.off.toFixed(5)}|${phase}`;
    if (k !== key || !cv) {
      key = k;
      cv = canvasOf(renderMoire(rd.A, B, RES, rgb(pal.ink), rgb(pal.paper)), RES);
    }
    plate(c, wx - 6, wy - 6, side + 12, side + 12, 8);
    // A round window: "bands across the window" is the same count in every direction.
    c.save();
    c.beginPath();
    c.arc(wx + side / 2, wy + side / 2, side / 2, 0, TAU);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(cv, wx, wy, side, side);
    c.restore();
    c.beginPath();
    c.arc(wx + side / 2, wy + side / 2, side / 2, 0, TAU);
    c.strokeStyle = pal.line;
    c.lineWidth = 1;
    c.stroke();
    const toPx = (x: number, y: number) => ({ x: wx + ((x + 1) / 2) * side, y: wy + ((y + 1) / 2) * side });
    const reveal = phase !== 'play';
    // Target guides.
    const t = rd.target;
    c.save();
    c.beginPath();
    c.arc(wx + side / 2, wy + side / 2, side / 2, 0, TAU);
    c.clip();
    if (t.dir !== undefined) {
      const a = rad(t.dir);
      const m = toPx(0, 0);
      c.strokeStyle = alpha(pal.accent, 0.8);
      c.setLineDash([6, 6]);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(m.x - Math.cos(a) * side, m.y - Math.sin(a) * side);
      c.lineTo(m.x + Math.cos(a) * side, m.y + Math.sin(a) * side);
      c.stroke();
      c.setLineDash([]);
    }
    if (t.mark) {
      const m = toPx(t.mark.x, t.mark.y);
      c.strokeStyle = pal.accent;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(m.x, m.y, 9, 0, TAU);
      c.moveTo(m.x - 15, m.y);
      c.lineTo(m.x + 15, m.y);
      c.moveTo(m.x, m.y - 15);
      c.lineTo(m.x, m.y + 15);
      c.stroke();
    }
    if (reveal) {
      // The bright-band centre lines predicted by kA − kB.
      const km = moireK(rd.A, B);
      const kk = Math.hypot(km.x, km.y);
      const phA = (-TAU * rd.A.off) / rd.A.p;
      const phB = (-TAU * B.off) / B.p;
      const c0 = -(phA - phB) / TAU;
      const ux = km.x / kk;
      const uy = km.y / kk;
      c.strokeStyle = alpha(pal.accent, 0.55);
      c.lineWidth = 1;
      for (let n = -12; n <= 12; n++) {
        const s0 = (n + c0) / kk;
        if (Math.abs(s0) > 1.5) continue;
        const p0 = toPx(ux * s0 - uy * 2, uy * s0 + ux * 2);
        const p1 = toPx(ux * s0 + uy * 2, uy * s0 - ux * 2);
        c.beginPath();
        c.moveTo(p0.x, p0.y);
        c.lineTo(p1.x, p1.y);
        c.stroke();
      }
    }
    c.restore();
    if (t.spacing !== undefined) {
      const L = (t.spacing / D) * side;
      const by = wy + side + 14;
      c.strokeStyle = pal.accent;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(wx, by);
      c.lineTo(wx + L, by);
      c.moveTo(wx, by - 5);
      c.lineTo(wx, by + 5);
      c.moveTo(wx + L, by - 5);
      c.lineTo(wx + L, by + 5);
      c.stroke();
      text(c, 'target band spacing', wx + L + 8, by + 4, font.mono(10, 500), pal.accent);
    }
    // Controls panel.
    const px = wide ? wx + side + 40 : 16;
    const pw = wide ? Math.min(320, W - px - 24) : W - 32;
    let py = wide ? wy + 30 : wy + side + 44;
    if (thumb) {
      text(c, 'TARGET', px, py - 8, font.mono(10, 600), pal.ink3);
      c.drawImage(thumb, px, py, 110, 110);
      c.strokeStyle = pal.line;
      c.strokeRect(px + 0.5, py + 0.5, 109, 109);
      py += 140;
    }
    const on = phase === 'play';
    if (rd.ctrls.includes('rot'))
      sliders.draw(c, px, (py += 34), pw, 'TURN TOP SHEET', rd.rot[0], rd.rot[1], () => B.th - rd.A.th, (v) => setB({ ...B, th: rd.A.th + v }), (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}°`, { step: 0.01, off: !on });
    if (rd.ctrls.includes('per'))
      sliders.draw(c, px, (py += 50), pw, 'TOP SHEET SPACING', rd.per[0], rd.per[1], () => B.p / rd.A.p, (v) => setB({ ...B, p: rd.A.p * v }), (v) => `×${v.toFixed(4)}`, { step: 0.0005, off: !on });
    if (rd.ctrls.includes('off'))
      sliders.draw(c, px, (py += 50), pw, 'SLIDE TOP SHEET', 0, rd.A.p, () => B.off, (v) => setB({ ...B, off: v }), (v) => `${((v / rd.A.p) * 100).toFixed(1)}% of a line`, { step: rd.A.p / 1000, off: !on });
    if (rd.kind === 'minimal') text(c, `moved ${moveOf(rd, B).toFixed(3)}`, px, py + 26, font.mono(10, 500), pal.ink3);
    if (on) bench.button(c, px, py + 40, Math.min(160, pw), 40, 'Lock', lock, { primary: true, key: 'Enter' });
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return false;
  };

  return {
    reset,
    destroy: () => {
      api.ownKeys(false);
      bench.destroy();
    },
  };
};

export default factory;
