// 52 · COUNTERPOINT — two streams, one set of shared gates.
// Tokens drop one at a time, alternating A, B, A, B… through a network of two-way gates into numbered
// bins. The two streams obey different, fixed rules:
//   A  leaves a gate on the side its arrow points to, and flips the gate as it passes.
//   B  leaves on the side opposite the arrow, and leaves the gate as it is.
// Some gates are wired to another gate: any token passing the first also flips the second. So every A
// token reshapes the route of the B token after it — the streams interact only through the shared gates.
// You set the gates' starting positions, then Run. Each puzzle is solved by brute force over every
// starting configuration before it is shown: at least one works, not too many do (no blind luck), and in
// every working configuration some B token passes a gate that an A token changed — the target cannot be
// met by treating the streams separately. Any working configuration is accepted.
import { clamp, font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

export interface Gate {
  /** Outlet targets for arrow-left (0) and arrow-right (1): a gate index, or −1 − bin. */
  out: [number, number];
  layer: number;
  col: number;
  lock?: number;
  link?: number;
}
export interface Machine {
  gates: Gate[];
  bins: number;
  srcA: number;
  srcB: number;
  order: ('A' | 'B')[];
}
export interface RunOut {
  out: { s: 'A' | 'B'; bin: number; path: number[] }[];
  final: number[];
  interact: boolean;
}

export function simulate(m: Machine, init: number[]): RunOut {
  const st = [...init];
  const touchedByA = new Set<number>();
  let interact = false;
  const out: RunOut['out'] = [];
  for (const s of m.order) {
    let g = s === 'A' ? m.srcA : m.srcB;
    const path: number[] = [];
    let guard = 0;
    while (g >= 0 && guard++ < 64) {
      path.push(g);
      const gate = m.gates[g];
      let dir: number;
      if (s === 'A') {
        dir = st[g];
        st[g] ^= 1;
        touchedByA.add(g);
      } else {
        if (touchedByA.has(g)) interact = true;
        dir = 1 - st[g];
      }
      if (gate.link !== undefined) {
        st[gate.link] ^= 1;
        if (s === 'A') touchedByA.add(gate.link);
      }
      g = gate.out[dir];
    }
    out.push({ s, bin: -1 - g, path });
  }
  return { out, final: st, interact };
}

export type Goal =
  | { type: 'sequence'; bins: number[] }
  | { type: 'counts'; a: number[]; b: number[] }
  | { type: 'state'; final: number[] }
  | { type: 'rules'; rules: { id: string; text: string }[] };

const RULES: { id: string; text: (k: number) => string; test: (o: RunOut, k: number, bins: number) => boolean }[] = [
  { id: 'aAvoid', text: (k) => `A never lands in bin ${k + 1}`, test: (o, k) => o.out.every((t) => t.s !== 'A' || t.bin !== k) },
  { id: 'bAlways', text: (k) => `every B lands in bin ${k + 1}`, test: (o, k) => o.out.every((t) => t.s !== 'B' || t.bin === k) },
  { id: 'aAlt', text: () => 'A alternates between two different bins', test: (o) => { const a = o.out.filter((t) => t.s === 'A').map((t) => t.bin); return a.length > 1 && a.every((b, i) => i < 2 || b === a[i - 2]) && a[0] !== a[1]; } },
  { id: 'allBins', text: () => 'every bin receives a token', test: (o, _k, bins) => Array.from({ length: bins }, (_, b) => o.out.some((t) => t.bin === b)).every(Boolean) },
  { id: 'apart', text: () => 'each B lands in a different bin from the A just before it', test: (o) => o.out.every((t, i) => t.s !== 'B' || i === 0 || o.out[i - 1].bin !== t.bin) },
];
const ruleOf = (id: string) => {
  const [base, k] = id.split(':');
  return { r: RULES.find((x) => x.id === base)!, k: Number(k) };
};

export function meets(m: Machine, goal: Goal, o: RunOut) {
  switch (goal.type) {
    case 'sequence':
      return o.out.every((t, i) => t.bin === goal.bins[i]);
    case 'counts': {
      const ca = Array(m.bins).fill(0);
      const cb = Array(m.bins).fill(0);
      for (const t of o.out) (t.s === 'A' ? ca : cb)[t.bin]++;
      return ca.every((v, i) => v === goal.a[i]) && cb.every((v, i) => v === goal.b[i]);
    }
    case 'state':
      return o.final.every((v, i) => v === goal.final[i]);
    case 'rules':
      return goal.rules.every((x) => {
        const { r, k } = ruleOf(x.id);
        return r.test(o, k, m.bins);
      });
  }
}

export interface CpRound {
  kind: 'sequence' | 'bottleneck' | 'cross' | 'sync' | 'conflict' | 'minimal';
  m: Machine;
  goal: Goal;
  /** Starting gate positions shown (minimal family) — otherwise all left. */
  start: number[];
  /** Every working configuration (for checking and for the reveal). */
  solutions: number[][];
  minFlips: number;
}

export const configs = (m: Machine) => {
  const free = m.gates.map((g, i) => (g.lock === undefined ? i : -1)).filter((i) => i >= 0);
  return Array.from({ length: 1 << free.length }, (_, k) => {
    const c = m.gates.map((g) => g.lock ?? 0);
    free.forEach((gi, j) => (c[gi] = (k >> j) & 1));
    return c;
  });
};

function machine(r: Rng, band: Band, shared: boolean, links: number): Machine | null {
  const g = [4, 5, 6, 7][band];
  const bins = band === 0 ? 3 : 4;
  const layers = shared ? (g === 4 ? [1, 2, 1] : g === 5 ? [1, 2, 2] : g === 6 ? [1, 2, 3] : [1, 3, 3]) : g === 4 ? [2, 2] : g === 5 ? [2, 2, 1] : g === 6 ? [2, 2, 2] : [2, 3, 2];
  const gates: Gate[] = [];
  layers.forEach((n, L) => {
    for (let c = 0; c < n; c++) gates.push({ out: [0, 0], layer: L, col: c });
  });
  const later = (i: number) => gates.map((x, j) => (x.layer > gates[i].layer ? j : -1)).filter((j) => j >= 0);
  for (let i = 0; i < gates.length; i++) {
    const nxt = later(i);
    const pick = () => (nxt.length && r.next() < 0.7 ? r.pick(nxt) : -1 - r.int(0, bins - 1));
    let a = pick();
    let b = pick();
    for (let t = 0; t < 10 && a === b; t++) b = pick();
    if (a === b) return null;
    gates[i].out = r.next() < 0.5 ? [a, b] : [b, a];
  }
  // Separate sources still meet: both feed gate 2, so the streams share at least one gate.
  if (!shared) {
    const sa = r.int(0, 1);
    const sb = r.int(0, 1);
    if (gates[0].out[1 - sa] !== 2) gates[0].out[sa] = 2;
    if (gates[1].out[1 - sb] !== 2) gates[1].out[sb] = 2;
  }
  // Every non-source gate must be fed: an unfed gate takes over a bin outlet of an earlier gate.
  for (let i = 0; i < gates.length; i++) {
    if (gates[i].layer === 0 || gates.some((x) => x.out.includes(i))) continue;
    const slots: [number, number][] = [];
    gates.forEach((x, j) => x.layer < gates[i].layer && x.out.forEach((o, k) => o < 0 && slots.push([j, k])));
    if (!slots.length) return null;
    const [j, k] = r.pick(slots);
    gates[j].out[k] = i;
  }
  for (let i = 0; i < gates.length; i++) if (gates[i].layer > 0 && !gates.some((x) => x.out.includes(i))) return null;
  for (let k = 0; k < links; k++) {
    const a = r.int(0, gates.length - 1);
    const b = r.int(0, gates.length - 1);
    if (a !== b && gates[a].link === undefined) gates[a].link = b;
  }
  if (band === 3) gates[r.int(1, gates.length - 1)].lock = r.int(0, 1);
  // A shared entrance carries more traffic, so the totals per bin say more.
  const n = [6, 6, 8, 8][band] + (shared ? 2 : 0);
  return { gates, bins, srcA: 0, srcB: shared ? 0 : 1, order: Array.from({ length: n }, (_, i) => (i % 2 ? 'B' : 'A')) };
}

function finish(kind: CpRound['kind'], m: Machine, goal: Goal, band: Band, start?: number[]): CpRound | null {
  const all = configs(m);
  const sols = all.filter((c) => meets(m, goal, simulate(m, c)));
  // Not blind luck: at most half the settings work (a third from band 1; totals are coarser, so half).
  const share = band === 0 || goal.type === 'counts' ? 0.5 : 0.34;
  if (!sols.length || sols.length > Math.max(1, all.length * share)) return null;
  // The shared gates must matter in every solution.
  if (!sols.every((c) => simulate(m, c).interact)) return null;
  const s0 = start ?? m.gates.map((g) => g.lock ?? 0);
  const minFlips = Math.min(...sols.map((c) => c.reduce((a, v, i) => a + (v !== s0[i] ? 1 : 0), 0)));
  if (kind === 'minimal' && minFlips < 1) return null;
  return { kind, m, goal, start: s0, solutions: sols, minFlips };
}

const witness = (r: Rng, m: Machine) => simulate(m, configs(m)[r.int(0, configs(m).length - 1)]);

function genSequence(r: Rng, band: Band, kind: 'sequence' | 'cross' = 'sequence') {
  const m = machine(r, band, false, kind === 'cross' ? (band >= 2 ? 2 : 1) : 0);
  if (!m) return null;
  return finish(kind, m, { type: 'sequence', bins: witness(r, m).out.map((t) => t.bin) }, band);
}
function genBottleneck(r: Rng, band: Band) {
  const m = machine(r, Math.max(1, band) as Band, true, 0);
  if (!m) return null;
  const o = witness(r, m);
  const a = Array(m.bins).fill(0);
  const b = Array(m.bins).fill(0);
  for (const t of o.out) (t.s === 'A' ? a : b)[t.bin]++;
  return finish('bottleneck', m, { type: 'counts', a, b }, band);
}
function genSync(r: Rng, band: Band) {
  const m = machine(r, band, false, band >= 2 ? 1 : 0);
  if (!m) return null;
  return finish('sync', m, { type: 'state', final: witness(r, m).final }, band);
}
function genConflict(r: Rng, band: Band) {
  const m = machine(r, band, false, band >= 3 ? 1 : 0);
  if (!m) return null;
  // Constraints are drawn from those a witness run satisfies, so at least one setting meets both.
  const w = witness(r, m);
  const ok = RULES.flatMap((x) => Array.from({ length: m.bins }, (_, k) => ({ x, k }))).filter(({ x, k }) => x.test(w, k, m.bins));
  if (ok.length < 2) return null;
  const a = r.pick(ok);
  const rest = ok.filter((o) => o.x.id !== a.x.id);
  if (!rest.length) return null;
  const b = r.pick(rest);
  const rule = (o: { x: (typeof RULES)[number]; k: number }) => ({ id: `${o.x.id}:${o.k}`, text: o.x.text(o.k) });
  return finish('conflict', m, { type: 'rules', rules: [rule(a), rule(b)] }, band);
}
function genMinimal(r: Rng, band: Band) {
  const m = machine(r, Math.max(1, band) as Band, false, band >= 2 ? 1 : 0);
  if (!m) return null;
  const goal: Goal = { type: 'sequence', bins: witness(r, m).out.map((t) => t.bin) };
  const start = configs(m)[r.int(0, configs(m).length - 1)];
  if (meets(m, goal, simulate(m, start))) return null;
  return finish('minimal', m, goal, band, start);
}

const msig = (m: Machine) => m.gates.map((g) => `${g.out.join(',')}${g.link ?? ''}${g.lock ?? ''}`).join('|');
export const FAMILIES: Family<CpRound>[] = [
  { id: 'sequence', name: 'Sequence', teach: 'Tap gates to set their arrows, then Run. A follows the arrow and flips it; B goes against it. Match the target bins in order.', bands: [0, 3], intro: true, gen: (r, b) => genSequence(r, b), sig: (rd) => `${msig(rd.m)}|${JSON.stringify(rd.goal)}` },
  { id: 'bottleneck', name: 'Bottleneck', teach: 'Both streams enter through one shared gate. Only the totals per bin matter.', bands: [1, 3], gen: genBottleneck, sig: (rd) => `${msig(rd.m)}|${JSON.stringify(rd.goal)}` },
  { id: 'cross', name: 'Cross-coupled', teach: 'A dashed wire links two gates: any token through the first also flips the second.', bands: [1, 3], gen: (r, b) => genSequence(r, b, 'cross'), sig: (rd) => `${msig(rd.m)}|${JSON.stringify(rd.goal)}` },
  { id: 'sync', name: 'Final state', teach: 'Ignore the bins: after the run, every gate must point the way shown.', bands: [0, 3], gen: genSync, sig: (rd) => `${msig(rd.m)}|${JSON.stringify(rd.goal)}` },
  { id: 'conflict', name: 'Two constraints', teach: 'Each stream has its own constraint. Find a setting that satisfies both at once.', bands: [1, 3], gen: genConflict, sig: (rd) => `${msig(rd.m)}|${JSON.stringify(rd.goal)}` },
  { id: 'minimal', name: 'Fewest changes', teach: 'The gates start in the positions shown. Reach the target with as few gate changes as possible.', bands: [1, 3], gen: genMinimal, sig: (rd) => `${msig(rd.m)}|${JSON.stringify(rd.goal)}|${rd.start.join('')}` },
];

export const ROUNDS = 5;
const MAX_RUNS = 3;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<CpRound>(api, 'counterpoint', FAMILIES, ROUNDS);
  let rd: CpRound;
  let phase: 'set' | 'run' | 'reveal' | 'done' = 'set';
  let cfg: number[] = [];
  let runs = 0;
  let sim: RunOut | null = null;
  let live: number[] = [];
  let tok = 0;
  let hop = 0;
  let t0 = 0;
  let pos: Record<number, { x: number; y: number }> = {};

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'set';
    cfg = [...rd.start];
    runs = 0;
    sim = null;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const g = rd.goal;
    const ask =
      g.type === 'sequence'
        ? `Set the gates so the tokens land in the target bins, in order.${rd.kind === 'minimal' ? ' Change as few gates as possible.' : ''}`
        : g.type === 'counts'
          ? 'Set the gates so each stream fills the bins with the target totals.'
          : g.type === 'state'
            ? 'Set the gates so that, after the run, they point as shown.'
            : `Satisfy both: ${g.rules.map((x) => x.text).join(' · ')}.`;
    api.prompt(ask, sess.teach || `Tap a gate to flip it · Run (${MAX_RUNS} runs; failed runs cost a little)`);
    stage.request();
  }

  function toggle(i: number) {
    if (phase !== 'set' || rd.m.gates[i].lock !== undefined) return;
    cfg[i] ^= 1;
    api.sfx.soft();
  }

  function run() {
    if (phase !== 'set') return;
    runs++;
    sim = simulate(rd.m, cfg);
    live = [...cfg];
    tok = 0;
    hop = 0;
    t0 = performance.now();
    phase = 'run';
    api.sfx.press();
    stage.request();
  }

  function afterRun() {
    const ok = meets(rd.m, rd.goal, sim!);
    const flips = cfg.reduce((a, v, i) => a + (v !== rd.start[i] ? 1 : 0), 0);
    if (ok || runs >= MAX_RUNS) {
      let pen = ok ? Math.min(0.6, 0.15 * (runs - 1)) : 1;
      if (ok && rd.kind === 'minimal') pen = Math.min(0.8, pen + 0.12 * Math.max(0, flips - rd.minFlips));
      const main = ok ? `Done on run ${runs}${rd.kind === 'minimal' ? ` with ${flips} change${flips === 1 ? '' : 's'} (fewest possible: ${rd.minFlips})` : ''}.` : `Not met after ${MAX_RUNS} runs.`;
      const sub = `${rd.solutions.length} of ${configs(rd.m).length} settings work. A’s flips decide where the next B goes — plan the pair, not the token.`;
      phase = 'reveal';
      sess.done(pen, ok ? `run ${runs}${rd.kind === 'minimal' ? ` · ${flips} changes (min ${rd.minFlips})` : ''}` : 'not met', { x: stage.w / 2, y: 120 });
      api.sfx[ok ? 'press' : 'fail']();
      api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
      api.ownKeys(false);
      if (sess.last) {
        phase = 'done';
        const r = sess.result({ label: 'mean penalty per machine (failed runs, extra changes, or not met)', share: 'COUNTERPOINT' });
        if (r) bench.finish(r);
      }
    } else {
      // Explain the first divergence from the goal.
      let why = 'The run did not meet the goal.';
      if (rd.goal.type === 'sequence') {
        const i = sim!.out.findIndex((t, k) => t.bin !== (rd.goal as { bins: number[] }).bins[k]);
        if (i >= 0) why = `Token ${i + 1} (${sim!.out[i].s}) landed in bin ${sim!.out[i].bin + 1}, not ${(rd.goal as { bins: number[] }).bins[i] + 1}.`;
      }
      phase = 'set';
      cfg = [...cfg];
      api.sfx.release();
      api.prompt(why, `Gates are back at your starting setting · ${MAX_RUNS - runs} run${MAX_RUNS - runs === 1 ? '' : 's'} left`);
    }
    stage.request();
  }

  bench.onTap = () => phase === 'reveal' && begin();
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase !== 'set') return;
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= rd.m.gates.length) toggle(Number(e.key) - 1);
    else if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') run();
    else return;
    e.preventDefault();
  };

  function gateGlyph(c: CanvasRenderingContext2D, x: number, y: number, s: number, i: number, active: boolean) {
    const g = rd.m.gates[i];
    rr(c, x - 26, y - 18, 52, 36, 8);
    c.fillStyle = active ? alpha(pal.ink, 0.14) : pal.paper2;
    c.fill();
    c.strokeStyle = g.lock !== undefined ? pal.ink3 : pal.line;
    c.stroke();
    // The rocker: a bar tilted towards the side the arrow points.
    const d = s ? 1 : -1;
    c.strokeStyle = pal.ink;
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - 14 * d, y - 8);
    c.lineTo(x + 14 * d, y + 8);
    c.stroke();
    c.fillStyle = pal.ink;
    c.beginPath();
    c.moveTo(x + 18 * d, y + 10);
    c.lineTo(x + 9 * d, y + 11);
    c.lineTo(x + 14 * d, y + 3);
    c.closePath();
    c.fill();
    text(c, `${i + 1}${g.lock !== undefined ? ' fixed' : ''}`, x - 22, y - 10, font.mono(9, 600), pal.ink3, 'left', 'middle');
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const m = rd.m;
    const nL = Math.max(...m.gates.map((g) => g.layer)) + 1;
    const top = 150;
    const mw = Math.min(W - 40, 640);
    const mx = (W - mw) / 2;
    const dy = Math.min(90, (H - top - 230) / (nL + 1));
    pos = {};
    for (let L = 0; L < nL; L++) {
      const row = m.gates.map((g, i) => ({ g, i })).filter((x) => x.g.layer === L);
      row.forEach(({ i }, k) => (pos[i] = { x: mx + ((k + 1) / (row.length + 1)) * mw, y: top + L * dy }));
    }
    const binY = top + nL * dy + 10;
    const binX = (b: number) => mx + ((b + 0.5) / m.bins) * mw;
    plate(c, mx - 16, top - 56, mw + 32, binY - top + 110, 10);
    // Sources.
    const sa = pos[m.srcA];
    const sb = pos[m.srcB];
    text(c, 'A ↓', sa.x - (m.srcA === m.srcB ? 18 : 0), sa.y - 34, font.mono(12, 700), pal.accent, 'center');
    text(c, 'B ↓', sb.x + (m.srcA === m.srcB ? 18 : 0), sb.y - 34, font.mono(12, 700), AMBER, 'center');
    // Wires.
    const shown = phase === 'run' ? live : cfg;
    m.gates.forEach((g, i) => {
      g.out.forEach((o, side) => {
        const a = { x: pos[i].x + (side ? 22 : -22), y: pos[i].y + 16 };
        const b = o >= 0 ? { x: pos[o].x, y: pos[o].y - 18 } : { x: binX(-1 - o), y: binY };
        c.strokeStyle = shown[i] === side ? alpha(pal.ink, 0.55) : pal.line;
        c.lineWidth = shown[i] === side ? 1.6 : 1;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.bezierCurveTo(a.x, a.y + 20, b.x, b.y - 20, b.x, b.y);
        c.stroke();
      });
      if (g.link !== undefined) {
        c.strokeStyle = alpha(AMBER, 0.7);
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(pos[i].x + 26, pos[i].y);
        c.quadraticCurveTo((pos[i].x + pos[g.link].x) / 2 + 40, (pos[i].y + pos[g.link].y) / 2, pos[g.link].x + 26, pos[g.link].y);
        c.stroke();
        c.setLineDash([]);
      }
    });
    // Bins and their contents.
    for (let b = 0; b < m.bins; b++) {
      const x = binX(b);
      rr(c, x - 30, binY, 60, 40, 6);
      c.fillStyle = pal.paper2;
      c.fill();
      c.strokeStyle = pal.line;
      c.stroke();
      text(c, `bin ${b + 1}`, x, binY + 54, font.mono(9, 600), pal.ink3, 'center');
    }
    let more = false;
    // Animation of the run.
    const landed = phase === 'run' ? tok : sim && phase !== 'set' ? sim.out.length : 0;
    if (sim) {
      sim.out.slice(0, landed).forEach((t, k) => {
        const x = binX(t.bin) - 20 + (k % 5) * 10;
        const y = binY + 12 + Math.floor(k / 5) * 12;
        c.beginPath();
        c.arc(x, y, 4.5, 0, Math.PI * 2);
        c.fillStyle = t.s === 'A' ? pal.accent : AMBER;
        c.fill();
      });
    }
    if (phase === 'run' && sim) {
      const t = sim.out[tok];
      const HOP = api.motion() ? 260 : 40;
      const k = clamp((now - t0) / HOP, 0, 1);
      const stops = [...t.path.map((g) => pos[g]), { x: binX(t.bin), y: binY + 10 }];
      const from = hop === 0 ? { x: stops[0].x, y: stops[0].y - 34 } : stops[hop - 1];
      const to = stops[hop];
      c.beginPath();
      c.arc(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, 7, 0, Math.PI * 2);
      c.fillStyle = t.s === 'A' ? pal.accent : AMBER;
      c.fill();
      if (k >= 1) {
        // Arriving at a gate applies the stream's rule to the live state.
        if (hop < t.path.length) {
          const g = t.path[hop];
          if (t.s === 'A') live[g] ^= 1;
          const ln = m.gates[g].link;
          if (ln !== undefined) live[ln] ^= 1;
        }
        hop++;
        t0 = now;
        if (hop > t.path.length) {
          tok++;
          hop = 0;
          if (tok >= sim.out.length) {
            phase = 'set';
            afterRun();
          }
        }
      }
      more = phase === 'run';
    }
    m.gates.forEach((_, i) => {
      gateGlyph(c, pos[i].x, pos[i].y, shown[i], i, phase === 'run' && sim?.out[tok]?.path[hop] === i);
      if (phase === 'set') bench.hit(pos[i].x - 26, pos[i].y - 18, 52, 36, () => toggle(i));
    });
    // Goal strip.
    const gy = binY + 80;
    const g = rd.goal;
    text(c, 'GOAL', mx, gy, font.mono(10, 600), pal.ink3);
    if (g.type === 'sequence') {
      m.order.forEach((s, k) => {
        // Chips shrink to fit the strip on narrow screens.
        const step = Math.min(54, (mw - 50) / m.order.length);
        const x = mx + 50 + k * step;
        const got = sim && phase !== 'run' ? sim.out[k].bin : -1;
        rr(c, x, gy - 14, step - 8, 24, 5);
        c.fillStyle = alpha(s === 'A' ? pal.accent : AMBER, 0.12);
        c.fill();
        c.strokeStyle = got < 0 ? pal.line : got === g.bins[k] ? pal.accent : pal.signal;
        c.stroke();
        text(c, `${s}→${g.bins[k] + 1}`, x + (step - 8) / 2, gy - 1, font.mono(step < 50 ? 9 : 11, 600), s === 'A' ? pal.accent : AMBER, 'center', 'middle');
      });
    } else if (g.type === 'counts') {
      text(c, `A: ${g.a.map((v, i) => `bin ${i + 1}×${v}`).join(' ')}   B: ${g.b.map((v, i) => `bin ${i + 1}×${v}`).join(' ')}`, mx + 50, gy, font.mono(11, 500), pal.ink);
    } else if (g.type === 'state') {
      g.final.forEach((v, i) => text(c, `${i + 1}${v ? '↘' : '↙'}`, mx + 50 + i * 40, gy, font.mono(13, 600), pal.accent));
      text(c, '(after the run)', mx + 60 + g.final.length * 40, gy, font.mono(10, 500), pal.ink3);
    } else text(c, g.rules.map((x) => x.text).join('  ·  '), mx + 50, gy, font.mono(11, 500), pal.ink);
    if (phase === 'set') {
      bench.button(c, W / 2 - 80, gy + 22, 160, 42, `Run · ${runs}/${MAX_RUNS}`, run, { primary: true, key: 'Enter' });
      if (rd.kind === 'minimal') text(c, `changes so far: ${cfg.reduce((a, v, i) => a + (v !== rd.start[i] ? 1 : 0), 0)}`, W / 2 + 100, gy + 46, font.mono(10, 500), pal.ink3);
    }
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return more;
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
