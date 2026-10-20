// 39 · FILTER — a stream of symbols; press only when the rule is met.
// Rules are explicit predicates over the event history (the current event and, for sequential rules, exactly
// the ones before it). Streams mix targets, near-misses that satisfy part of the rule, and plain distractors.
// Each event owns the window from 120 ms after its onset to 120 ms after the next onset; the first press in a
// window is the response to that event. Score: balanced error = ½(miss rate + false-alarm rate), so pressing
// on everything scores 50 %, never pressing scores 50 %, and only telling targets apart scores well.
// A rule change is always announced: the stream stops, the new rule is shown, and you restart it.
import { circle, font, pal, text } from '../core/draw';
import { alpha, glow, plate } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { AMBER, Bench, mean, VIOLET } from './kit';

export type FShape = 'circle' | 'triangle' | 'square' | 'diamond';
export type FColor = 'cyan' | 'amber' | 'violet' | 'white';
export interface Ev {
  shape: FShape;
  color: FColor;
  big: boolean;
  side: -1 | 0 | 1;
}
export interface FRule {
  id: string;
  text: string;
  test: (h: Ev[], i: number) => boolean;
  /** Satisfies part of the rule (a tempting non-target). */
  near: (h: Ev[], i: number) => boolean;
  side?: boolean;
}
const SHAPES: FShape[] = ['circle', 'triangle', 'square', 'diamond'];
const COLS: FColor[] = ['cyan', 'amber', 'violet', 'white'];

export const RULES: Record<string, FRule> = {
  circle: { id: 'circle', text: 'any circle', test: (h, i) => h[i].shape === 'circle', near: (h, i) => h[i].shape === 'diamond' },
  cyan: { id: 'cyan', text: 'anything cyan', test: (h, i) => h[i].color === 'cyan', near: (h, i) => h[i].color === 'violet' },
  cyanTri: { id: 'cyanTri', text: 'a cyan triangle', test: (h, i) => h[i].color === 'cyan' && h[i].shape === 'triangle', near: (h, i) => h[i].color === 'cyan' || h[i].shape === 'triangle' },
  bigSquare: { id: 'bigSquare', text: 'a LARGE square', test: (h, i) => h[i].big && h[i].shape === 'square', near: (h, i) => h[i].shape === 'square' || h[i].big },
  afterTri: {
    id: 'afterTri',
    text: 'a cyan circle immediately after a triangle',
    test: (h, i) => i > 0 && h[i].color === 'cyan' && h[i].shape === 'circle' && h[i - 1].shape === 'triangle',
    near: (h, i) => (h[i].color === 'cyan' && h[i].shape === 'circle') || (i > 0 && h[i - 1].shape === 'triangle' && h[i].shape === 'circle'),
  },
  repeatShape: { id: 'repeatShape', text: 'the same shape twice in a row', test: (h, i) => i > 0 && h[i].shape === h[i - 1].shape, near: (h, i) => i > 0 && h[i].color === h[i - 1].color },
  squareNotAmber: { id: 'squareNotAmber', text: 'a square that is NOT amber', test: (h, i) => h[i].shape === 'square' && h[i].color !== 'amber', near: (h, i) => h[i].shape === 'square' || h[i].color !== 'amber' },
  bigAfterSmall: { id: 'bigAfterSmall', text: 'a LARGE shape right after a small one', test: (h, i) => i > 0 && h[i].big && !h[i - 1].big, near: (h, i) => h[i].big },
  twoBack: { id: 'twoBack', text: 'the same colour as two symbols back', test: (h, i) => i > 1 && h[i].color === h[i - 2].color, near: (h, i) => i > 0 && h[i].color === h[i - 1].color },
  sideRule: { id: 'sideRule', text: 'a circle on the LEFT, or a triangle on the RIGHT', side: true, test: (h, i) => (h[i].shape === 'circle' && h[i].side < 0) || (h[i].shape === 'triangle' && h[i].side > 0), near: (h, i) => h[i].shape === 'circle' || h[i].shape === 'triangle' },
  colourNotShape: { id: 'colourNotShape', text: 'same colour as the one before, but a different shape', test: (h, i) => i > 0 && h[i].color === h[i - 1].color && h[i].shape !== h[i - 1].shape, near: (h, i) => i > 0 && (h[i].color === h[i - 1].color || h[i].shape === h[i - 1].shape) },
};

export interface Block {
  events: Ev[];
  rules: FRule[]; // rule per event
  switchAt: number; // index where the rule changes (−1: none)
}
const POOL: Record<Level, string[][]> = {
  easy: [['circle', 'cyan', 'cyanTri', 'bigSquare']],
  medium: [
    ['cyanTri', 'squareNotAmber', 'bigSquare'],
    ['afterTri', 'repeatShape', 'bigAfterSmall'],
  ],
  hard: [
    ['afterTri', 'repeatShape', 'squareNotAmber'],
    ['twoBack', 'sideRule', 'colourNotShape'],
  ],
};
export const TIMING: Record<Level, { on: number; soa: number; n: number }> = {
  easy: { on: 650, soa: 950, n: 40 },
  medium: { on: 520, soa: 820, n: 32 },
  hard: { on: 420, soa: 700, n: 34 },
};

function randEv(r: Rng, side: boolean): Ev {
  return { shape: r.pick(SHAPES), color: r.pick(COLS), big: r.next() < 0.5, side: side ? (r.next() < 0.5 ? -1 : 1) : 0 };
}

/** A stream of n events for a rule sequence: ~28 % targets, half the rest near-misses. */
export function makeStream(r: Rng, rules: FRule[], n: number, side: boolean): Ev[] {
  const h: Ev[] = [];
  const wants: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const rule = rules[i];
    const want = i > 1 && r.next() < 0.28;
    const nearWanted = !want && r.next() < 0.5;
    let ok = false;
    for (let t = 0; t < 300 && !ok; t++) {
      h[i] = randEv(r, side);
      ok = rule.test(h, i) === want && (!nearWanted || t >= 200 || rule.near(h, i));
    }
    // A sequential target may need a different previous symbol: re-draw both, keeping the previous one's status.
    for (let t = 0; t < 600 && !ok && i > 0; t++) {
      h[i - 1] = randEv(r, side);
      h[i] = randEv(r, side);
      ok = rules[i - 1].test(h, i - 1) === wants[i - 1] && rule.test(h, i) === want;
    }
    wants[i] = rule.test(h, i);
  }
  return h;
}

export function makeFilter(seed: number, level: Level): Block[] {
  const r = rng(seed);
  return POOL[level].map((ids, bi) => {
    const n = TIMING[level].n;
    const a = RULES[r.pick(ids)];
    let b = a;
    while (b === a && ids.length > 1) b = RULES[r.pick(ids)];
    // Hard, second block: an announced switch half-way.
    const switchAt = level === 'hard' && bi === 1 ? Math.floor(n / 2) : -1;
    const rules = Array.from({ length: n }, (_, i) => (switchAt >= 0 && i >= switchAt ? b : a));
    const side = rules.some((x) => x.side);
    return { events: makeStream(r, rules, n, side), rules, switchAt };
  });
}

/** Ground truth from the actual history. */
export const targets = (b: Block) => b.events.map((_, i) => b.rules[i].test(b.events, i));

/**
 * Assign presses (ms since block start) to events and count outcomes. Event i owns
 * [onset_i + 120, onset_{i+1} + 120); only the first press in a window counts.
 */
export function scoreBlock(onsets: number[], soa: number, tgt: boolean[], presses: number[]) {
  const resp: (number | null)[] = tgt.map(() => null);
  for (const p of presses) {
    for (let i = 0; i < onsets.length; i++) {
      const lo = onsets[i] + 120;
      const hi = (i + 1 < onsets.length ? onsets[i + 1] : onsets[i] + soa) + 120;
      if (p >= lo && p < hi) {
        if (resp[i] == null) resp[i] = p - onsets[i];
        break;
      }
    }
  }
  let hit = 0;
  let miss = 0;
  let fa = 0;
  let cr = 0;
  const rts: number[] = [];
  tgt.forEach((t, i) => {
    if (t && resp[i] != null) {
      hit++;
      rts.push(resp[i]!);
    } else if (t) miss++;
    else if (resp[i] != null) fa++;
    else cr++;
  });
  return { hit, miss, fa, cr, rts };
}

/** Balanced error in % (0 perfect; 50 for always or never pressing). */
export function balancedError(s: { hit: number; miss: number; fa: number; cr: number }) {
  const mr = s.hit + s.miss ? s.miss / (s.hit + s.miss) : 0;
  const far = s.fa + s.cr ? s.fa / (s.fa + s.cr) : 0;
  return 50 * (mr + far);
}

const PAINT = (c: FColor) => (c === 'cyan' ? pal.accent : c === 'amber' ? AMBER : c === 'violet' ? VIOLET : pal.ink);

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let blocks: Block[] = [];
  let bi = 0;
  let phase: 'brief' | 'run' | 'switch' | 'done' = 'brief';
  let start = 0;
  let onsets: number[] = [];
  let presses: number[] = [];
  let flashAt = -1e9;
  let stats: ReturnType<typeof scoreBlock>[] = [];
  const T = () => TIMING[api.level];

  function reset(seed: number) {
    bench.clear();
    blocks = makeFilter(seed, api.level);
    bi = 0;
    stats = [];
    brief();
  }
  function brief() {
    phase = 'brief';
    api.progress(`block ${bi + 1} / ${blocks.length}`);
    const b = blocks[bi];
    api.prompt(`Press only for: ${b.rules[0].text}.`, `${b.events.length} symbols${b.switchAt >= 0 ? ' · the rule will change once — you will be told' : ''} · press to start, then Space / tap`);
    stage.request();
  }
  function run(fromIdx: number) {
    phase = 'run';
    const b = blocks[bi];
    const now = performance.now();
    if (fromIdx === 0) {
      start = now + 600;
      onsets = [];
      presses = [];
    }
    // Onsets are fixed when a segment starts (relative to the block start).
    const end = b.switchAt > fromIdx ? b.switchAt : b.events.length;
    const base = (fromIdx === 0 ? 600 : now - start + 600) | 0;
    for (let i = fromIdx; i < end; i++) onsets[i] = base + (i - fromIdx) * T().soa;
    api.prompt(`Rule: ${b.rules[fromIdx].text}`, 'Space or tap — only on a match');
    bench.later(() => (end === b.events.length ? endBlock() : pause(end)), onsets[end - 1] - (now - start) + T().soa + 160);
    stage.request();
  }
  function pause(at: number) {
    phase = 'switch';
    api.sfx.over();
    api.prompt(`NEW RULE — press only for: ${blocks[bi].rules[at].text}.`, 'The old rule no longer applies · press to continue');
    switchIdx = at;
    stage.request();
  }
  let switchIdx = 0;
  function endBlock() {
    const b = blocks[bi];
    const s = scoreBlock(onsets, T().soa, targets(b), presses);
    stats.push(s);
    if (bi === blocks.length - 1) return finish();
    bi++;
    api.prompt(`Block done: ${s.hit} hits, ${s.miss} misses, ${s.fa} false alarms.`, '');
    bench.later(brief, 1400);
    phase = 'done';
  }
  function finish() {
    phase = 'done';
    const tot = stats.reduce((a, s) => ({ hit: a.hit + s.hit, miss: a.miss + s.miss, fa: a.fa + s.fa, cr: a.cr + s.cr }), { hit: 0, miss: 0, fa: 0, cr: 0 });
    const err = balancedError(tot);
    const rts = stats.flatMap((s) => s.rts);
    const precision = tot.hit + tot.fa ? tot.hit / (tot.hit + tot.fa) : 0;
    const recall = tot.hit + tot.miss ? tot.hit / (tot.hit + tot.miss) : 0;
    const rows: [string, string][] = blocks.map((b, i) => [`Block ${i + 1} · ${b.switchAt >= 0 ? `${b.rules[0].text} → ${b.rules[b.rules.length - 1].text}` : b.rules[0].text}`, `${stats[i].hit} hits · ${stats[i].miss} misses · ${stats[i].fa} false alarms`]);
    rows.push(['Hits / misses', `${tot.hit} / ${tot.miss}`]);
    rows.push(['False alarms / correct rejections', `${tot.fa} / ${tot.cr}`]);
    rows.push(['Precision · recall', `${(precision * 100).toFixed(0)}% · ${(recall * 100).toFixed(0)}%`]);
    rows.push(['Reaction time on hits', rts.length ? `${mean(rts).toFixed(0)} ms` : '—']);
    bench.finish({
      score: err,
      value: err.toFixed(1),
      unit: '%',
      label: 'balanced error (½ miss rate + ½ false-alarm rate)',
      headline: err === 0 ? 'Every target caught, nothing else pressed.' : `${tot.miss} missed, ${tot.fa} false alarm${tot.fa === 1 ? '' : 's'}.`,
      rows,
      accuracy: 1 - err / 100,
      perfect: err === 0,
      near: err < 5,
      share: [`FILTER · ${api.level}`, `${err.toFixed(1)}% balanced error`],
    });
  }

  function respond(t: number) {
    if (phase !== 'run') return;
    presses.push(t - start);
    flashAt = performance.now();
    api.sfx.tick();
  }

  bench.onTap = (_p, e) => {
    if (phase === 'brief') run(0);
    else if (phase === 'switch') run(switchIdx);
    else respond(e.timeStamp);
  };
  bench.onKey = (e) => {
    if (e.repeat || !(e.code === 'Space' || e.key === 'Enter')) return;
    e.preventDefault();
    if (phase === 'brief') run(0);
    else if (phase === 'switch') run(switchIdx);
    else respond(e.timeStamp);
  };
  bench.onAway = () => {
    if (phase === 'run' || phase === 'switch') api.voidRun('Attempt voided — the page lost focus during the stream.');
  };

  function sym(c: CanvasRenderingContext2D, e: Ev, x: number, y: number) {
    const r = e.big ? 46 : 26;
    const col = PAINT(e.color);
    glow(c, x, y, r * 1.8, col, 0.35);
    c.beginPath();
    if (e.shape === 'circle') c.arc(x, y, r, 0, Math.PI * 2);
    else if (e.shape === 'square') c.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
    else if (e.shape === 'triangle') {
      c.moveTo(x, y - r);
      c.lineTo(x + r * 0.95, y + r * 0.7);
      c.lineTo(x - r * 0.95, y + r * 0.7);
      c.closePath();
    } else {
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
    }
    c.fillStyle = col;
    c.fill();
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const b = blocks[bi];
    if (!b) return false;
    const W = stage.w;
    const cy = Math.max(170, stage.h * 0.45);
    const pw = Math.min(W - 32, 520);
    plate(c, W / 2 - pw / 2, cy - 120, pw, 240, 14);
    text(c, b.rules[Math.min(b.rules.length - 1, phase === 'switch' ? switchIdx : phase === 'run' ? Math.max(0, cur(now)) : 0)].text.toUpperCase(), W / 2, cy - 98, font.mono(11, 600), pal.ink3, 'center');
    if (phase === 'run') {
      const t = now - start;
      const i = cur(now);
      if (i >= 0 && i < b.events.length && t - onsets[i] < T().on) {
        const e = b.events[i];
        sym(c, e, W / 2 + e.side * pw * 0.26, cy);
      }
      if (b.rules.some((x) => x.side)) {
        c.setLineDash([3, 5]);
        c.strokeStyle = pal.line;
        c.beginPath();
        c.moveTo(W / 2, cy - 80);
        c.lineTo(W / 2, cy + 80);
        c.stroke();
        c.setLineDash([]);
      }
      const k = (now - flashAt) / 250;
      if (k < 1) circle(c, W / 2, cy, 90 + k * 20, alpha(pal.ink, 0.5 * (1 - k)), undefined, 2);
      // Progress through the block.
      const done = Math.max(0, i) / b.events.length;
      c.fillStyle = alpha(pal.accent, 0.6);
      c.fillRect(W / 2 - pw / 2 + 12, cy + 108, (pw - 24) * done, 2);
    }
    if (phase === 'brief' || phase === 'switch') text(c, 'press to start', W / 2, cy, font.mono(12, 500), pal.ink2, 'center', 'middle');
    return phase === 'run';
  };
  /** Index of the event on screen now (by onset), −1 before the first. */
  function cur(now: number) {
    const t = now - start;
    let i = -1;
    for (let j = 0; j < onsets.length; j++) if (onsets[j] != null && onsets[j] <= t) i = j;
    return i;
  }

  return { reset, destroy: () => bench.destroy() };
};

export default factory;
