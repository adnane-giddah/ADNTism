// 38 · LENGTH — rank the paths by their true length, longest first.
// All paths are drawn at the same scale (lengths are compared on screen, in u). Segments and polylines are
// summed exactly; arcs are rθ; sine waves and cubic Béziers are integrated numerically
// (L = ∫√(x′² + y′²) dt, adaptive Simpson, tolerance 10⁻⁹ u); piecewise paths add their parts. Each path is
// built at a random size and then scaled to its exact target length (length scales linearly). Endpoint
// distance is never used as a length: on Hard the longest path is often the most coiled.
import { font, pal, text } from '../core/draw';
import { alpha, plate } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { bbox, integrate, P } from './geom';
import { badge, Bench, mean, pairScore, Ranker, roundStrip, trueOrder, type Pt } from './kit';

export type Seg =
  | { t: 'line'; a: Pt; b: Pt }
  | { t: 'arc'; c: Pt; r: number; a0: number; a1: number }
  | { t: 'sine'; a: Pt; len: number; amp: number; k: number; ang: number }
  | { t: 'bez'; p: [Pt, Pt, Pt, Pt] };
export interface Path {
  kind: string;
  segs: Seg[];
  length: number;
  chord: number; // endpoint distance (for the results: how misleading it was)
}

export function segLength(s: Seg): number {
  if (s.t === 'line') return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  if (s.t === 'arc') return s.r * Math.abs(s.a1 - s.a0);
  if (s.t === 'sine') return integrate((x) => Math.sqrt(1 + (s.amp * s.k * Math.cos(s.k * x)) ** 2), 0, s.len, 1e-10);
  const [p0, p1, p2, p3] = s.p;
  return integrate(
    (t) => {
      const u = 1 - t;
      const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
      const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
      return Math.hypot(dx, dy);
    },
    0,
    1,
    1e-10,
  );
}
export const pathLength = (segs: Seg[]) => segs.reduce((s, g) => s + segLength(g), 0);

/** Points along a segment (drawing only). */
export function sample(s: Seg, n = 64): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (s.t === 'line') out.push(P(s.a.x + (s.b.x - s.a.x) * t, s.a.y + (s.b.y - s.a.y) * t));
    else if (s.t === 'arc') {
      const a = s.a0 + (s.a1 - s.a0) * t;
      out.push(P(s.c.x + s.r * Math.cos(a), s.c.y + s.r * Math.sin(a)));
    } else if (s.t === 'sine') {
      const x = s.len * t;
      const y = s.amp * Math.sin(s.k * x);
      out.push(P(s.a.x + x * Math.cos(s.ang) - y * Math.sin(s.ang), s.a.y + x * Math.sin(s.ang) + y * Math.cos(s.ang)));
    } else {
      const [p0, p1, p2, p3] = s.p;
      const u = 1 - t;
      out.push(P(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y));
    }
  }
  return out;
}

function scaleSeg(s: Seg, k: number): Seg {
  const m = (p: Pt) => P(p.x * k, p.y * k);
  if (s.t === 'line') return { t: 'line', a: m(s.a), b: m(s.b) };
  if (s.t === 'arc') return { ...s, c: m(s.c), r: s.r * k };
  if (s.t === 'sine') return { ...s, a: m(s.a), len: s.len * k, amp: s.amp * k, k: s.k / k };
  return { t: 'bez', p: s.p.map(m) as [Pt, Pt, Pt, Pt] };
}

const KINDS = ['line', 'polyline', 'arc', 'sine', 'bezier', 'piecewise'] as const;
function rawPath(r: Rng, kind: (typeof KINDS)[number], coil: boolean): Seg[] {
  const ang = r.range(0, Math.PI * 2);
  if (kind === 'line') return [{ t: 'line', a: P(0, 0), b: P(Math.cos(ang), Math.sin(ang)) }];
  if (kind === 'polyline') {
    const n = coil ? r.int(5, 7) : r.int(2, 4);
    const pts = [P(0, 0)];
    let a = ang;
    for (let i = 0; i < n; i++) {
      a += r.range(coil ? 1.4 : 0.4, coil ? 2.4 : 1.4) * r.sign();
      const l = r.range(0.4, 1);
      pts.push(P(pts[i].x + l * Math.cos(a), pts[i].y + l * Math.sin(a)));
    }
    return pts.slice(1).map((b, i) => ({ t: 'line', a: pts[i], b }));
  }
  if (kind === 'arc') {
    const span = coil ? r.range(3.6, 5.6) : r.range(1, 3);
    return [{ t: 'arc', c: P(0, 0), r: 1, a0: ang, a1: ang + span * r.sign() }];
  }
  if (kind === 'sine') {
    const cycles = coil ? r.range(2.5, 4.5) : r.range(1, 2);
    const len = 3;
    return [{ t: 'sine', a: P(0, 0), len, amp: r.range(coil ? 0.35 : 0.15, coil ? 0.55 : 0.4), k: (cycles * 2 * Math.PI) / len, ang }];
  }
  if (kind === 'bezier') {
    const q = () => P(r.range(-1, 1), r.range(-1, 1));
    return [{ t: 'bez', p: [P(0, 0), q(), q(), P(r.range(-1, 1), r.range(-1, 1))] }];
  }
  // Piecewise: a line, then an arc, then a line.
  const l1 = r.range(0.5, 1);
  const a = P(l1 * Math.cos(ang), l1 * Math.sin(ang));
  const turn = r.range(1.2, 3) * r.sign();
  const rad = r.range(0.3, 0.6);
  const n = ang + (turn > 0 ? Math.PI / 2 : -Math.PI / 2);
  const c = P(a.x + rad * Math.cos(n), a.y + rad * Math.sin(n));
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const end = P(c.x + rad * Math.cos(a0 + turn), c.y + rad * Math.sin(a0 + turn));
  const dir = ang + turn;
  const l2 = r.range(0.4, 1);
  return [
    { t: 'line', a: P(0, 0), b: a },
    { t: 'arc', c, r: rad, a0, a1: a0 + turn },
    { t: 'line', a: end, b: P(end.x + l2 * Math.cos(dir), end.y + l2 * Math.sin(dir)) },
  ];
}

/** A path of exactly `len` u (to integration tolerance), fitting a 90 u box, centred. */
export function makePath(r: Rng, kind: (typeof KINDS)[number], len: number, coil: boolean): Path | null {
  const raw = rawPath(r, kind, coil);
  const k = len / pathLength(raw);
  let segs = raw.map((s) => scaleSeg(s, k));
  const pts = segs.flatMap((s) => sample(s, 24));
  const bb = bbox(pts);
  if (bb.w > 90 || bb.h > 90) return null;
  const dx = -(bb.x0 + bb.x1) / 2;
  const dy = -(bb.y0 + bb.y1) / 2;
  segs = segs.map((s) => moveSeg(s, dx, dy));
  const all = segs.flatMap((s) => sample(s, 2));
  return { kind, segs, length: pathLength(segs), chord: Math.hypot(all[all.length - 1].x - all[0].x, all[all.length - 1].y - all[0].y) };
}
function moveSeg(s: Seg, dx: number, dy: number): Seg {
  const m = (p: Pt) => P(p.x + dx, p.y + dy);
  if (s.t === 'line') return { t: 'line', a: m(s.a), b: m(s.b) };
  if (s.t === 'arc') return { ...s, c: m(s.c) };
  if (s.t === 'sine') return { ...s, a: m(s.a) };
  return { t: 'bez', p: s.p.map(m) as [Pt, Pt, Pt, Pt] };
}

const CFG: Record<Level, { n: [number, number]; gap: number; coil: boolean }> = {
  easy: { n: [3, 3], gap: 0.22, coil: false },
  medium: { n: [3, 4], gap: 0.09, coil: false },
  hard: { n: [4, 5], gap: 0.04, coil: true },
};
export const ROUNDS = 6;

export function makeLength(seed: number, level: Level): Path[][] {
  const r = rng(seed);
  const cfg = CFG[level];
  const out: Path[][] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 2000) {
    const n = out.length < ROUNDS / 2 ? cfg.n[0] : cfg.n[1];
    const lens = [r.range(70, 95)];
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] * (1 + cfg.gap * r.range(1, 1.8)));
    if (lens[n - 1] > 230) continue;
    const paths: Path[] = [];
    for (let i = 0; i < n; i++) {
      // Hard: the longest paths are the most coiled (short reach), the shortest the straightest.
      const long = i >= n / 2;
      const kind = cfg.coil ? r.pick(long ? (['arc', 'sine', 'polyline'] as const) : (['line', 'bezier', 'piecewise'] as const)) : r.pick(KINDS);
      let p: Path | null = null;
      for (let t = 0; t < 40 && !p; t++) p = makePath(r, kind, lens[i], cfg.coil && long);
      if (!p) break;
      paths.push(p);
    }
    if (paths.length < n) continue;
    for (let i = n - 1; i > 0; i--) {
      const j = r.int(0, i);
      [paths[i], paths[j]] = [paths[j], paths[i]];
    }
    out.push(paths);
  }
  return out;
}

const LETTERS = 'ABCDE';

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: Path[][] = [];
  let round = 0;
  let phase: 'rank' | 'reveal' | 'done' = 'rank';
  const ranker = new Ranker(3);
  let res: { order: number[]; frac: number; exact: boolean }[] = [];
  let t0 = 0;
  let times: number[] = [];

  function reset(seed: number) {
    bench.clear();
    rounds = makeLength(seed, api.level);
    round = 0;
    res = [];
    times = [];
    begin();
  }
  function begin() {
    phase = 'rank';
    ranker.reset(rounds[round].length);
    t0 = performance.now();
    api.ownKeys(true);
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('Rank the paths by length — longest first.', `Length along the path, not end to end · tap in order (keys 1–${rounds[round].length}) · Enter submits`);
    stage.request();
  }
  function submit() {
    if (phase !== 'rank' || !ranker.done) return;
    const ps = rounds[round];
    const L = ps.map((p) => p.length);
    const s = pairScore(ranker.order, L, true, 1e-6);
    res.push({ order: [...ranker.order], frac: s.frac, exact: s.exact });
    times.push(performance.now() - t0);
    api.judge(s.frac * 100, { x: stage.w / 2, y: 110 });
    api.prompt(s.exact ? 'Exactly right.' : `${s.wrong} of ${s.total} pairs in the wrong order.`, `True order ${trueOrder(L).map((i) => `${LETTERS[i]} ${L[i].toFixed(1)}`).join(' > ')} u${round < ROUNDS - 1 ? ' · tap for the next' : ''}`);
    phase = 'reveal';
    api.ownKeys(false);
    if (round === ROUNDS - 1) finish();
  }
  function finish() {
    phase = 'done';
    const pct = mean(res.map((r) => r.frac)) * 100;
    const exact = res.filter((r) => r.exact).length;
    const rows: [string, string][] = rounds.map((ps, i) => [`${i + 1} · ${ps.map((p) => p.kind).join(', ')}`, `${res[i].exact ? '✓' : '✗'} ${ps.map((p) => p.length.toFixed(1)).join(' / ')} u`]);
    // How often did the player follow the endpoint distance instead of the length?
    let chordPairs = 0;
    rounds.forEach((ps, i) => {
      const o = res[i].order;
      for (let p = 0; p < o.length; p++) for (let q = p + 1; q < o.length; q++) if (ps[o[p]].length < ps[o[q]].length && ps[o[p]].chord > ps[o[q]].chord) chordPairs++;
    });
    rows.push(['Swaps that followed end-to-end distance', String(chordPairs)]);
    rows.push(['Mean time per ranking', `${(mean(times) / 1000).toFixed(1)} s`]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'pairs in the wrong order',
      headline: exact === ROUNDS ? 'Every ranking exact.' : `${pct.toFixed(1)}% of pairs misordered; ${exact} of ${ROUNDS} exact.`,
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct === 0,
      near: pct < 5,
      share: [`LENGTH · ${api.level}`, `${pct.toFixed(1)}% pairs wrong`],
    });
  }
  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    begin();
  }

  bench.onTap = () => phase === 'reveal' && next();
  bench.onKey = (e) => {
    if (e.repeat) return;
    if (phase === 'rank') {
      const d = Number(e.key);
      if (d >= 1 && d <= ranker.n) ranker.toggle(d - 1);
      else if (e.key === 'Backspace') ranker.undo();
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
    } else if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      next();
    }
  };

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    const ps = rounds[round];
    if (!ps) return false;
    const W = stage.w;
    const top = 74;
    const n = ps.length;
    const cols = W >= 700 ? n : W >= 440 ? Math.min(n, 3) : 2;
    const rowsN = Math.ceil(n / cols);
    // One scale for every cell (lengths are compared on screen).
    const cell = Math.max(100, Math.min((W - 32 - (cols - 1) * 12) / cols, (stage.h - top - 110 - (rowsN - 1) * 12) / rowsN, 250));
    const k = cell / 100;
    const x0 = W / 2 - (cols * cell + (cols - 1) * 12) / 2;
    const judged = phase !== 'rank';
    const L = ps.map((p) => p.length);
    const truth = trueOrder(L);
    const mine = judged ? res[round].order : ranker.order;
    ps.forEach((p, i) => {
      const x = x0 + (i % cols) * (cell + 12);
      const y = top + Math.floor(i / cols) * (cell + 12);
      plate(c, x, y, cell, cell, 10);
      const cx = x + cell / 2;
      const cy = y + cell / 2;
      const pts = p.segs.flatMap((s) => sample(s, 80));
      c.beginPath();
      pts.forEach((q, j) => (j ? c.lineTo(cx + q.x * k, cy + q.y * k) : c.moveTo(cx + q.x * k, cy + q.y * k)));
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = judged && truth[0] === i ? pal.accent : pal.ink;
      c.lineWidth = 2.5;
      c.stroke();
      c.lineCap = 'butt';
      // End caps so both ends are unmistakable.
      for (const q of [pts[0], pts[pts.length - 1]]) {
        c.beginPath();
        c.arc(cx + q.x * k, cy + q.y * k, 3, 0, Math.PI * 2);
        c.fillStyle = pal.ink;
        c.fill();
      }
      text(c, LETTERS[i], x + 10, y + 18, font.mono(12, 600), pal.ink2);
      const rk = mine.indexOf(i) + 1;
      if (rk) badge(c, x + cell - 18, y + 18, rk, !judged || Math.abs(L[i] - L[truth[rk - 1]]) < 1e-6 ? pal.accent : pal.signal);
      if (judged) {
        text(c, `${p.length.toFixed(1)} u`, cx, y + cell - 22, font.mono(12, 600), pal.ink, 'center');
        text(c, `end to end ${p.chord.toFixed(1)}`, cx, y + cell - 8, font.mono(10, 500), pal.ink3, 'center');
        c.fillStyle = alpha(pal.accent, 0.5);
        c.fillRect(x + 10, y + cell - 36, ((cell - 20) * p.length) / Math.max(...L), 3);
      } else bench.hit(x, y, cell, cell, () => ranker.toggle(i));
    });
    if (phase === 'rank')
      bench.row(c, W / 2, top + rowsN * (cell + 12) + 4, Math.min(W - 32, 360), [
        { label: 'Clear', run: () => ranker.reset(), o: { off: !ranker.order.length } },
        { label: 'Submit', run: submit, o: { primary: true, off: !ranker.done, key: 'Enter' } },
      ]);
    roundStrip(c, W, stage.h - 8, res.map((r) => (r.exact ? '✓' : (r.frac * 100).toFixed(0))), ROUNDS, round);
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
