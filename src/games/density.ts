// 29 · DENSITY — which outlined field holds more dots per unit of area?
// Density is global: D = N / A, the number of dots divided by the area of the whole outlined region (even
// where the dots cluster). Fields differ in count, region size and shape, dot size and clustering, so the
// count alone, the size of the field and the look of the crowd are all unreliable shortcuts. The answer is
// computed from the generated data; equal-density rounds (Medium, Hard) use exactly equal N/A.
import { circle, clamp, easeOut, font, line, pal, text } from '../core/draw';
import { plate } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { Bench, mean, roundStrip, type Pt } from './kit';

export const ROUNDS = 8;
export type Region = { kind: 'rect'; w: number; h: number } | { kind: 'circle'; r: number } | { kind: 'ellipse'; a: number; b: number };
export interface Field {
  region: Region;
  area: number; // u², exact
  dots: Pt[]; // centres, relative to the field centre (u)
  s: number; // dot radius (u)
  clustered: boolean;
  n: number;
  d: number; // dots per u²
}
export interface DensityRound {
  f: [Field, Field];
  /** 0: A denser, 1: B denser, 2: exactly equal. */
  answer: 0 | 1 | 2;
  ratio: number; // denser / sparser (1 when equal)
}

export const regionArea = (g: Region) => (g.kind === 'rect' ? g.w * g.h : g.kind === 'circle' ? Math.PI * g.r * g.r : Math.PI * g.a * g.b);

/** Is p inside the region, at least `m` from its edge (conservative for the ellipse)? */
export function insideRegion(g: Region, p: Pt, m: number) {
  if (g.kind === 'rect') return Math.abs(p.x) <= g.w / 2 - m && Math.abs(p.y) <= g.h / 2 - m;
  if (g.kind === 'circle') return Math.hypot(p.x, p.y) <= g.r - m;
  return (p.x / (g.a - m)) ** 2 + (p.y / (g.b - m)) ** 2 <= 1;
}

/** A region of exactly `area` u² that fits a 92 u box. */
function makeRegion(r: Rng, area: number): Region | null {
  const kind = r.pick(['rect', 'rect', 'circle', 'ellipse'] as const);
  if (kind === 'circle') {
    const rad = Math.sqrt(area / Math.PI);
    return rad <= 46 ? { kind, r: rad } : null;
  }
  const asp = r.range(1, 1.9);
  if (kind === 'rect') {
    const w = Math.sqrt(area * asp);
    const g: Region = r.next() < 0.5 ? { kind, w, h: area / w } : { kind, w: area / w, h: w };
    return g.w <= 92 && g.h <= 92 ? g : null;
  }
  const b = Math.sqrt(area / (Math.PI * asp));
  const a = area / (Math.PI * b);
  const g: Region = r.next() < 0.5 ? { kind, a, b } : { kind, a: b, b: a };
  return g.a <= 46 && g.b <= 46 ? g : null;
}

/** Place n non-overlapping dots (gap ≥ 0.9 u) inside the region; uniform or in a few clusters. */
function placeDots(r: Rng, g: Region, n: number, s: number, clustered: boolean): Pt[] | null {
  const pts: Pt[] = [];
  const box = g.kind === 'rect' ? { x: g.w / 2, y: g.h / 2 } : g.kind === 'circle' ? { x: g.r, y: g.r } : { x: g.a, y: g.b };
  const centres = clustered ? Array.from({ length: r.int(2, 4) }, () => ({ x: r.range(-box.x * 0.6, box.x * 0.6), y: r.range(-box.y * 0.6, box.y * 0.6) })) : [];
  const sd = Math.max(5, Math.min(box.x, box.y) * 0.3);
  for (let i = 0; i < n; i++) {
    let ok = false;
    for (let t = 0; t < 900 && !ok; t++) {
      let p: Pt;
      if (clustered && t < 600) {
        const c = centres[i % centres.length];
        p = { x: c.x + r.gauss() * sd, y: c.y + r.gauss() * sd };
      } else p = { x: r.range(-box.x, box.x), y: r.range(-box.y, box.y) };
      if (!insideRegion(g, p, s + 0.3)) continue;
      if (pts.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < (2 * s + 0.9) ** 2)) continue;
      pts.push(p);
      ok = true;
    }
    if (!ok) return null;
  }
  return pts;
}

interface Cfg {
  ratio: [number, number]; // density ratio range, first round → last
  incongruent: number; // share of rounds where the denser field has fewer dots
  equal: number; // number of exactly-equal rounds
  sizes: boolean; // dot sizes differ between fields
  cluster: number; // chance a field is clustered
}
const CFG: Record<Level, Cfg> = {
  easy: { ratio: [2.1, 1.55], incongruent: 0.25, equal: 0, sizes: false, cluster: 0 },
  medium: { ratio: [1.6, 1.25], incongruent: 0.5, equal: 1, sizes: false, cluster: 0.25 },
  hard: { ratio: [1.35, 1.1], incongruent: 0.7, equal: 1, sizes: true, cluster: 0.5 },
};

export function makeDensity(seed: number, level: Level): DensityRound[] {
  const r = rng(seed);
  const cfg = CFG[level];
  const out: DensityRound[] = [];
  const equalAt = new Set<number>();
  while (equalAt.size < cfg.equal) equalAt.add(r.int(2, ROUNDS - 1));
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 4000) {
    const i = out.length;
    const equal = equalAt.has(i);
    const t = i / (ROUNDS - 1);
    const ratio = equal ? 1 : r.range(0.94, 1.06) * (cfg.ratio[0] + (cfg.ratio[1] - cfg.ratio[0]) * t);
    // Sparser field first: N dots in area A.
    const nS = r.int(22, 70);
    const dS = r.range(0.0055, 0.0095);
    const aS = nS / dS;
    // The denser one: fewer dots (incongruent) or more.
    const incon = !equal && r.next() < cfg.incongruent;
    const nD = equal ? Math.round(nS * r.pick([0.6, 0.7, 1.35, 1.5])) : Math.round(nS * (incon ? r.range(0.55, 0.85) : r.range(1.1, 1.5)));
    const aD = equal ? (aS * nD) / nS : nD / (dS * ratio);
    if (nD < 12 || nD > 95 || aS < 1600 || aS > 7600 || aD < 1600 || aD > 7600) continue;
    const gS = makeRegion(r, aS);
    const gD = makeRegion(r, aD);
    if (!gS || !gD) continue;
    const s0 = 1.25;
    const big = cfg.sizes && r.next() < 0.5;
    const sS = cfg.sizes ? (big ? 1.6 : 0.95) : s0;
    const sD = cfg.sizes ? (big ? 0.95 : 1.6) : s0;
    const cS = r.next() < cfg.cluster;
    const cD = !cS && r.next() < cfg.cluster;
    const pS = placeDots(r, gS, nS, sS, cS);
    const pD = placeDots(r, gD, nD, sD, cD);
    if (!pS || !pD) continue;
    const fS: Field = { region: gS, area: regionArea(gS), dots: pS, s: sS, clustered: cS, n: nS, d: nS / regionArea(gS) };
    const fD: Field = { region: gD, area: regionArea(gD), dots: pD, s: sD, clustered: cD, n: nD, d: nD / regionArea(gD) };
    const swap = r.next() < 0.5;
    const f: [Field, Field] = swap ? [fD, fS] : [fS, fD];
    out.push({ f, answer: densityAnswer(f[0], f[1]), ratio: Math.max(f[0].d, f[1].d) / Math.min(f[0].d, f[1].d) });
  }
  return out;
}

/** The answer from the actual fields: equal when N/A agree to 1e-9 (relative). */
export function densityAnswer(a: Field, b: Field): 0 | 1 | 2 {
  if (Math.abs(a.d - b.d) <= 1e-9 * Math.max(a.d, b.d)) return 2;
  return a.d > b.d ? 0 : 1;
}

const EXPOSE: Record<Level, number> = { easy: 3000, medium: 2200, hard: 1600 };
const NAMES = ['A', 'B', 'equal'];

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: DensityRound[] = [];
  let round = 0;
  let phase: 'ready' | 'look' | 'reveal' | 'done' = 'ready';
  let shownAt = 0;
  let answers: { pick: 0 | 1 | 2; ms: number }[] = [];

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 74;
    const bottom = 150;
    const side = W >= 560;
    const F = side ? Math.max(130, Math.min((W - 56) / 2, H - top - bottom, 430)) : Math.max(120, Math.min(W - 32, (H - top - bottom - 16) / 2, 360));
    const boxes = side
      ? [
          { x: W / 2 - F - 12, y: top },
          { x: W / 2 + 12, y: top },
        ]
      : [
          { x: (W - F) / 2, y: top },
          { x: (W - F) / 2, y: top + F + 16 },
        ];
    return { F, boxes, by: boxes[1].y + F + 18 };
  };

  function prompt() {
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('Which field has more dots per unit of area?', `Density = dots ÷ the whole outlined area. The dots show for ${(EXPOSE[api.level] / 1000).toFixed(1)} s · press to look`);
  }

  function reset(seed: number) {
    bench.clear();
    rounds = makeDensity(seed, api.level);
    round = 0;
    answers = [];
    phase = 'ready';
    prompt();
    stage.request();
  }

  function look() {
    phase = 'look';
    shownAt = performance.now();
    api.sfx.press();
    api.prompt('Which field is denser?', api.level === 'easy' ? 'Tap the denser field · ← A · → B' : 'Tap the denser field, or Equal · ← A · → B · ↓ equal');
    stage.request();
  }

  function pick(p: 0 | 1 | 2, t = performance.now()) {
    if (phase !== 'look') return;
    if (p === 2 && api.level === 'easy') return;
    const rd = rounds[round];
    answers.push({ pick: p, ms: t - shownAt });
    const ok = p === rd.answer;
    const { F, boxes } = layout();
    const b = boxes[rd.answer === 2 ? 0 : rd.answer];
    api.judge(ok ? 0 : 100, { x: b.x + F / 2, y: b.y + F / 2 });
    if (!ok) api.fx.shake(2, 0.15);
    const [a, bb] = rd.f;
    api.prompt(
      `${ok ? 'Right' : 'Wrong'}: ${rd.answer === 2 ? 'the densities are exactly equal' : `${NAMES[rd.answer]} is denser, by ×${rd.ratio.toFixed(2)}`}.`,
      `A ${a.n} dots / ${a.area.toFixed(0)} u² = ${(a.d * 1000).toFixed(2)} · B ${bb.n} / ${bb.area.toFixed(0)} u² = ${(bb.d * 1000).toFixed(2)} per 1000 u²${round < ROUNDS - 1 ? ' · tap for the next' : ''}`,
    );
    phase = 'reveal';
    if (round === ROUNDS - 1) finish();
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    phase = 'ready';
    prompt();
    look();
  }

  function finish() {
    phase = 'done';
    const wrong = rounds.filter((rd, i) => answers[i].pick !== rd.answer).length;
    const pct = (wrong / ROUNDS) * 100;
    const rows: [string, string][] = rounds.map((rd, i) => [
      `${i + 1} · ×${rd.ratio.toFixed(2)}${rd.f.some((f) => f.clustered) ? ' · clustered' : ''}`,
      `${answers[i].pick === rd.answer ? '✓' : '✗'} ${NAMES[answers[i].pick]} (truth ${NAMES[rd.answer]}) · ${(answers[i].ms / 1000).toFixed(1)} s`,
    ]);
    const incon = rounds.map((rd, i) => ({ rd, a: answers[i] })).filter(({ rd }) => rd.answer !== 2 && rd.f[rd.answer].n < rd.f[rd.answer === 0 ? 1 : 0].n);
    rows.push(['Denser field had fewer dots', `${incon.filter(({ rd, a }) => a.pick === rd.answer).length} of ${incon.length} right`]);
    rows.push(['Mean response time', `${(mean(answers.map((a) => a.ms)) / 1000).toFixed(2)} s`]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'density judgements wrong',
      headline: wrong === 0 ? 'Every density judgement right.' : `${wrong} of ${ROUNDS} wrong${incon.some(({ rd, a }) => a.pick !== rd.answer) ? ' — the count pulled you the wrong way at least once' : ''}.`,
      rows,
      accuracy: 1 - wrong / ROUNDS,
      perfect: wrong === 0,
      near: wrong === 1,
      share: [`DENSITY · ${api.level}`, `${ROUNDS - wrong}/${ROUNDS} right`],
    });
  }

  bench.onTap = (p) => {
    if (phase === 'ready') return look();
    if (phase === 'reveal') return next();
    if (phase !== 'look') return;
    const { F, boxes } = layout();
    boxes.forEach((b, i) => {
      if (p.x >= b.x && p.x <= b.x + F && p.y >= b.y && p.y <= b.y + F) pick(i as 0 | 1);
    });
  };
  bench.onKey = (e) => {
    if (e.repeat) return;
    const go = e.key === 'Enter' || e.code === 'Space';
    if (phase === 'ready' && go) look();
    else if (phase === 'reveal' && go) next();
    else if (phase === 'look') {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(0, e.timeStamp);
      else if (e.key === 'ArrowRight') pick(1, e.timeStamp);
      else if (e.key === 'ArrowDown') pick(2, e.timeStamp);
      else return;
    } else return;
    e.preventDefault();
  };
  bench.onAway = () => {
    if (phase === 'look') api.voidRun('Attempt voided — the page lost focus while the dots were showing.');
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const { F, boxes, by } = layout();
    const k = F / 100;
    let more = false;
    const age = now - shownAt;
    const showDots = phase === 'look' ? age < EXPOSE[api.level] : phase !== 'ready';
    if (phase === 'look' && age < EXPOSE[api.level] + 50) more = true;
    rd.f.forEach((f, i) => {
      const b = boxes[i];
      const cx = b.x + F / 2;
      const cy = b.y + F / 2;
      const judged = phase === 'reveal' || phase === 'done';
      const right = judged && (rd.answer === i || rd.answer === 2);
      const picked = judged && answers[round]?.pick === i;
      plate(c, b.x, b.y, F, F, 10);
      text(c, NAMES[i], b.x + 10, b.y + 18, font.mono(12, 600), pal.ink2);
      // The region outline is always visible: it is the area being measured.
      c.beginPath();
      const g = f.region;
      if (g.kind === 'rect') c.rect(cx - (g.w / 2) * k, cy - (g.h / 2) * k, g.w * k, g.h * k);
      else if (g.kind === 'circle') c.arc(cx, cy, g.r * k, 0, Math.PI * 2);
      else c.ellipse(cx, cy, g.a * k, g.b * k, 0, 0, Math.PI * 2);
      c.strokeStyle = right ? pal.accent : picked ? pal.signal : pal.ink3;
      c.lineWidth = right || picked ? 2 : 1;
      c.setLineDash(right || picked ? [] : [4, 3]);
      c.stroke();
      c.setLineDash([]);
      if (showDots) {
        const pop = phase === 'look' && api.motion() ? easeOut(age / 260) : 1;
        if (pop < 1) more = true;
        for (let j = 0; j < f.dots.length; j++) circle(c, cx + f.dots[j].x * k, cy + f.dots[j].y * k, f.s * k * pop, undefined, pal.ink);
      }
      if (judged) {
        text(c, `${f.n} ÷ ${f.area.toFixed(0)} u²`, cx, b.y + F - 26, font.mono(11, 500), pal.ink2, 'center');
        text(c, `${(f.d * 1000).toFixed(2)} / 1000 u²`, cx, b.y + F - 10, font.mono(12, 600), right ? pal.accent : pal.ink, 'center');
      }
    });
    if (phase === 'look') {
      const left = clamp(1 - age / EXPOSE[api.level], 0, 1);
      if (left > 0) line(c, stage.w / 2 - 80, by - 6, stage.w / 2 - 80 + 160 * left, by - 6, pal.accent, 2);
      const items: { label: string; run: () => void; o?: { key?: string } }[] = [{ label: 'A is denser', run: () => pick(0), o: { key: '←' } }];
      if (api.level !== 'easy') items.push({ label: 'Equal', run: () => pick(2), o: { key: '↓' } });
      items.push({ label: 'B is denser', run: () => pick(1), o: { key: '→' } });
      bench.row(c, stage.w / 2, by + 4, Math.min(stage.w - 32, 520), items);
    }
    if (phase === 'ready') text(c, 'press to look', stage.w / 2, by + 26, font.mono(12, 500), pal.ink2, 'center', 'middle');
    roundStrip(c, stage.w, stage.h - 8, answers.map((a, i) => (a.pick === rounds[i].answer ? '✓' : '✗')), ROUNDS, round);
    return more;
  };

  return { reset, destroy: () => bench.destroy() };
};

export default factory;
