// 40 · FUNCTION PATH — write y = f(x) whose graph runs from the start to the end without touching an
// obstacle. Any formula in the language counts (polynomials, rationals, trig, exp/ln, roots, |…|, min/max,
// piecewise `cond ? a : b`), with single-letter parameters on sliders. Check runs the validator in fexpr.ts:
// endpoint and checkpoint values (± 0.05), slopes, definedness, continuity (finitely many discontinuities, or
// none where the level says so), obstacles (touching counts) and limits. Alternative answers are judged by
// the same rules — there is no expected string. Score per puzzle: operations + 2 per parameter + 4 per failed
// check (40 for a skip); the attempt's score is the mean over three puzzles.
import { Controls } from '../core/controls';
import { circle, font, line, pal, text } from '../core/draw';
import { alpha, glow, plate, rr } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { evalAt, fmt, ops, params, parse, ParseError, validateAst, type FLevel, type Node, type Obstacle, type Params, type Verdict, type XY } from './fexpr';
import { generateLevel, GENERATED, straightFormula } from './fpgen';
import { Bench, mean } from './kit';

const g = (x: number) => 2 / (1 + x * x);
const band = (dy: number, edge: number): XY[] => {
  const pts: XY[] = [];
  for (let x = -5.5; x <= 5.5001; x += 0.1) pts.push({ x, y: g(x) + dy });
  pts.push({ x: 5.5, y: edge }, { x: -5.5, y: edge });
  return pts;
};

export const LEVELS: FLevel[] = [
  // ── Beginner: lines and quadratics ──
  { id: 'E1', name: 'Over the stone', tier: 'easy', brief: 'A straight line hits the stone. Bend it.', domain: [-5, 5], view: { x0: -6, x1: 6, y0: -5, y1: 6 }, start: { x: -5, y: -3 }, end: { x: 5, y: 3 }, obstacles: [{ kind: 'circle', cx: 0, cy: 0, r: 1.2 }], bounded: true, ref: '0.6x + 0.1(25 - x^2)' },
  {
    id: 'E2',
    name: 'Gate',
    tier: 'easy',
    brief: 'Clear the wall, stay under the ceiling.',
    domain: [-5, 5],
    view: { x0: -6, x1: 6, y0: -5, y1: 6 },
    start: { x: -5, y: 0 },
    end: { x: 5, y: 0 },
    obstacles: [
      { kind: 'rect', x0: -1, y0: -5, x1: 1, y1: 2 },
      { kind: 'rect', x0: -4, y0: 3.2, x1: -2.5, y1: 6 },
    ],
    bounded: true,
    ref: '0.1(25 - x^2)',
  },
  {
    id: 'E3',
    name: 'Threading',
    tier: 'easy',
    brief: 'Through the jaws, round the pebble.',
    domain: [-5, 5],
    view: { x0: -6, x1: 6, y0: -5, y1: 6 },
    start: { x: -5, y: -4 },
    end: { x: 5, y: 4 },
    obstacles: [
      { kind: 'rect', x0: -0.3, y0: -5, x1: 0.3, y1: -1.4 },
      { kind: 'rect', x0: -0.3, y0: 1.4, x1: 0.3, y1: 6 },
      { kind: 'circle', cx: -2.5, cy: -2, r: 0.45 },
    ],
    bounded: true,
    ref: '0.8x - 0.04(x^2 - 25)',
  },
  {
    id: 'E4',
    name: 'Bridge',
    tier: 'easy',
    brief: 'Over the boulder or under it — not into the floor.',
    domain: [-4, 4],
    view: { x0: -5, x1: 5, y0: -4, y1: 5 },
    start: { x: -4, y: 1 },
    end: { x: 4, y: 1 },
    obstacles: [
      { kind: 'circle', cx: 0, cy: 1, r: 1 },
      { kind: 'rect', x0: -1.2, y0: -4, x1: 1.2, y1: -1.5 },
    ],
    bounded: true,
    ref: '1 + 0.1(16 - x^2)',
  },
  // ── Intermediate: cubics, trig, several obstacles ──
  {
    id: 'M1',
    name: 'Alternating stones',
    tier: 'medium',
    brief: 'Above the first, below the second.',
    domain: [-6, 6],
    view: { x0: -7, x1: 7, y0: -4, y1: 4 },
    start: { x: -6, y: 0 },
    end: { x: 6, y: 0 },
    obstacles: [
      { kind: 'circle', cx: -3, cy: -1, r: 1.2 },
      { kind: 'circle', cx: 3, cy: 1, r: 1.2 },
    ],
    bounded: true,
    ref: 'x(x^2 - 36)/40',
  },
  {
    id: 'M2',
    name: 'Slalom',
    tier: 'medium',
    brief: 'Four gates, alternating sides.',
    domain: [-6, 6],
    view: { x0: -7, x1: 7, y0: -4, y1: 4 },
    start: { x: -6, y: 0 },
    end: { x: 6, y: 0 },
    obstacles: [
      { kind: 'circle', cx: -4.5, cy: -1, r: 1.05 },
      { kind: 'circle', cx: -1.5, cy: 1, r: 1.05 },
      { kind: 'circle', cx: 1.5, cy: -1, r: 1.05 },
      { kind: 'circle', cx: 4.5, cy: 1, r: 1.05 },
    ],
    bounded: true,
    ref: 'sin(pi(x + 6)/3)',
  },
  {
    id: 'M3',
    name: 'Squeeze',
    tier: 'medium',
    brief: 'Over the pin, under the shelf.',
    domain: [-5, 5],
    view: { x0: -6, x1: 6, y0: -5, y1: 5 },
    start: { x: -5, y: -3 },
    end: { x: 5, y: 3 },
    obstacles: [
      { kind: 'circle', cx: 0, cy: 0, r: 0.7 },
      { kind: 'rect', x0: -3.5, y0: 0, x1: -2, y1: 5 },
    ],
    bounded: true,
    ref: '0.6x + 0.045(25 - x^2)',
  },
  {
    id: 'M4',
    name: 'Bell',
    tier: 'medium',
    brief: 'Flat on both sides, high over the post.',
    domain: [-5, 5],
    view: { x0: -6, x1: 6, y0: -2, y1: 5 },
    start: { x: -5, y: 0 },
    end: { x: 5, y: 0 },
    obstacles: [
      { kind: 'rect', x0: -5.6, y0: 0.3, x1: -1.8, y1: 5 },
      { kind: 'rect', x0: 1.8, y0: 0.3, x1: 5.6, y1: 5 },
      { kind: 'rect', x0: -0.5, y0: -2, x1: 0.5, y1: 2 },
    ],
    bounded: true,
    ref: '4e^(-x^2)',
  },
  // ── Advanced and expert: exp/log, slopes, rationals, piecewise, limits, checkpoints ──
  {
    id: 'H1',
    name: 'Saturate',
    tier: 'hard',
    brief: 'Rise fast, then arrive flat: f′(9) = 0.',
    domain: [1, 9],
    view: { x0: 0.5, x1: 9.5, y0: -2, y1: 4 },
    start: { x: 1, y: 0 },
    end: { x: 9, y: 2 },
    slopes: [{ x: 9, m: 0 }],
    obstacles: [
      { kind: 'rect', x0: 2, y0: -2, x1: 4, y1: 0.9 },
      { kind: 'rect', x0: 5, y0: 2.4, x1: 7, y1: 4 },
    ],
    bounded: true,
    ref: '2(1 - e^(-1.5(x - 1)))',
  },
  {
    id: 'H2',
    name: 'Tangent entry',
    tier: 'hard',
    brief: 'Leave and arrive with slope exactly 1. At most 8 operations.',
    domain: [-4, 4],
    view: { x0: -5, x1: 5, y0: -3, y1: 3 },
    start: { x: -4, y: 0 },
    end: { x: 4, y: 0 },
    slopes: [
      { x: -4, m: 1 },
      { x: 4, m: 1 },
    ],
    obstacles: [
      { kind: 'circle', cx: -2, cy: -0.6, r: 0.75 },
      { kind: 'circle', cx: 2, cy: 0.6, r: 0.75 },
    ],
    maxOps: 8,
    bounded: true,
    ref: 'x^3/32 - x/2',
  },
  {
    id: 'H3',
    name: 'Corridor',
    tier: 'hard',
    brief: 'A narrow curved corridor — find the curve that fits it.',
    domain: [-5, 5],
    view: { x0: -6, x1: 6, y0: -1, y1: 3 },
    start: { x: -5, y: g(5) },
    end: { x: 5, y: g(5) },
    obstacles: [
      { kind: 'poly', pts: band(0.35, 3.5) },
      { kind: 'poly', pts: band(-0.35, -1.5) },
    ],
    ref: '2/(1 + x^2)',
  },
  {
    id: 'H4',
    name: 'Step',
    tier: 'hard',
    brief: 'Low on the left, high on the right — in at most 4 operations. A jump is allowed here.',
    domain: [-5, 5],
    view: { x0: -6, x1: 6, y0: -4, y1: 4 },
    start: { x: -5, y: -2 },
    end: { x: 5, y: 2 },
    obstacles: [
      { kind: 'rect', x0: -5.6, y0: -1, x1: -1, y1: 4.5 },
      { kind: 'rect', x0: 1, y0: -4.5, x1: 5.6, y1: 1 },
    ],
    maxOps: 4,
    ref: '2cbrt(x/5)',
  },
  {
    id: 'H5',
    name: 'Checkpoints',
    tier: 'hard',
    brief: 'Through both checkpoints, never through the pin at the origin. Continuous only.',
    domain: [-6, 6],
    view: { x0: -7, x1: 7, y0: -4, y1: 4 },
    start: { x: -6, y: 0 },
    end: { x: 6, y: 0 },
    checkpoints: [
      { x: -3, y: 2 },
      { x: 3, y: -2 },
    ],
    obstacles: [
      { kind: 'circle', cx: 0, cy: 0, r: 0.55 },
      { kind: 'circle', cx: 4.5, cy: -0.5, r: 0.6 },
    ],
    continuous: true,
    bounded: true,
    ref: '-2sin(pi x/6) + (36 - x^2)(9 - x^2)/324',
  },
];

export const PUZZLES = 3;
export const SKIP_COST = 40;
/** Cost of a solved puzzle: lower is better. */
export const puzzleCost = (opsN: number, paramsN: number, fails: number) => Math.min(SKIP_COST, opsN + 2 * paramsN + 4 * fails);

/**
 * Course n of a tier: the hand-made levels come first (courses 1…k), then generated ones — GENERATED more
 * per tier, each deterministic, solvable and not solved by the straight line.
 */
export function course(level: Level, n: number): FLevel {
  const hand = LEVELS.filter((l) => l.tier === level);
  if (n <= hand.length) return { ...hand[n - 1], name: `Course ${n} · ${hand[n - 1].name}` };
  return generateLevel(level, n);
}
export const courseCount = (level: Level) => LEVELS.filter((l) => l.tier === level).length + GENERATED;

/** Three distinct courses for an attempt, chosen by the seed. */
export function pickLevels(seed: number, level: Level) {
  const r = rng(seed);
  const ns = new Set<number>();
  while (ns.size < PUZZLES) ns.add(r.int(1, courseCount(level)));
  return [...ns].map((n) => course(level, n));
}

/** The straight line through start and end: the starting formula. */
export const startFormula = straightFormula;

const CHIPS = ['x^2', 'sin(', 'cos(', 'e^(', 'ln(', 'sqrt(', '|x|', 'pi', '(', ')', '^', 'x<0 ? : '];

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const host = stage.canvas.parentElement!;
  // ── The editor (a real text field: mobile keyboards, selection, native undo) ──
  const box = document.createElement('div');
  box.className = 'fp-editor';
  box.innerHTML = '<div class="fp-row"><label class="fp-label" for="fp-in">f(x) =</label><input id="fp-in" type="text" class="fp-input" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" aria-label="Your function f of x" /><button type="button" class="fp-btn" data-a="undo" aria-label="Undo">↶</button><button type="button" class="fp-btn" data-a="redo" aria-label="Redo">↷</button><button type="button" class="fp-btn primary" data-a="check">Check</button></div><div class="fp-chips"></div>';
  const input = box.querySelector('input')!;
  const chips = box.querySelector('.fp-chips')!;
  for (const ch of CHIPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fp-chip';
    b.textContent = ch.trim();
    b.dataset.ins = ch;
    chips.append(b);
  }
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'fp-chip fp-skip';
  skip.textContent = 'Skip';
  skip.dataset.a = 'skip';
  chips.append(skip);
  host.append(box);

  let lv: FLevel[] = [];
  let idx = 0;
  let phase: 'edit' | 'solved' | 'done' = 'edit';
  let ast: Node | null = null;
  let err = '';
  let samples: { x: number; y: number }[][] = [];
  let verdict: Verdict | null = null;
  let fails = 0;
  let costs: { cost: number; ops: number; params: number; fails: number; formula: string; skipped: boolean }[] = [];
  let hist: string[] = [];
  let hi = -1;
  const pvals: Params = {};
  const controls = new Controls(stage, () => {});
  controls.lockLabel = '';

  function reset(seed: number) {
    bench.clear();
    lv = pickLevels(seed, api.level);
    idx = 0;
    costs = [];
    load();
  }

  function load() {
    const L = lv[idx];
    phase = 'edit';
    fails = 0;
    verdict = null;
    hist = [];
    hi = -1;
    for (const k of Object.keys(pvals)) delete pvals[k];
    setFormula(startFormula(L));
    api.progress(`${idx + 1} / ${PUZZLES} · ${L.name}`);
    stage.request();
  }

  function setFormula(s: string, record = true) {
    input.value = s;
    onEdit(record);
  }

  function describe(L: FLevel) {
    const parts = [`f(${fmt(L.start.x)}) = ${fmt(L.start.y)}`, `f(${fmt(L.end.x)}) = ${fmt(L.end.y)}`];
    (L.checkpoints ?? []).forEach((c) => parts.push(`f(${fmt(c.x)}) = ${fmt(c.y)}`));
    (L.slopes ?? []).forEach((s) => parts.push(`f′(${fmt(s.x)}) = ${fmt(s.m)}`));
    if (L.maxOps != null) parts.push(`≤ ${L.maxOps} operations`);
    if (L.continuous) parts.push('no discontinuities');
    return parts.join(' · ');
  }

  function onEdit(record = true) {
    const s = input.value;
    if (record && hist[hi] !== s) {
      hist = hist.slice(0, hi + 1);
      hist.push(s);
      if (hist.length > 100) hist.shift();
      hi = hist.length - 1;
    }
    verdict = null;
    try {
      ast = parse(s);
      err = '';
      // Sliders for the parameters the formula uses (values survive edits).
      const names = [...params(ast)].sort();
      for (const n of names) pvals[n] ??= 1;
      const have = controls.knobs.map((k) => k.id).join(',');
      if (have !== names.join(',')) controls.set(names.slice(0, 4).map((n) => ({ id: n, label: n, lo: -5, hi: 5, value: pvals[n], speed: 1.5, readout: (v: number) => v.toFixed(3), onChange: (v: number) => ((pvals[n] = v), resample()) })));
      if (names.length > 4) err = 'At most 4 parameters (a, b, c, …) — replace the rest by numbers';
    } catch (e) {
      ast = null;
      err = e instanceof ParseError ? e.message : 'Cannot read that formula';
    }
    resample();
    const L = lv[idx];
    if (phase === 'edit') api.prompt(`${L.name}: ${L.brief}`, err ? `⚠ ${err}` : describe(L));
  }

  /** Graph samples for drawing — the same evaluator the validator uses. Breaks at undefined points and jumps. */
  function resample() {
    samples = [];
    const L = lv[idx];
    if (!ast || !L) return stage.request();
    const N = 900;
    const { x0, x1, y0, y1 } = L.view;
    const span = y1 - y0;
    let cur: { x: number; y: number }[] = [];
    let prev = NaN;
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      const y = evalAt(ast, x, pvals);
      if (!Number.isFinite(y) || (Number.isFinite(prev) && Math.abs(y - prev) > span * 0.8)) {
        if (cur.length > 1) samples.push(cur);
        cur = [];
      }
      if (Number.isFinite(y)) cur.push({ x, y: Math.max(y0 - span, Math.min(y1 + span, y)) });
      prev = y;
    }
    if (cur.length > 1) samples.push(cur);
    stage.request();
  }

  function check() {
    if (phase !== 'edit') return;
    const L = lv[idx];
    if (!ast) {
      api.prompt('The formula has a syntax error.', `⚠ ${err}`);
      api.sfx.fail();
      return;
    }
    if (hist[hi] !== input.value) onEdit();
    verdict = validateAst(L, ast, pvals);
    if (verdict.ok) {
      const cost = puzzleCost(verdict.ops, verdict.params, fails);
      costs.push({ cost, ops: verdict.ops, params: verdict.params, fails, formula: input.value + (verdict.params ? `  [${Object.entries(pvals).filter(([k]) => params(ast!).has(k)).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(', ')}]` : ''), skipped: false });
      phase = 'solved';
      api.judge(cost, { x: stage.w / 2, y: 120 });
      api.fx.burst(stage.w / 2, 140, pal.accent, 24);
      api.prompt(`Valid${verdict.status === 'proven' ? ' — proven clear by interval arithmetic' : ' (checked numerically near a boundary)'}.`, `${verdict.ops} operations · ${verdict.params} parameter${verdict.params === 1 ? '' : 's'} · ${fails} failed check${fails === 1 ? '' : 's'} → cost ${cost}${idx < PUZZLES - 1 ? ' · Next' : ''}`);
      if (idx === PUZZLES - 1) finish();
    } else {
      fails++;
      api.sfx.fail();
      api.fx.shake(2, 0.15);
      const bad = verdict.checks.filter((c) => !c.ok);
      api.prompt(`Not yet — ${bad.map((c) => c.name).join(', ')}.`, bad[0]?.detail ?? '');
    }
    stage.request();
  }

  function skipPuzzle() {
    if (phase !== 'edit') return;
    costs.push({ cost: SKIP_COST, ops: 0, params: 0, fails, formula: '(skipped)', skipped: true });
    phase = 'solved';
    api.prompt('Skipped.', `One valid answer: f(x) = ${lv[idx].ref} (yours could be quite different)${idx < PUZZLES - 1 ? ' · Next' : ''}`);
    if (idx === PUZZLES - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'solved' || idx >= PUZZLES - 1) return;
    idx++;
    load();
  }

  function finish() {
    phase = 'done';
    const m = mean(costs.map((c) => c.cost));
    const rows: [string, string][] = lv.map((L, i) => [`${i + 1} · ${L.name}`, costs[i].skipped ? `skipped (${SKIP_COST})` : `${costs[i].formula} · ${costs[i].ops} ops, ${costs[i].params} params, ${costs[i].fails} failed → ${costs[i].cost}`]);
    rows.push(['Cost rule', 'operations + 2 × parameters + 4 × failed checks; skip = 40'] as [string, string]);
    bench.finish({
      score: m,
      value: m.toFixed(1),
      unit: 'cost',
      label: 'mean formula cost (lower is simpler and cleaner)',
      headline: costs.some((c) => c.skipped) ? `${costs.filter((c) => !c.skipped).length} of ${PUZZLES} solved.` : `All ${PUZZLES} solved, mean cost ${m.toFixed(1)}.`,
      rows,
      perfect: false,
      near: !costs.some((c) => c.skipped || c.fails),
      share: [`FUNCTION PATH · ${api.level}`, `cost ${m.toFixed(1)}`],
    });
  }

  // ── DOM events ──
  const onInput = () => onEdit();
  const onKeyField = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (phase === 'edit') check();
      else next();
    }
  };
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'check') check();
    else if (a === 'skip') skipPuzzle();
    else if (a === 'undo' && hi > 0) setFormula(hist[--hi], false);
    else if (a === 'redo' && hi < hist.length - 1) setFormula(hist[++hi], false);
    else if (b.dataset.ins != null && phase === 'edit') {
      const ins = b.dataset.ins;
      const s0 = input.selectionStart ?? input.value.length;
      const s1 = input.selectionEnd ?? s0;
      input.value = input.value.slice(0, s0) + ins + input.value.slice(s1);
      const caret = s0 + (ins.endsWith(' : ') ? ins.indexOf('?') + 2 : ins.length);
      input.focus({ preventScroll: true });
      input.setSelectionRange(caret, caret);
      onEdit();
    }
  };
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyField);
  box.addEventListener('click', onClick);
  bench.onTap = () => phase === 'solved' && next();
  bench.onKey = (e) => {
    if (phase === 'solved' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      next();
    }
  };

  // ── Drawing ──
  const plane = () => {
    const L = lv[idx];
    const k = stage.k || 1;
    const edH = box.getBoundingClientRect().height / k + 16;
    const sl = controls.knobs.length ? controls.knobs.length * 54 + 6 : 0;
    const top = 70;
    const PW = stage.w - 32;
    const PH = Math.max(120, stage.h - top - edH - sl - 8);
    const vw = L.view.x1 - L.view.x0;
    const vh = L.view.y1 - L.view.y0;
    const s = Math.min(PW / vw, PH / vh);
    const ox = stage.w / 2 - (vw * s) / 2;
    const oy = top + (PH - vh * s) / 2;
    return { s, ox, oy, w: vw * s, h: vh * s, slY: top + PH + 4 };
  };

  function obstaclePath(c: CanvasRenderingContext2D, o: Obstacle, X: (x: number) => number, Y: (y: number) => number, s: number) {
    c.beginPath();
    if (o.kind === 'rect') c.rect(X(o.x0), Y(o.y1), (o.x1 - o.x0) * s, (o.y1 - o.y0) * s);
    else if (o.kind === 'circle') c.arc(X(o.cx), Y(o.cy), o.r * s, 0, Math.PI * 2);
    else o.pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
    c.closePath();
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const L = lv[idx];
    if (!L) return false;
    const P = plane();
    const { s, ox, oy } = P;
    const X = (x: number) => ox + (x - L.view.x0) * s;
    const Y = (y: number) => oy + (L.view.y1 - y) * s;
    plate(c, ox - 8, oy - 8, P.w + 16, P.h + 16, 10);
    c.save();
    rr(c, ox, oy, P.w, P.h, 4);
    c.clip();
    // Grid: every unit (every 2 when cramped), axes stronger.
    const step = s >= 22 ? 1 : 2;
    for (let x = Math.ceil(L.view.x0 / step) * step; x <= L.view.x1; x += step) line(c, X(x), oy, X(x), oy + P.h, x === 0 ? pal.ink3 : pal.line2, x === 0 ? 1.2 : 1);
    for (let y = Math.ceil(L.view.y0 / step) * step; y <= L.view.y1; y += step) line(c, ox, Y(y), ox + P.w, Y(y), y === 0 ? pal.ink3 : pal.line2, y === 0 ? 1.2 : 1);
    for (let x = Math.ceil(L.view.x0 / step) * step; x <= L.view.x1; x += step) if (x) text(c, String(x), X(x), Y(0) + 12, font.mono(9, 500), pal.ink3, 'center');
    for (let y = Math.ceil(L.view.y0 / step) * step; y <= L.view.y1; y += step) if (y) text(c, String(y), X(0) - 5, Y(y) + 3, font.mono(9, 500), pal.ink3, 'right');
    // Outside the domain: shaded.
    c.fillStyle = alpha(pal.ink, 0.04);
    c.fillRect(ox, oy, X(L.domain[0]) - ox, P.h);
    c.fillRect(X(L.domain[1]), oy, ox + P.w - X(L.domain[1]), P.h);
    // Obstacles: solid stone; hit ones outlined in coral.
    const hit = new Set(verdict?.collisions.map((q) => q.o) ?? []);
    L.obstacles.forEach((o, i) => {
      obstaclePath(c, o, X, Y, s);
      c.fillStyle = alpha(pal.ink, 0.16);
      c.fill();
      c.strokeStyle = hit.has(i) ? pal.signal : alpha(pal.ink, 0.45);
      c.lineWidth = hit.has(i) ? 2 : 1;
      c.stroke();
    });
    // The graph.
    const good = verdict?.ok;
    c.lineJoin = 'round';
    for (const seg of samples) {
      c.beginPath();
      seg.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
      c.strokeStyle = good ? pal.accent : pal.ink;
      c.lineWidth = 2.25;
      if (good) {
        c.shadowColor = alpha(pal.accent, 0.6);
        c.shadowBlur = 10;
      }
      c.stroke();
      c.shadowBlur = 0;
    }
    // Collision and discontinuity marks from the validator.
    for (const q of verdict?.collisions.slice(0, 12) ?? []) {
      const y = ast ? evalAt(ast, q.x, pvals) : NaN;
      if (Number.isFinite(y)) circle(c, X(q.x), Y(y), 7, pal.signal, undefined, 2);
    }
    for (const d of verdict?.discontinuities ?? []) line(c, X(d.x), oy, X(d.x), oy + P.h, alpha(pal.signal, 0.5), 1, [3, 4]);
    c.restore();
    // Constraints: start, end, checkpoints (cyan), slopes as short tangent ticks.
    const live = (p: XY, label: string) => {
      const v = ast ? evalAt(ast, p.x, pvals) : NaN;
      const ok = Number.isFinite(v) && Math.abs(v - p.y) <= 0.05;
      glow(c, X(p.x), Y(p.y), 18, pal.accent, ok ? 1 : 0.5);
      circle(c, X(p.x), Y(p.y), 5, pal.accent, ok ? pal.accent : pal.paper, 2);
      text(c, `${label} ${Number.isFinite(v) ? fmt(v) : '—'}`, X(p.x) + (p.x > (L.view.x0 + L.view.x1) / 2 ? -8 : 8), Y(p.y) - 10, font.mono(10, 600), ok ? pal.accent : pal.ink2, p.x > (L.view.x0 + L.view.x1) / 2 ? 'right' : 'left');
    };
    live(L.start, 'start');
    live(L.end, 'end');
    (L.checkpoints ?? []).forEach((p, i) => live(p, `◇${i + 1}`));
    for (const sl of L.slopes ?? []) {
      const y = sl.x === L.start.x ? L.start.y : L.end.y;
      const d = 0.8 / Math.hypot(1, sl.m);
      line(c, X(sl.x - d), Y(y - sl.m * d), X(sl.x + d), Y(y + sl.m * d), pal.accent, 2, [4, 3]);
    }
    // Live formula stats.
    text(c, ast ? `${ops(ast)} ops${L.maxOps != null ? ` / ${L.maxOps}` : ''}` : '', ox + 6, oy + 14, font.mono(10, 600), L.maxOps != null && ast && ops(ast) > L.maxOps ? pal.signal : pal.ink3);
    if (verdict) {
      // The checklist from the last check.
      const lines = verdict.checks;
      const bw = Math.min(330, P.w - 16);
      const bx = ox + P.w - bw - 8;
      rr(c, bx, oy + 8, bw, lines.length * 16 + 12, 6);
      c.fillStyle = alpha(pal.paper, 0.88);
      c.fill();
      lines.forEach((q, i) => text(c, `${q.ok ? '✓' : '✗'} ${q.name}${q.ok ? '' : ` — ${q.detail}`}`.slice(0, Math.floor(bw / 6.2)), bx + 8, oy + 24 + i * 16, font.mono(10, 500), q.ok ? pal.ink2 : pal.signal));
    }
    const more = controls.tick(now);
    if (controls.knobs.length) controls.draw(c, stage.w / 2 - Math.min(stage.w - 32, 520) / 2, P.slY, Math.min(stage.w - 32, 520), { lock: false });
    if (phase === 'solved' && idx < PUZZLES - 1) bench.button(c, stage.w / 2 - 70, oy + P.h / 2 - 22, 140, 44, 'Next', next, { primary: true, key: 'Enter' });
    box.classList.toggle('fp-off', phase !== 'edit');
    input.disabled = phase !== 'edit';
    return more;
  };

  return {
    reset,
    destroy: () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyField);
      box.removeEventListener('click', onClick);
      controls.destroy();
      bench.destroy();
      box.remove();
    },
  };
};

export default factory;
