// 31 · TRACE — watch cells light one at a time, then tap the same cells in the same order.
// State machine: ready → demo → recall → (feedback) → next trial … → results. The sequence is generated from
// the seed before the demo starts; input is ignored outside the recall phase, and a hidden page or lost focus
// during the demo cancels and replays the trial (it is never scored). Length adapts: a correct trial adds one,
// two failures in a row at the same length end the run. Score: the longest sequence reproduced exactly.
import { clamp, easeOut, font, pal, text } from '../core/draw';
import { alpha, glow, plate, rr } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { AMBER, Bench, mean } from './kit';

export interface TraceCfg {
  n: number; // grid side
  start: number; // first length
  on: number; // ms a cell stays lit
  gap: number; // ms between cells
  repeats: boolean; // a cell may come back (never twice in a row)
  distract: boolean; // hollow amber flashes to ignore
}
export const TRACE: Record<Level, TraceCfg> = {
  easy: { n: 3, start: 3, on: 620, gap: 260, repeats: false, distract: false },
  medium: { n: 4, start: 4, on: 520, gap: 210, repeats: true, distract: false },
  hard: { n: 5, start: 5, on: 430, gap: 170, repeats: true, distract: true },
};
export const MAX_TRIALS = 12;

/** A sequence of `len` cells on an n×n grid. Without repeats, cells are distinct; never the same cell twice in a row. */
export function makeSequence(seed: number, cfg: TraceCfg, len: number): number[] {
  const r = rng(seed);
  const N = cfg.n * cfg.n;
  const seq: number[] = [];
  let guard = 0;
  while (seq.length < len && guard++ < 10000) {
    const c = r.int(0, N - 1);
    if (seq.length && c === seq[seq.length - 1]) continue;
    // Without repeats, cells are distinct until the grid runs out; with repeats, a used cell comes back sometimes.
    if (seq.includes(c) && !((cfg.repeats || seq.length >= N) && r.next() < 0.3)) continue;
    seq.push(c);
  }
  return seq;
}

/** Distractor flashes: (time offset, cell) pairs between the real cells; never on the cell lit next. */
export function makeDistractors(seed: number, cfg: TraceCfg, seq: number[]) {
  if (!cfg.distract) return [] as { at: number; cell: number }[];
  const r = rng(seed ^ 0x5bd1e995);
  const out: { at: number; cell: number }[] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    if (r.next() < 0.45) {
      let cell = r.int(0, cfg.n * cfg.n - 1);
      while (cell === seq[i] || cell === seq[i + 1]) cell = (cell + 1) % (cfg.n * cfg.n);
      out.push({ at: i * (cfg.on + cfg.gap) + cfg.on + cfg.gap * 0.15, cell });
    }
  }
  return out;
}

/** Compare a recall with the sequence: how many leading positions were right, and was it exact. */
export function judgeRecall(seq: number[], taps: number[]) {
  let prefix = 0;
  while (prefix < taps.length && prefix < seq.length && taps[prefix] === seq[prefix]) prefix++;
  const positional = seq.reduce((s, c, i) => s + (taps[i] === c ? 1 : 0), 0);
  return { prefix, exact: prefix === seq.length && taps.length === seq.length, positional, firstError: prefix < seq.length ? prefix : -1 };
}

/** The adaptive staircase: next length and whether the run continues. */
export function nextLength(len: number, exact: boolean, failsAtLen: number) {
  if (exact) return { len: len + 1, fails: 0, over: false };
  return { len, fails: failsAtLen + 1, over: failsAtLen + 1 >= 2 };
}

type Phase = 'ready' | 'demo' | 'recall' | 'feedback' | 'done';
interface Trial {
  seq: number[];
  taps: number[];
  exact: boolean;
  prefix: number;
  ms: number[];
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let cfg = TRACE[api.level];
  let seed0 = 0;
  let phase: Phase = 'ready';
  let len = 0;
  let fails = 0;
  let trials: Trial[] = [];
  let cur: Trial | null = null;
  let distract: { at: number; cell: number }[] = [];
  let demoAt = 0;
  let lastTap = 0;
  let flash: { cell: number; at: number; ok: boolean }[] = [];
  let cursor = 0;

  const geo = () => {
    const top = 80;
    const S = Math.max(160, Math.min(stage.w - 32, stage.h - top - 80, 460));
    const gap = S * 0.035;
    const cs = (S - gap * (cfg.n - 1)) / cfg.n;
    return { x0: (stage.w - S) / 2, y0: top, S, gap, cs };
  };
  const cellAt = (x: number, y: number) => {
    const g = geo();
    const col = Math.floor((x - g.x0) / (g.cs + g.gap));
    const row = Math.floor((y - g.y0) / (g.cs + g.gap));
    if (col < 0 || row < 0 || col >= cfg.n || row >= cfg.n) return -1;
    const lx = x - g.x0 - col * (g.cs + g.gap);
    const ly = y - g.y0 - row * (g.cs + g.gap);
    return lx <= g.cs && ly <= g.cs ? row * cfg.n + col : -1;
  };

  function reset(seed: number) {
    bench.clear();
    cfg = TRACE[api.level];
    seed0 = seed;
    phase = 'ready';
    len = cfg.start;
    fails = 0;
    trials = [];
    cur = null;
    flash = [];
    api.progress(`length ${len}`);
    api.prompt('Watch the cells light up, then tap them in the same order.', `${cfg.repeats ? 'A cell can come back. ' : ''}${cfg.distract ? 'Ignore the hollow amber flashes. ' : ''}Press to start`);
    stage.request();
  }

  function demo() {
    bench.clear();
    const s = seed0 + trials.length * 7919;
    cur = { seq: makeSequence(s, cfg, len), taps: [], exact: false, prefix: 0, ms: [] };
    distract = makeDistractors(s, cfg, cur.seq);
    phase = 'demo';
    demoAt = performance.now() + 450;
    api.progress(`length ${len}`);
    api.prompt('Watch…', '');
    const total = len * (cfg.on + cfg.gap);
    cur.seq.forEach((_, i) => bench.later(() => api.sfx.step(), 450 + i * (cfg.on + cfg.gap)));
    bench.later(() => {
      phase = 'recall';
      lastTap = performance.now();
      cursor = 0;
      api.prompt(`Your turn: ${len} cells, in order.`, 'Tap the cells · or arrows + Space');
      stage.request();
    }, 450 + total);
    stage.request();
  }

  function tap(cell: number, t = performance.now()) {
    if (phase !== 'recall' || !cur || cell < 0) return;
    const i = cur.taps.length;
    const ok = cur.seq[i] === cell;
    cur.taps.push(cell);
    cur.ms.push(t - lastTap);
    lastTap = t;
    flash.push({ cell, at: performance.now(), ok });
    if (ok) api.sfx.press();
    else {
      api.sfx.fail();
      api.fx.shake(2, 0.15);
    }
    // One wrong cell ends the trial (exact recall is the test); a full correct sequence ends it too.
    if (!ok || cur.taps.length === cur.seq.length) endTrial();
    stage.request();
  }

  function endTrial() {
    if (!cur) return;
    const j = judgeRecall(cur.seq, cur.taps);
    cur.exact = j.exact;
    cur.prefix = j.prefix;
    trials.push(cur);
    phase = 'feedback';
    const nx = nextLength(len, j.exact, fails);
    if (j.exact) api.fx.burst(stage.w / 2, geo().y0 + geo().S / 2, pal.accent, 16);
    api.prompt(j.exact ? `All ${len} right.` : `Cell ${j.prefix + 1} was wrong — ${j.prefix} of ${len} before the error.`, nx.over || trials.length >= MAX_TRIALS ? '' : `Next: length ${nx.len} · press to continue`);
    len = nx.len;
    fails = nx.fails;
    if (nx.over || trials.length >= MAX_TRIALS) finish();
  }

  function finish() {
    phase = 'done';
    const span = Math.max(0, ...trials.filter((t) => t.exact).map((t) => t.seq.length));
    const exact = trials.filter((t) => t.exact).length;
    const posAcc = trials.reduce((s, t) => s + judgeRecall(t.seq, t.taps).positional, 0) / Math.max(1, trials.reduce((s, t) => s + t.seq.length, 0));
    const rows: [string, string][] = trials.map((t, i) => [`${i + 1} · length ${t.seq.length}`, t.exact ? '✓ exact' : `✗ first error at position ${t.prefix + 1} (${t.prefix} right before it)`]);
    rows.push(['Exact trials', `${exact} of ${trials.length}`]);
    rows.push(['Positions right (all trials)', `${(posAcc * 100).toFixed(0)}%`]);
    rows.push(['Mean time per tap', `${(mean(trials.flatMap((t) => t.ms.slice(1))) / 1000).toFixed(2)} s`]);
    bench.finish({
      score: span,
      value: String(span),
      unit: 'cells',
      label: 'longest sequence reproduced exactly',
      headline: span ? `Span ${span}: your longest exact sequence.` : 'No exact sequence this time.',
      rows,
      accuracy: posAcc,
      perfect: false,
      near: span >= cfg.start + 4,
      share: [`TRACE · ${api.level}`, `span ${span}`],
    });
  }

  bench.onTap = (p, e) => {
    // A stray second tap right after the last cell must not start the next demonstration.
    if (phase === 'ready' || (phase === 'feedback' && performance.now() - lastTap > 350)) return demo();
    if (phase === 'recall') tap(cellAt(p.x, p.y), e.timeStamp);
  };
  bench.onKey = (e) => {
    if (e.repeat) return;
    const go = e.key === 'Enter' || e.code === 'Space';
    if ((phase === 'ready' || phase === 'feedback') && go) demo();
    else if (phase === 'recall') {
      const n = cfg.n;
      if (e.key === 'ArrowLeft') cursor = (cursor + n * n - 1) % (n * n);
      else if (e.key === 'ArrowRight') cursor = (cursor + 1) % (n * n);
      else if (e.key === 'ArrowUp') cursor = (cursor + n * n - n) % (n * n);
      else if (e.key === 'ArrowDown') cursor = (cursor + n) % (n * n);
      else if (go) tap(cursor, e.timeStamp);
      else return;
    } else return;
    e.preventDefault();
  };
  bench.onAway = () => {
    if (phase !== 'demo') return;
    // Cancel and replay the same trial: nothing was scored.
    bench.clear();
    phase = 'ready';
    api.prompt('Paused — the page lost focus during the demonstration.', 'Press to watch this sequence again');
    stage.request();
  };

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    const g = geo();
    let more = phase === 'demo';
    plate(c, g.x0 - 12, g.y0 - 12, g.S + 24, g.S + 24, 12);
    const t = now - demoAt;
    const step = cfg.on + cfg.gap;
    const litIdx = phase === 'demo' && t >= 0 ? Math.floor(t / step) : -1;
    const lit = cur && litIdx >= 0 && litIdx < cur.seq.length && t - litIdx * step < cfg.on ? cur.seq[litIdx] : -1;
    const dis = phase === 'demo' ? distract.find((d) => t >= d.at && t < d.at + cfg.gap * 0.7) : undefined;
    for (let i = 0; i < cfg.n * cfg.n; i++) {
      const x = g.x0 + (i % cfg.n) * (g.cs + g.gap);
      const y = g.y0 + Math.floor(i / cfg.n) * (g.cs + g.gap);
      rr(c, x, y, g.cs, g.cs, 6);
      c.fillStyle = phase === 'recall' ? pal.paper2 : alpha(pal.ink, 0.04);
      c.fill();
      c.strokeStyle = phase === 'recall' ? alpha(pal.accent, 0.35) : pal.line2;
      c.lineWidth = 1;
      c.stroke();
      if (i === lit) {
        const k = clamp((t - litIdx * step) / 90, 0, 1);
        glow(c, x + g.cs / 2, y + g.cs / 2, g.cs * 0.9, pal.accent, k);
        rr(c, x + 2, y + 2, g.cs - 4, g.cs - 4, 5);
        c.fillStyle = alpha(pal.accent, 0.85 * k);
        c.fill();
      }
      if (dis && dis.cell === i) {
        rr(c, x + 6, y + 6, g.cs - 12, g.cs - 12, 5);
        c.strokeStyle = AMBER;
        c.lineWidth = 2.5;
        c.stroke();
      }
      if (phase === 'recall' && i === cursor) {
        rr(c, x - 3, y - 3, g.cs + 6, g.cs + 6, 8);
        c.strokeStyle = alpha(pal.ink, 0.5);
        c.lineWidth = 1;
        c.stroke();
      }
    }
    for (const f of flash) {
      const age = (now - f.at) / 380;
      if (age >= 1) continue;
      more = true;
      const x = g.x0 + (f.cell % cfg.n) * (g.cs + g.gap);
      const y = g.y0 + Math.floor(f.cell / cfg.n) * (g.cs + g.gap);
      rr(c, x, y, g.cs, g.cs, 6);
      c.fillStyle = alpha(f.ok ? pal.ink : pal.signal, 0.6 * (1 - easeOut(age)));
      c.fill();
    }
    flash = flash.filter((f) => now - f.at < 380);
    // After a trial: the true order, numbered; your wrong cell in coral.
    if ((phase === 'feedback' || phase === 'done') && trials.length) {
      const last = trials[trials.length - 1];
      last.seq.forEach((cell, i) => {
        const x = g.x0 + (cell % cfg.n) * (g.cs + g.gap) + 10 + (i % 3) * 16;
        const y = g.y0 + Math.floor(cell / cfg.n) * (g.cs + g.gap) + 18 + Math.floor(i / 3) * 16;
        text(c, String(i + 1), x, y, font.mono(12, 600), i < last.prefix ? pal.accent : pal.ink2, 'center', 'middle');
      });
      if (!last.exact && last.taps.length) {
        const cell = last.taps[last.taps.length - 1];
        rr(c, g.x0 + (cell % cfg.n) * (g.cs + g.gap), g.y0 + Math.floor(cell / cfg.n) * (g.cs + g.gap), g.cs, g.cs, 6);
        c.strokeStyle = pal.signal;
        c.lineWidth = 2;
        c.stroke();
      }
    }
    // Progress pips for the recall.
    if (cur && (phase === 'recall' || phase === 'demo')) {
      const n = cur.seq.length;
      for (let i = 0; i < n; i++) {
        const x = stage.w / 2 + (i - (n - 1) / 2) * 16;
        const done = phase === 'recall' && i < cur.taps.length;
        c.beginPath();
        c.arc(x, g.y0 + g.S + 30, 4, 0, Math.PI * 2);
        c.fillStyle = done ? pal.accent : phase === 'demo' && i <= litIdx ? pal.ink2 : pal.line;
        c.fill();
      }
    }
    if (phase === 'ready') text(c, 'press to start', stage.w / 2, g.y0 + g.S + 34, font.mono(12, 500), pal.ink2, 'center', 'middle');
    text(c, phase === 'demo' ? 'WATCH' : phase === 'recall' ? 'RECALL' : '', g.x0, g.y0 - 20, font.mono(10, 600), phase === 'recall' ? pal.accent : pal.ink3);
    return more;
  };

  return { reset, destroy: () => bench.destroy() };
};

export default factory;
