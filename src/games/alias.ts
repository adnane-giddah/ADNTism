// 42 · ALIAS — what sparse samples can and cannot tell you about a signal.
// Signals are x(t) = A sin(2π f t + φ). Samples are taken at t_k = k / fs over a 2-second window and are
// computed from the signal itself (plus bounded noise on harder bands, shown as error bars). Two signals
// whose frequencies differ by a multiple of fs — or sum to one, with the phase reflected — produce exactly
// the same samples; the game never calls such a candidate wrong. Consistency is decided numerically:
//   · a fully specified candidate fits when every sample is within the noise bound;
//   · a bare frequency fits when some amplitude and phase do. Aliases of the true frequency fit by
//     construction; any other frequency is offered only if its least-squares fit misses by more than twice
//     the noise in RMS — and since no fit can have a smaller worst-case error than RMS error, it cannot fit.
// Ambiguous distractors are discarded, so every round has a definite answer set.
import { font, pal, text, TAU } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, shuffle, type Pt } from './kit';
import { famChip, Session, Sliders, type Band, type Family } from './lab';

export interface Sig {
  A: number;
  f: number;
  ph: number;
}
export const val = (s: Sig, t: number) => s.A * Math.sin(TAU * s.f * t + s.ph);
export const T = 2;

export interface Wheel {
  /** True rotation, rev/s (positive = clockwise). */
  f: number;
  spokes: number;
  /** Apparent rotation on film, rev/s. */
  apparent: number;
  /** Forward: predict the film from the truth. Inverse: which true speeds could give this film. */
  inverse: boolean;
  options: number[];
  ok: boolean[];
}
export interface AliasRound {
  kind: 'identify' | 'resample' | 'wheel' | 'freqs' | 'recon';
  truth: Sig;
  fs: number;
  noise: number;
  ys: number[];
  cands?: Sig[];
  /** Which candidates / options / chips are consistent (correct). */
  ok?: boolean[];
  pair?: [Sig, Sig];
  rates?: number[];
  chips?: number[];
  wheel?: Wheel;
  /** Recon: amplitude is unknown too. */
  freeA?: boolean;
  /** Freqs: tapping a chip previews its best fit (lower bands only). */
  preview?: boolean;
}

export const times = (fs: number, dur = T) => Array.from({ length: Math.floor(dur * fs + 1e-9) + 1 }, (_, k) => k / fs);

/** Sample a signal with bounded uniform noise. */
export function sample(s: Sig, fs: number, noise: number, r?: Rng) {
  return times(fs).map((t) => val(s, t) + (noise && r ? r.range(-noise, noise) : 0));
}

/** Largest deviation of a fully specified candidate from the samples. */
export const maxDev = (c: Sig, fs: number, ys: number[]) => times(fs).reduce((m, t, k) => Math.max(m, Math.abs(val(c, t) - ys[k])), 0);

/** Least-squares fit of a·sin + b·cos at frequency f; returns the fitted signal and its RMS / max residual. */
export function fitFreq(f: number, fs: number, ys: number[]) {
  const ts = times(fs);
  let ss = 0,
    sc = 0,
    cc = 0,
    sy = 0,
    cy = 0;
  ts.forEach((t, k) => {
    const s = Math.sin(TAU * f * t);
    const c = Math.cos(TAU * f * t);
    ss += s * s;
    sc += s * c;
    cc += c * c;
    sy += s * ys[k];
    cy += c * ys[k];
  });
  const det = ss * cc - sc * sc;
  let a = 0,
    b = 0;
  if (Math.abs(det) > 1e-9 * (ss + cc) ** 2) {
    a = (sy * cc - cy * sc) / det;
    b = (cy * ss - sy * sc) / det;
  } else if (ss >= cc && ss > 1e-12) a = sy / ss;
  else if (cc > 1e-12) b = cy / cc;
  let sq = 0,
    mx = 0;
  ts.forEach((t, k) => {
    const e = ys[k] - (a * Math.sin(TAU * f * t) + b * Math.cos(TAU * f * t));
    sq += e * e;
    mx = Math.max(mx, Math.abs(e));
  });
  // a sin + b cos = A sin(θ + φ) with A = √(a² + b²), φ = atan2(b, a).
  return { sig: { A: Math.hypot(a, b), f, ph: Math.atan2(b, a) }, rms: Math.sqrt(sq / ts.length), max: mx };
}

/** f ≡ ±f0 (mod fs): the aliases of f0. */
export const isAlias = (f: number, f0: number, fs: number) => {
  const m1 = (f - f0) / fs;
  const m2 = (f + f0) / fs;
  return Math.abs(m1 - Math.round(m1)) < 1e-9 || Math.abs(m2 - Math.round(m2)) < 1e-9;
};

/** The alias of s at frequency f (same samples at rate fs, sample times k / fs). */
export function aliasAt(s: Sig, f: number, fs: number): Sig {
  const m = (f - s.f) / fs;
  if (Math.abs(m - Math.round(m)) < 1e-9) return { A: s.A, f, ph: s.ph };
  // f = m·fs − f0: sin(2π(m fs − f0) k/fs + φ') = sin(φ' − 2π f0 k/fs) → φ' = π − φ.
  return { A: s.A, f, ph: Math.PI - s.ph };
}

const wrap = (x: number) => x - Math.round(x);
/** Apparent rotation of an n-spoke wheel turning at f rev/s, filmed at fs frames/s. */
export const apparentRate = (f: number, fs: number, n: number) => (wrap((n * f) / fs) * fs) / n;

const NOISE = [0, 0.06, 0.11, 0.15];

function genIdentify(r: Rng, band: Band): AliasRound | null {
  const fs = band === 0 ? r.pick([6, 8]) : r.pick([3, 4, 5]);
  const noise = NOISE[band];
  const f0 = band === 0 ? r.range(0.5, 1.4) : r.range(0.4, fs / 2 - 0.3);
  const base: Sig = { A: 1, f: Math.round(f0 * 10) / 10, ph: r.range(0, TAU) };
  // The physical signal is sometimes the fast one (undersampled), from band 2.
  const truth = band >= 2 && r.next() < 0.5 ? aliasAt(base, base.f + fs, fs) : base;
  const ys = sample(truth, fs, noise, r);
  const cands: Sig[] = [truth];
  if (band >= 1) {
    const alts = [base.f, base.f + fs, fs - base.f, 2 * fs - base.f].filter((f) => f > 0.2 && f < 10.5 && Math.abs(f - truth.f) > 0.2);
    for (const f of shuffle(alts, r.next).slice(0, band >= 2 ? 2 : 1)) cands.push(aliasAt(base, f, fs));
  }
  const want = [4, 5, 5, 6][band];
  for (let tries = 0; cands.length < want && tries < 60; tries++) {
    const kind = r.int(0, 2);
    const ref = r.pick(cands.slice(0, Math.max(1, cands.length)));
    const d: Sig =
      kind === 0
        ? { ...ref, ph: ref.ph + r.sign() * r.range(0.7, 2.4) }
        : kind === 1
          ? { ...ref, f: Math.round((ref.f + r.sign() * r.range(0.25, 0.9)) * 10) / 10 }
          : { ...ref, A: ref.A * r.pick([0.6, 1.5]) };
    if (d.f < 0.2 || d.f > 10.5) continue;
    // A distractor must be clearly inconsistent: some sample misses by more than twice the noise.
    if (maxDev(d, fs, ys) < 2 * noise + 0.25) continue;
    if (cands.some((c) => Math.abs(c.f - d.f) < 1e-9 && Math.abs(wrap((c.ph - d.ph) / TAU)) < 0.05 && Math.abs(c.A - d.A) < 0.05)) continue;
    cands.push(d);
  }
  if (cands.length < want) return null;
  shuffle(cands, r.next);
  const ok = cands.map((c) => maxDev(c, fs, ys) <= noise + 1e-6);
  if (!ok.some(Boolean) || ok.every(Boolean)) return null;
  return { kind: 'identify', truth, fs, noise, ys, cands, ok };
}

function genResample(r: Rng, band: Band): AliasRound | null {
  const fs = r.pick([2.5, 3, 4, 5]);
  const f1 = Math.round(r.range(0.4, Math.min(2, fs / 2 - 0.2)) * 10) / 10;
  const s1: Sig = { A: 1, f: f1, ph: r.range(0, TAU) };
  const f2 = r.next() < 0.5 || fs - f1 < f1 + 0.4 ? f1 + fs : fs - f1;
  const s2 = aliasAt(s1, f2, fs);
  if (maxDev(s2, fs, sample(s1, fs, 0)) > 1e-9) return null;
  const pool = [1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12].filter((x) => Math.abs(x - fs) > 1e-9);
  const diffOf = (rate: number) => times(rate).reduce((m, t) => Math.max(m, Math.abs(val(s1, t) - val(s2, t))), 0);
  const yes = pool.filter((x) => diffOf(x) >= 0.35);
  // Traps that genuinely alias: the same rate again, and its whole fractions (fs/2, fs/3), plus any pool rate that coincides.
  const no = [...new Set([fs, fs / 2, fs / 3, ...pool].map((x) => Math.round(x * 100) / 100))].filter((x) => x >= 0.8 && diffOf(x) <= 0.05);
  // Lower bands: plenty of distinguishing rates; higher bands: one or two among traps.
  const nYes = band <= 1 ? 2 : 1;
  if (yes.length < nYes || no.length < 4 - nYes) return null;
  const rates = shuffle([...shuffle(yes, r.next).slice(0, nYes), ...shuffle(no, r.next).slice(0, 4 - nYes)], r.next);
  return { kind: 'resample', truth: s1, fs, noise: 0, ys: sample(s1, fs, 0), pair: [s1, s2], rates, ok: rates.map((x) => diffOf(x) >= 0.35) };
}

function genWheel(r: Rng, band: Band): AliasRound | null {
  const fs = r.pick([12, 16, 20, 24]);
  const n = band >= 2 ? 3 : 1;
  const inverse = band >= 2 ? r.next() < 0.6 : band === 1 && r.next() < 0.3;
  // Apparent per-frame step kept well inside (−½, ½) of a symmetry turn: never ambiguous.
  const step = r.pick([-1, 1]) * r.range(0.04, 0.34) * (r.next() < 0.15 ? 0 : 1);
  const m = r.int(1, band >= 2 ? 3 : 2);
  const f = ((m + step) * fs) / n;
  const apparent = apparentRate(f, fs, n);
  const fmt = (x: number) => Math.round(x * 10) / 10;
  let options: number[];
  let ok: boolean[];
  if (!inverse) {
    const set = [apparent, -apparent, f, apparent + r.sign() * fs / n / 2].map(fmt);
    if (Math.abs(apparent) < 0.05) set[1] = fmt(r.sign() * r.range(0.6, 1.5));
    if (new Set(set).size < 4 || set.some((x, i) => set.some((y, j) => i < j && Math.abs(x - y) < 0.4))) return null;
    options = shuffle(set, r.next);
    ok = options.map((x) => Math.abs(x - fmt(apparent)) < 1e-9);
  } else {
    const trues = [f, ((m + 1 + step) * fs) / n, ((m + 1 - step) * fs) / n, ((m + step + 0.5) * fs) / n, f / 2].map(fmt);
    const opts = shuffle([...new Set(trues)].filter((x) => x > 0.5), r.next).slice(0, 4);
    if (opts.length < 4) return null;
    options = opts;
    ok = opts.map((x) => Math.abs(apparentRate(x, fs, n) - apparent) < 0.06);
    if (!ok.some(Boolean) || ok.every(Boolean)) return null;
    // Options that sit near the ambiguity boundary are not allowed.
    if (opts.some((x) => Math.abs(Math.abs(wrap((n * x) / fs)) - 0.5) < 0.06)) return null;
  }
  const truth: Sig = { A: 1, f, ph: 0 };
  return { kind: 'wheel', truth, fs, noise: 0, ys: [], wheel: { f, spokes: n, apparent, inverse, options, ok } };
}

function genFreqs(r: Rng, band: Band): AliasRound | null {
  const fs = r.pick(band === 0 ? [4] : [2, 2.5, 3, 4]);
  const noise = NOISE[band];
  const f0 = r.pick([0.5, 1, 1.5].filter((x) => x < fs / 2 - 1e-9));
  if (f0 === undefined) return null;
  const maxChip = [4, 6, 7.5, 9][band];
  const chips = Array.from({ length: Math.round(maxChip / 0.5) }, (_, i) => (i + 1) * 0.5);
  const truth: Sig = { A: r.range(0.7, 1), f: r.pick(chips.filter((c) => isAlias(c, f0, fs))), ph: r.range(0, TAU) };
  const ys = sample(truth, fs, noise, r);
  const ok = chips.map((c) => isAlias(c, f0, fs));
  // Every non-alias chip must be clearly inconsistent (LS RMS above twice the noise, and visibly off).
  for (let i = 0; i < chips.length; i++) if (!ok[i] && fitFreq(chips[i], fs, ys).rms < Math.max(2 * noise, 0.12)) return null;
  if (ok.filter(Boolean).length < 2) return null;
  return { kind: 'freqs', truth, fs, noise, ys, chips, ok, preview: band <= 1 };
}

function genRecon(r: Rng, band: Band): AliasRound | null {
  const fs = r.pick([3, 4, 5]);
  const fa = Math.round(r.range(0.3, fs / 2 - 0.3) * 100) / 100;
  const m = r.int(1, band >= 2 ? 3 : 2);
  const f0 = r.next() < 0.5 ? m * fs + fa : m * fs - fa;
  const base: Sig = { A: band >= 1 ? Math.round(r.range(0.5, 1) * 100) / 100 : 1, f: fa, ph: r.range(0, TAU) };
  const truth = aliasAt(base, f0, fs);
  return { kind: 'recon', truth, fs, noise: 0, ys: sample(truth, fs, 0), freeA: band >= 1 };
}

export const FAMILIES: Family<AliasRound>[] = [
  { id: 'identify', name: 'Which signal?', teach: 'The dots are samples of a hidden wave. Tap every candidate that passes through all of them — there can be more than one.', bands: [0, 3], intro: true, gen: genIdentify, sig: (rd) => `${rd.fs}|${rd.truth.f.toFixed(1)}|${rd.ok!.filter(Boolean).length}` },
  { id: 'resample', name: 'Resample', teach: 'Two different waves give identical samples at this rate. Pick a sampling rate that tells them apart.', bands: [1, 3], gen: genResample, sig: (rd) => `${rd.fs}|${rd.pair![0].f}|${rd.pair![1].f.toFixed(1)}` },
  { id: 'wheel', name: 'Wagon wheel', teach: 'A camera takes snapshots. Between frames the wheel may turn almost a full turn — and look as if it turned back.', bands: [0, 3], gen: genWheel, sig: (rd) => `${rd.wheel!.spokes}|${rd.fs}|${Math.sign(rd.wheel!.apparent)}|${rd.wheel!.inverse}` },
  { id: 'freqs', name: 'Which frequencies?', teach: 'Amplitude and phase are free. Tap every frequency that could produce these samples.', bands: [1, 3], gen: genFreqs, sig: (rd) => `${rd.fs}|${rd.ok!.map(Number).join('')}` },
  { id: 'recon', name: 'Reconstruct', teach: 'Fit the slowest wave that passes through the samples (≤ half the sampling rate). It may not be the original.', bands: [0, 3], gen: genRecon, sig: (rd) => `${rd.fs}|${rd.truth.f.toFixed(2)}` },
];

export const ROUNDS = 5;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sliders = new Sliders();
  const sess = new Session<AliasRound>(api, 'alias', FAMILIES, ROUNDS);
  let rd: AliasRound;
  let phase: 'play' | 'reveal' | 'done' = 'play';
  let sel = new Set<number>();
  let rec: Sig = { A: 1, f: 0.5, ph: 0 };
  let t0 = 0;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'play';
    sel = new Set();
    rec = { A: rd.freeA ? 0.75 : rd.truth.A, f: rd.fs / 4, ph: 0 };
    t0 = performance.now();
    sliders.focus = 0;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const w = rd.wheel;
    const ask =
      rd.kind === 'identify'
        ? 'Which candidates could have produced these samples? Tap all that fit.'
        : rd.kind === 'resample'
          ? 'These two waves give identical samples. Pick a new rate that tells them apart.'
          : rd.kind === 'wheel'
            ? w!.inverse
              ? `The film (${rd.fs} frames/s) shows this. Which true speeds could produce it? Tap all.`
              : `The wheel turns clockwise at ${w!.f.toFixed(1)} rev/s; the camera films ${rd.fs} frames/s. What does the film show?`
            : rd.kind === 'freqs'
              ? `Sampled at ${rd.fs}/s. Which frequencies could fit (any amplitude and phase)? Tap all.`
              : `Sampled at ${rd.fs}/s. Fit the slowest wave (≤ ${(rd.fs / 2).toFixed(1)} Hz) through the samples.`;
    api.prompt(ask, sess.teach || (rd.noise ? `Samples carry noise up to ±${rd.noise.toFixed(2)} (bars)` : 'Samples are exact'));
    stage.request();
  }

  const fmtRate = (x: number) => (Math.abs(x) < 0.05 ? 'standing still' : `${x > 0 ? 'clockwise' : 'anticlockwise'} ${Math.abs(x).toFixed(1)} rev/s`);

  function submit(pick?: number) {
    if (phase !== 'play') return;
    let pen = 0;
    let main = '';
    let sub = '';
    if (rd.kind === 'recon') {
      const ts = times(rd.fs);
      const rms = Math.sqrt(ts.reduce((a, t, k) => a + (val(rec, t) - rd.ys[k]) ** 2, 0) / ts.length) / rd.truth.A;
      pen = rms <= 0.06 ? (rms / 0.06) * 0.15 : Math.min(1, 0.15 + (rms - 0.06) / 0.3);
      main = rms <= 0.06 ? `Fits — ${rec.f.toFixed(2)} Hz through every sample.` : `Misses the samples by ${(rms * 100).toFixed(0)}% RMS.`;
      sub = `The original was ${rd.truth.f.toFixed(2)} Hz: sampled at ${rd.fs}/s it is indistinguishable from its ${Math.abs(apparentRate(rd.truth.f, rd.fs, 1)).toFixed(2)} Hz alias — the slowest fit is what a reconstruction filter outputs.`;
      sess.done(pen, `${rec.f.toFixed(2)} Hz fit · ${(rms * 100).toFixed(1)}% RMS · original ${rd.truth.f.toFixed(2)} Hz`, { x: stage.w / 2, y: 120 });
    } else if (rd.kind === 'resample' || (rd.kind === 'wheel' && !rd.wheel!.inverse)) {
      if (pick === undefined) return;
      sel = new Set([pick]);
      const right = (rd.kind === 'wheel' ? rd.wheel!.ok : rd.ok!)[pick];
      pen = right ? 0 : 1;
      if (rd.kind === 'resample') {
        const rate = rd.rates![pick];
        main = right ? `At ${rate}/s the two waves give different samples.` : `At ${rate}/s they still alias: ${rd.pair![1].f.toFixed(1)} − ${rd.pair![0].f.toFixed(1)} or their sum is a multiple of ${rate}.`;
        sub = 'Two frequencies are confused when their difference (or sum) is a whole multiple of the sampling rate.';
      } else {
        const w = rd.wheel!;
        main = right ? `Right — the film shows it ${fmtRate(w.apparent)}.` : `The film shows it ${fmtRate(w.apparent)}.`;
        sub = `Each frame it turns ${((w.f / rd.fs) * w.spokes).toFixed(2)} of a ${w.spokes > 1 ? 'spoke spacing' : 'turn'}; only the fractional part is visible.`;
      }
      sess.done(pen, main, { x: stage.w / 2, y: 120 });
    } else {
      const ok = rd.kind === 'wheel' ? rd.wheel!.ok : rd.ok!;
      let fp = 0;
      let fn = 0;
      ok.forEach((o, i) => {
        if (sel.has(i) && !o) fp++;
        if (!sel.has(i) && o) fn++;
      });
      pen = Math.min(1, 0.4 * (fp + fn));
      const nOk = ok.filter(Boolean).length;
      main = fp + fn ? `${nOk} fitted; you had ${fn} missing and ${fp} wrong.` : `Exactly the ${nOk} that fit.`;
      sub =
        rd.kind === 'freqs'
          ? `They are ${rd.chips!.filter((_, i) => ok[i]).join(', ')} Hz: f and every f ± k·${rd.fs} (and k·${rd.fs} − f) give the same samples.`
          : rd.kind === 'wheel'
            ? 'Speeds differing by a whole number of spoke-steps per frame give the same film.'
            : 'Waves whose frequencies differ by a multiple of the sampling rate pass through the same samples.';
      sess.done(pen, main, { x: stage.w / 2, y: 120 });
    }
    phase = 'reveal';
    t0 = performance.now();
    api.sfx[pen < 0.5 ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per round (wrong inferences, missed aliases, misfit)', share: 'ALIAS' });
      if (r) bench.finish(r);
    }
    stage.request();
  }

  function toggle(i: number) {
    if (phase !== 'play') return;
    sel.has(i) ? sel.delete(i) : sel.add(i);
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
    else if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      const n = rd.cands?.length ?? rd.rates?.length ?? rd.wheel?.options.length ?? rd.chips?.length ?? 0;
      if (i < n) rd.kind === 'resample' || (rd.kind === 'wheel' && !rd.wheel!.inverse) ? submit(i) : toggle(i);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rd.kind !== 'resample' && !(rd.kind === 'wheel' && !rd.wheel!.inverse)) submit();
    }
  };

  /** Plot area: samples, error bars and curves over 0 … T. */
  function plot(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, curves: { s: Sig; color: string; w?: number; dash?: number[] }[], fs: number, ys: number[], noise: number, showSamples = true) {
    plate(c, x - 6, y - 6, w + 12, h + 12, 8);
    const ty = (v: number) => y + h / 2 - (v / 1.25) * (h / 2);
    c.strokeStyle = pal.line2;
    c.beginPath();
    c.moveTo(x, y + h / 2);
    c.lineTo(x + w, y + h / 2);
    c.stroke();
    for (let s = 0; s <= T; s += 0.5) text(c, `${s}s`, x + (s / T) * w, y + h + 14, font.mono(9), pal.ink3, 'center');
    for (const cu of curves) {
      c.save();
      c.strokeStyle = cu.color;
      c.lineWidth = cu.w ?? 1.5;
      c.setLineDash(cu.dash ?? []);
      c.beginPath();
      const N = Math.max(200, Math.ceil(cu.s.f * T * 24));
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * T;
        const px = x + (t / T) * w;
        const py = ty(val(cu.s, t));
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.stroke();
      c.restore();
    }
    if (!showSamples) return;
    times(fs).forEach((t, k) => {
      const px = x + (t / T) * w;
      if (noise) {
        c.fillStyle = alpha(pal.accent, 0.25);
        c.fillRect(px - 1, ty(ys[k] + noise), 2, ty(ys[k] - noise) - ty(ys[k] + noise));
      }
      c.beginPath();
      c.arc(px, ty(ys[k]), 4, 0, TAU);
      c.fillStyle = pal.accent;
      c.fill();
    });
  }

  function drawWheel(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, ang: number, spokes: number, blur = 0) {
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, TAU);
    c.strokeStyle = pal.ink2;
    c.lineWidth = 2;
    c.stroke();
    for (let k = 0; k < spokes; k++) {
      const a = ang * TAU + (k * TAU) / spokes - Math.PI / 2;
      if (blur > 0.02) {
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, R * 0.92, a - blur * TAU, a);
        c.closePath();
        c.fillStyle = alpha(pal.ink, 0.12);
        c.fill();
      }
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
      c.strokeStyle = k === 0 ? AMBER : pal.ink;
      c.lineWidth = 3;
      c.stroke();
    }
    c.restore();
  }

  stage.draw = (now) => {
    bench.frame();
    sliders.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const reveal = phase !== 'play';
    const px = 24;
    const pw = W - 48;
    const py = 116;
    const ph = Math.min(200, (H - py) * 0.36);
    const by = py + ph + 34;
    let anim = false;
    if (rd.kind === 'identify') {
      const curves: { s: Sig; color: string; w?: number; dash?: number[] }[] = [...sel].map((i) => ({ s: rd.cands![i], color: reveal ? (rd.ok![i] ? pal.accent : pal.signal) : AMBER, w: 1.5 }));
      if (reveal) rd.cands!.forEach((s, i) => !sel.has(i) && rd.ok![i] && curves.push({ s, color: pal.accent, w: 1, dash: [4, 4] }));
      plot(c, px, py, pw, ph, curves, rd.fs, rd.ys, rd.noise);
      const n = rd.cands!.length;
      const cw = (pw - (n - 1) * 10) / n;
      const chH = Math.min(90, H - by - 80);
      rd.cands!.forEach((s, i) => {
        const x = px + i * (cw + 10);
        const on = sel.has(i);
        rr(c, x, by, cw, chH, 6);
        c.fillStyle = on ? alpha(AMBER, 0.1) : pal.paper2;
        c.fill();
        c.strokeStyle = reveal ? (rd.ok![i] ? pal.accent : on ? pal.signal : pal.line) : on ? AMBER : pal.line;
        c.lineWidth = on || (reveal && rd.ok![i]) ? 1.5 : 1;
        c.stroke();
        c.save();
        c.beginPath();
        c.rect(x + 4, by + 4, cw - 8, chH - 24);
        c.clip();
        c.strokeStyle = pal.ink;
        c.lineWidth = 1.25;
        c.beginPath();
        for (let k = 0; k <= 240; k++) {
          const t = (k / 240) * T;
          const yy = by + 4 + (chH - 24) / 2 - (val(s, t) / 1.3) * ((chH - 24) / 2);
          const xx = x + 4 + (t / T) * (cw - 8);
          k ? c.lineTo(xx, yy) : c.moveTo(xx, yy);
        }
        c.stroke();
        c.restore();
        text(c, `${i + 1} · ${s.f.toFixed(1)} Hz`, x + cw / 2, by + chH - 8, font.mono(10, 500), pal.ink2, 'center');
        if (!reveal) bench.hit(x, by, cw, chH, () => toggle(i));
      });
      if (!reveal) bench.button(c, W / 2 - 80, by + chH + 14, 160, 40, `Submit · ${sel.size}`, () => submit(), { primary: true, key: 'Enter' });
    } else if (rd.kind === 'resample') {
      const [s1, s2] = rd.pair!;
      const pick = [...sel][0];
      plot(c, px, py, pw, ph, [{ s: s1, color: pal.ink2, w: 1.25 }, { s: s2, color: alpha(AMBER, 0.8), w: 1 }], reveal ? rd.rates![pick] : rd.fs, reveal ? sample(s1, rd.rates![pick], 0) : rd.ys, 0);
      if (reveal) {
        // The second wave's samples at the chosen rate, as rings.
        times(rd.rates![pick]).forEach((t) => {
          const xx = px + (t / T) * pw;
          const yy = py + ph / 2 - (val(s2, t) / 1.25) * (ph / 2);
          c.beginPath();
          c.arc(xx, yy, 6, 0, TAU);
          c.strokeStyle = AMBER;
          c.lineWidth = 1.5;
          c.stroke();
        });
      }
      text(c, `grey ${s1.f.toFixed(1)} Hz · amber ${s2.f.toFixed(1)} Hz · now ${rd.fs} samples/s`, W / 2, by + 4, font.mono(11, 500), pal.ink2, 'center');
      bench.row(
        c,
        W / 2,
        by + 22,
        Math.min(640, W - 32),
        rd.rates!.map((x, i) => ({ label: `${x} /s`, run: () => submit(i), o: { key: String(i + 1), off: reveal, sel: reveal && (i === pick || rd.ok![i]), color: reveal ? (rd.ok![i] ? pal.accent : pal.signal) : undefined } })),
        48,
      );
    } else if (rd.kind === 'wheel') {
      const w = rd.wheel!;
      const R = Math.min(90, (H - py) * 0.24);
      const cy = py + R + 10;
      const tt = (now - t0) / 1000;
      const slow = 0.25; // the real wheel is shown slowed down 4× so its motion can be followed
      const frameAng = (k: number) => (w.f * k) / rd.fs;
      if (w.inverse || reveal) {
        const k = Math.floor(tt * rd.fs * slow);
        drawWheel(c, W / 2 + (reveal ? R * 1.6 : 0), cy, R, frameAng(k), w.spokes);
        text(c, `film · ${rd.fs} frames/s (slowed 4×)`, W / 2 + (reveal ? R * 1.6 : 0), cy + R + 20, font.mono(10, 500), pal.ink3, 'center');
        anim = true;
      }
      if (reveal || !w.inverse) {
        const real = reveal ? w.f * tt * slow : 0;
        drawWheel(c, W / 2 - (reveal ? R * 1.6 : 0), cy, R, real, w.spokes, reveal ? Math.min(0.45, w.f / rd.fs) : 0);
        text(c, reveal ? `real · ${w.f.toFixed(1)} rev/s (slowed 4×)` : `real · ${w.f.toFixed(1)} rev/s clockwise`, W / 2 - (reveal ? R * 1.6 : 0), cy + R + 20, font.mono(10, 500), pal.ink3, 'center');
      }
      const oy = cy + R + 44;
      const items = w.options.map((x, i) => ({
        label: w.inverse ? `${x.toFixed(1)} rev/s` : fmtRate(x),
        run: () => (w.inverse ? toggle(i) : submit(i)),
        o: { key: String(i + 1), off: reveal, sel: reveal ? w.ok[i] || sel.has(i) : sel.has(i), color: reveal ? (w.ok[i] ? pal.accent : pal.signal) : AMBER, px: 12 },
      }));
      bench.row(c, W / 2, oy, Math.min(720, W - 32), items, 46);
      if (w.inverse && !reveal) bench.button(c, W / 2 - 80, oy + 58, 160, 40, `Submit · ${sel.size}`, () => submit(), { primary: true, key: 'Enter' });
    } else if (rd.kind === 'freqs') {
      const curves: { s: Sig; color: string; w?: number }[] = [];
      if (rd.preview || reveal) for (const i of sel) curves.push({ s: fitFreq(rd.chips![i], rd.fs, rd.ys).sig, color: reveal ? (rd.ok![i] ? pal.accent : pal.signal) : AMBER, w: 1.25 });
      plot(c, px, py, pw, ph, curves, rd.fs, rd.ys, rd.noise);
      const n = rd.chips!.length;
      const cols = Math.min(n, Math.max(4, Math.floor((W - 32) / 74)));
      const cw = Math.min(70, (W - 32 - (cols - 1) * 8) / cols);
      const x0 = W / 2 - (cols * cw + (cols - 1) * 8) / 2;
      rd.chips!.forEach((f, i) => {
        const x = x0 + (i % cols) * (cw + 8);
        const y = by + Math.floor(i / cols) * 46;
        bench.button(c, x, y, cw, 38, `${f} Hz`, () => toggle(i), { off: reveal, sel: sel.has(i) || (reveal && rd.ok![i]), color: reveal ? (rd.ok![i] ? pal.accent : pal.signal) : AMBER, px: 12 });
      });
      if (!reveal) bench.button(c, W / 2 - 80, by + Math.ceil(n / cols) * 46 + 6, 160, 40, `Submit · ${sel.size}`, () => submit(), { primary: true, key: 'Enter' });
      if (!rd.preview && !reveal) text(c, 'no previews at this level — reason from the sampling rate', W / 2, py + ph + 24, font.mono(10, 500), pal.ink3, 'center');
    } else {
      const curves = [{ s: rec, color: AMBER, w: 2 }];
      if (reveal) curves.unshift({ s: rd.truth, color: alpha(pal.ink, 0.45), w: 1 });
      plot(c, px, py, pw, ph, curves, rd.fs, rd.ys, 0);
      const sw = Math.min(420, W - 48);
      const sx = W / 2 - sw / 2;
      const on = !reveal;
      sliders.draw(c, sx, by + 20, sw, 'FREQUENCY', 0.05, rd.fs / 2, () => rec.f, (v) => (rec = { ...rec, f: v }), (v) => `${v.toFixed(2)} Hz`, { step: 0.01, off: !on, color: AMBER });
      sliders.draw(c, sx, by + 70, sw, 'PHASE', 0, 360, () => (((rec.ph * 180) / Math.PI) % 360 + 360) % 360, (v) => (rec = { ...rec, ph: (v * Math.PI) / 180 }), (v) => `${v.toFixed(0)}°`, { step: 1, off: !on, color: AMBER });
      if (rd.freeA) sliders.draw(c, sx, by + 120, sw, 'AMPLITUDE', 0.2, 1.2, () => rec.A, (v) => (rec = { ...rec, A: v }), (v) => v.toFixed(2), { step: 0.01, off: !on, color: AMBER });
      if (on) bench.button(c, W / 2 - 80, by + (rd.freeA ? 150 : 100), 160, 40, 'Lock', () => submit(), { primary: true, key: 'Enter' });
    }
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return anim;
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
