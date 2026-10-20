// 45 · LAST LOOK — when to stop looking and commit.
// Offers arrive one at a time; passing is irreversible; the last offer must be taken. Scoring judges each
// decision, not the luck of the draw: the regret of a decision is how much worse (in expectation, at that
// moment) it was than the better of accept / pass under the optimal policy for the stated objective.
//   best       pick the single best of N (values only compared). Optimal play uses relative ranks; the
//              win probability of accepting the best-so-far at k is k/N, of passing V(k) (backward
//              induction). Regret is in win probability, normalised by the optimal policy's chance.
//   threshold  the distribution is shown: maximise the value taken. W(k) = E[max(X, W(k+1))].
//   cost       the same, but every pass costs c points: W(k) = E[max(X, W(k+1) − c)].
//   unknown    only examples of the distribution are shown. The reference policy uses exactly what you
//              could know — the examples plus the offers seen so far — never the hidden distribution.
//   shift      the source may change once at an unknown point. The reference knows the regime in force,
//              but only two offers after the change, so a change you could not yet see costs nothing.
// Sequences are seeded i.i.d. draws; sequences with no decent offer at all are discarded.
import { clamp, font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

export type Pmf = number[]; // index = value 0…99
export interface LookRound {
  kind: 'best' | 'threshold' | 'cost' | 'unknown' | 'shift';
  vals: number[];
  dist?: Pmf;
  distName?: string;
  dist2?: Pmf;
  change?: number;
  cost?: number;
  examples?: number[];
}

const norm = (p: number[]) => {
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / s);
};
export const uniform = (lo: number, hi: number): Pmf => norm(Array.from({ length: 100 }, (_, v) => (v >= lo && v <= hi ? 1 : 0)));
export const gauss = (mu: number, sd: number): Pmf => norm(Array.from({ length: 100 }, (_, v) => (v >= 1 ? Math.exp(-0.5 * ((v - mu) / sd) ** 2) : 0)));
const skew = (lo: number, s: number): Pmf => norm(Array.from({ length: 100 }, (_, v) => (v >= lo ? Math.exp(-(v - lo) / s) : 0)));
const mix = (a: Pmf, b: Pmf, w = 0.5): Pmf => norm(a.map((x, i) => w * x + (1 - w) * b[i]));
export const mean = (p: Pmf) => p.reduce((a, x, v) => a + x * v, 0);
const draw = (p: Pmf, r: Rng) => {
  let u = r.next();
  for (let v = 0; v < 100; v++) if ((u -= p[v]) <= 0) return v;
  return 99;
};
const quantile = (p: Pmf, q: number) => {
  let s = 0;
  for (let v = 0; v < 100; v++) if ((s += p[v]) >= q) return v;
  return 99;
};
export const empirical = (xs: number[]): Pmf => norm(Array.from({ length: 100 }, (_, v) => xs.filter((x) => x === v).length + 1e-9));

/** W[k] = expected value after passing k offers (k = 0…N−1), with cost c per pass; W[N−1] = E[X]. */
export function contValues(p: Pmf, N: number, c = 0) {
  const W = Array(N).fill(0);
  W[N - 1] = mean(p);
  for (let k = N - 2; k >= 0; k--) {
    const cont = W[k + 1] - c;
    W[k] = p.reduce((a, x, v) => a + x * Math.max(v, cont), 0);
  }
  return W;
}

/** Secretary: V[k] = win probability after passing k offers, playing optimally. */
export function secretaryV(N: number) {
  const V = Array(N + 1).fill(0);
  for (let k = N - 1; k >= 0; k--) V[k] = (1 / (k + 1)) * Math.max((k + 1) / N, V[k + 1]) + (k / (k + 1)) * V[k + 1];
  return V;
}

const DISTS: { name: string; mk: (r: Rng) => Pmf }[] = [
  { name: 'uniform', mk: (r) => uniform(r.int(5, 25), r.int(80, 99)) },
  { name: 'bell', mk: (r) => gauss(r.range(45, 60), r.range(10, 16)) },
  { name: 'skewed', mk: (r) => skew(r.int(5, 20), r.range(12, 20)) },
  { name: 'two humps', mk: (r) => mix(gauss(r.range(22, 32), 7), gauss(r.range(68, 80), 7), r.range(0.45, 0.7)) },
];

const lengths = [8, 11, 14, 18];

function ok(vals: number[], p: Pmf) {
  // No sequence made entirely of poor offers.
  return Math.max(...vals) >= quantile(p, 0.6);
}

function genBest(r: Rng, band: Band): LookRound {
  const N = lengths[band];
  const pool = Array.from({ length: 99 }, (_, i) => i + 1);
  const vals: number[] = [];
  while (vals.length < N) vals.push(...pool.splice(r.int(0, pool.length - 1), 1));
  return { kind: 'best', vals };
}

function genValue(r: Rng, band: Band, kind: 'threshold' | 'cost' | 'unknown'): LookRound | null {
  const N = lengths[band];
  const d = r.pick(DISTS);
  const p = d.mk(r);
  const vals = Array.from({ length: N }, () => draw(p, r));
  if (!ok(vals, p)) return null;
  const rd: LookRound = { kind, vals, dist: p, distName: d.name };
  if (kind === 'cost') rd.cost = Math.round(r.range(2, 5 + band));
  if (kind === 'unknown') rd.examples = Array.from({ length: [10, 8, 6, 5][band] }, () => draw(p, r));
  return rd;
}

function genShift(r: Rng, band: Band): LookRound | null {
  const N = 12;
  const mu1 = r.range(35, 60);
  const sd = r.range(8, 12);
  const up = r.next() < 0.5;
  // The change is large enough to be detectable: at least 1.5 standard deviations.
  const mu2 = clamp(mu1 + (up ? 1 : -1) * r.range(1.5, 2.5 - band * 0.2) * sd, 10, 90);
  const p1 = gauss(mu1, sd);
  const p2 = gauss(mu2, sd);
  const change = r.int(4, 8);
  const vals = Array.from({ length: N }, (_, i) => draw(i < change ? p1 : p2, r));
  if (!ok(vals, p1)) return null;
  return { kind: 'shift', vals, dist: p1, distName: 'bell', dist2: p2, change };
}

export const FAMILIES: Family<LookRound>[] = [
  { id: 'threshold', name: 'Known odds', teach: 'You know how offers are distributed. Take an offer only if it beats what waiting is worth — that bar drops as offers run out.', bands: [0, 3], intro: true, gen: (r, b) => genValue(r, b, 'threshold'), sig: (rd) => `${rd.distName}|${rd.vals.length}|${rd.vals.indexOf(Math.max(...rd.vals))}` },
  { id: 'best', name: 'Best of N', teach: 'Only the very best offer counts. Watch some offers to learn what “good” is, then take the first that beats them all.', bands: [0, 3], gen: genBest, sig: (rd) => `${rd.vals.length}|${rd.vals.indexOf(Math.max(...rd.vals))}` },
  { id: 'cost', name: 'Cost of waiting', teach: 'Every pass costs points. Waiting is now expensive — the bar for accepting falls faster.', bands: [1, 3], gen: (r, b) => genValue(r, b, 'cost'), sig: (rd) => `${rd.distName}|${rd.cost}|${rd.vals.length}` },
  { id: 'unknown', name: 'Unknown odds', teach: 'You only get examples of the offers. Judge the distribution from them — and from what you see as you go.', bands: [1, 3], gen: (r, b) => genValue(r, b, 'unknown'), sig: (rd) => `${rd.distName}|${rd.vals.length}|${rd.examples!.length}` },
  { id: 'shift', name: 'Changing source', teach: 'The source may change once, without warning. Notice when offers stop looking like the shown distribution.', bands: [1, 3], gen: genShift, sig: (rd) => `${rd.change}|${mean(rd.dist2!) > mean(rd.dist!) ? 'up' : 'down'}` },
];

export const ROUNDS = 5;

/** The two action values at offer k (0-based) given what the reference policy may know. */
export function actionValues(rd: LookRound, k: number, seen: number[]) {
  const N = rd.vals.length;
  const x = rd.vals[k];
  if (rd.kind === 'best') {
    const V = secretaryV(N);
    const cand = seen.slice(0, k).every((v) => v < x);
    return { accept: cand ? (k + 1) / N : 0, pass: k < N - 1 ? V[k + 1] : -Infinity, scale: V[0] };
  }
  let p = rd.dist!;
  if (rd.kind === 'unknown') p = empirical([...rd.examples!, ...seen.slice(0, k + 1)]);
  if (rd.kind === 'shift' && k >= rd.change! + 2) p = rd.dist2!;
  const c = rd.cost ?? 0;
  const W = contValues(p, N, c);
  return { accept: x, pass: k < N - 1 ? W[k + 1] - c : -Infinity, scale: 0.15 * 99 };
}

/** Total regret of a play that accepted offer `at` (all earlier offers passed). */
export function regretOf(rd: LookRound, at: number) {
  let reg = 0;
  const per: number[] = [];
  let scale = 1;
  for (let k = 0; k <= at; k++) {
    const a = actionValues(rd, k, rd.vals);
    scale = a.scale;
    const chosen = k === at ? a.accept : a.pass;
    const best = Math.max(a.accept, a.pass);
    const g = k === rd.vals.length - 1 ? 0 : Math.max(0, best - chosen);
    per.push(g);
    reg += g;
  }
  return { reg, per, scale, pen: Math.min(1, reg / scale) };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<LookRound>(api, 'lastlook', FAMILIES, ROUNDS);
  let rd: LookRound;
  let phase: 'study' | 'play' | 'reveal' | 'done' = 'play';
  let k = 0;
  let took = -1;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    k = 0;
    took = -1;
    phase = 'study';
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const N = rd.vals.length;
    const ask = {
      best: `${N} offers. Win only if you take the single best one.`,
      threshold: `${N} offers from the distribution shown. Take the highest value you can.`,
      cost: `${N} offers; every pass costs ${rd.cost} points. Maximise value minus costs.`,
      unknown: `${N} offers from an unknown source — here are examples. Take the highest value you can.`,
      shift: `${N} offers from the shown distribution — but the source may change once. Take the highest value.`,
    }[rd.kind];
    api.prompt(ask, `${sess.teach ? sess.teach + ' · ' : ''}No time limit · press Begin`);
    stage.request();
  }

  function go() {
    if (phase !== 'study') return;
    phase = 'play';
    api.prompt(`Offer 1 of ${rd.vals.length}`, 'Accept (Enter) or Pass (→) · a pass cannot be undone');
    stage.request();
  }

  function decide(accept: boolean) {
    if (phase !== 'play') return;
    const N = rd.vals.length;
    if (!accept && k < N - 1) {
      k++;
      api.sfx.soft();
      api.prompt(k === N - 1 ? `Last offer — you must take it.` : `Offer ${k + 1} of ${N}`, rd.cost ? `Passes so far cost ${k * rd.cost} points` : 'Accept (Enter) or Pass (→)');
      stage.request();
      return;
    }
    took = k;
    finishRound();
  }

  function finishRound() {
    const N = rd.vals.length;
    const g = regretOf(rd, took);
    const v = rd.vals[took];
    const best = Math.max(...rd.vals);
    const rank = [...rd.vals].sort((a, b) => b - a).indexOf(v) + 1;
    let main = '';
    let sub = '';
    if (rd.kind === 'best') {
      main = rank === 1 ? `You took the best offer (${v}).` : `You took the #${rank} offer (${v}); the best was ${best}.`;
      const cut = Math.round(N / Math.E);
      sub = `Optimal play: let about ${cut} go by, then take the first that beats them all — it wins ${(secretaryV(N)[0] * 100).toFixed(0)}% of the time, so a miss can be good play. Your decision regret: ${(g.pen * 100).toFixed(0)}%.`;
    } else {
      const net = rd.cost ? v - took * rd.cost : v;
      main = `You took ${v}${rd.cost ? ` after ${took} passes (net ${net})` : ''}; the best offer was ${best}.`;
      const worst = g.per.indexOf(Math.max(...g.per));
      sub = g.reg < 0.5 ? 'Every decision matched the optimal policy for what you could know.' : `Expected value given up: ${g.reg.toFixed(1)} points, mostly at offer ${worst + 1} (${rd.vals[worst]}: ${worst === took ? 'taken below the bar' : 'passed above the bar'}).`;
      if (rd.kind === 'shift') sub += ` The source changed after offer ${rd.change} (mean ${mean(rd.dist!).toFixed(0)} → ${mean(rd.dist2!).toFixed(0)}).`;
      if (rd.kind === 'unknown') sub += ` The hidden source was ${rd.distName}, mean ${mean(rd.dist!).toFixed(0)}.`;
    }
    phase = 'reveal';
    sess.done(g.pen, rd.kind === 'best' ? `took #${rank} of ${N} · regret ${(g.pen * 100).toFixed(0)}%` : `took ${v} (best ${best}) · ${g.reg.toFixed(1)} pts regret`, { x: stage.w / 2, y: 120 });
    api.sfx[g.pen < 0.3 ? 'press' : 'release']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean decision regret (expected loss against the optimal policy)', share: 'LAST LOOK' });
      if (r) bench.finish(r);
    }
    stage.request();
  }

  bench.onTap = () => phase === 'reveal' && begin();
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase === 'study' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return go();
    }
    if (phase !== 'play' || e.repeat) return;
    if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') decide(true);
    else if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') decide(false);
    else return;
    e.preventDefault();
  };

  function hist(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: Pmf, color: string) {
    const mx = Math.max(...p);
    c.fillStyle = alpha(color, 0.5);
    for (let v = 0; v < 100; v++) {
      const bh = (p[v] / mx) * h;
      c.fillRect(x + (v / 100) * w, y + h - bh, Math.max(1, w / 100 - 0.5), bh);
    }
    c.fillStyle = pal.line;
    c.fillRect(x, y + h, w, 1);
    for (const t of [0, 50, 99]) text(c, String(t), x + (t / 100) * w, y + h + 12, font.mono(9), pal.ink3, 'center');
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const N = rd.vals.length;
    const reveal = phase === 'reveal' || phase === 'done';
    // Distribution panel.
    const dx = 24;
    const dw = Math.min(360, W - 48);
    const dy = 120;
    const dh = 70;
    plate(c, dx - 8, dy - 18, dw + 16, dh + 38, 8);
    if (rd.kind === 'best') text(c, 'values 1–99, all different · only the best counts', dx, dy + dh / 2, font.mono(11, 500), pal.ink2, 'left', 'middle');
    else if (rd.kind === 'unknown') {
      text(c, 'EXAMPLES FROM THE SOURCE', dx, dy - 4, font.mono(9, 600), pal.ink3);
      c.fillStyle = pal.line;
      c.fillRect(dx, dy + dh - 10, dw, 1);
      rd.examples!.forEach((v, i) => {
        c.beginPath();
        c.arc(dx + (v / 100) * dw, dy + dh - 18 - (i % 3) * 9, 4, 0, Math.PI * 2);
        c.fillStyle = pal.ink2;
        c.fill();
      });
      if (reveal) hist(c, dx, dy + 6, dw, dh - 20, rd.dist!, pal.ink3);
    } else {
      text(c, rd.kind === 'shift' ? 'SOURCE AT THE START' : `DISTRIBUTION · ${rd.distName}`, dx, dy - 4, font.mono(9, 600), pal.ink3);
      hist(c, dx, dy + 6, dw, dh - 20, rd.dist!, pal.ink2);
      if (reveal && rd.dist2) hist(c, dx, dy + 6, dw, dh - 20, rd.dist2, AMBER);
    }
    // The offers.
    const sy = dy + dh + 50;
    const slotW = Math.min(64, (W - 48) / N - 6);
    const x0 = W / 2 - (N * (slotW + 6)) / 2;
    const maxH = Math.min(150, H - sy - 140);
    rd.vals.forEach((v, i) => {
      const x = x0 + i * (slotW + 6);
      const known = reveal || (phase === 'play' && i <= k);
      rr(c, x, sy, slotW, maxH, 5);
      c.fillStyle = i === k && phase === 'play' ? alpha(pal.accent, 0.08) : pal.paper2;
      c.fill();
      c.strokeStyle = i === took ? pal.accent : i === k && phase === 'play' ? alpha(pal.accent, 0.6) : pal.line;
      c.lineWidth = i === took ? 2 : 1;
      c.stroke();
      if (known) {
        const bh = (v / 99) * (maxH - 24);
        const passed = phase === 'play' ? i < k : took >= 0 && i < took;
        c.fillStyle = i === took ? pal.accent : passed ? alpha(pal.ink, 0.25) : reveal ? alpha(pal.ink, 0.45) : pal.ink;
        c.fillRect(x + 6, sy + maxH - 6 - bh, slotW - 12, bh);
        text(c, String(v), x + slotW / 2, sy + 14, font.mono(i === k && phase === 'play' ? 14 : 11, 600), i === took ? pal.accent : pal.ink, 'center', 'middle');
        if (reveal && v === Math.max(...rd.vals)) text(c, 'best', x + slotW / 2, sy + maxH + 12, font.mono(9, 600), pal.ink2, 'center');
      } else text(c, '?', x + slotW / 2, sy + maxH / 2, font.serif(20, true), pal.ink3, 'center', 'middle');
      if (rd.kind === 'shift' && reveal && i === rd.change) {
        c.fillStyle = AMBER;
        c.fillRect(x - 4, sy - 6, 2, maxH + 12);
      }
    });
    // After the round: the optimal bar at each offer (value families) for the reference policy.
    if (reveal && rd.kind !== 'best') {
      c.strokeStyle = alpha(pal.accent, 0.8);
      c.setLineDash([4, 3]);
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < N - 1; i++) {
        const a = actionValues(rd, i, rd.vals);
        const yb = sy + maxH - 6 - (clamp(a.pass, 0, 99) / 99) * (maxH - 24);
        const x = x0 + i * (slotW + 6);
        i ? c.lineTo(x, yb) : c.moveTo(x, yb);
        c.lineTo(x + slotW, yb);
      }
      c.stroke();
      c.setLineDash([]);
      text(c, '- - accept above this bar (optimal for what could be known)', x0, sy + maxH + 26, font.mono(9, 500), pal.accent);
    }
    const by = sy + maxH + 40;
    if (phase === 'study') bench.button(c, W / 2 - 80, by, 160, 44, 'Begin', go, { primary: true, key: 'Enter' });
    if (phase === 'play') {
      const last = k === N - 1;
      bench.row(
        c,
        W / 2,
        by,
        Math.min(360, W - 32),
        [
          { label: last ? 'Take it' : 'Accept', run: () => decide(true), o: { primary: true, key: 'Enter' } },
          { label: 'Pass', run: () => decide(false), o: { key: '→', off: last } },
        ],
        46,
      );
      if (rd.kind === 'cost') text(c, `cost so far ${k * rd.cost!}`, W / 2, by + 64, font.mono(11, 500), AMBER, 'center');
    }
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
