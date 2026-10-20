// 35 · HYPOTHESIS — find the hidden rule by experiment.
// Each round shows a finite family of candidate rules about two-digit numbers (10–99); one of them is the
// hidden rule. Test a number and the rule answers truthfully: in or out. Then commit to a rule. The game
// tracks exactly which candidates every observation leaves standing (Easy and Medium show it; on Hard you
// keep track yourself). Candidates in a round are pairwise distinguishable on 10–99, and the test budget is
// at least the depth of a greedy splitting strategy, so every round is solvable. Committing while several
// rules still fit is a lucky guess, not a deduction: it costs half a round even when it happens to be right.
import { font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { AMBER, Bench, mean, roundStrip, shuffle } from './kit';

export interface Rule {
  id: string;
  text: string;
  f: (n: number) => boolean;
}
const T = (n: number) => Math.floor(n / 10);
const U = (n: number) => n % 10;
const isPrime = (n: number) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};
export const BASE: Rule[] = [
  { id: 'even', text: 'even', f: (n) => n % 2 === 0 },
  { id: 'm3', text: 'a multiple of 3', f: (n) => n % 3 === 0 },
  { id: 'm4', text: 'a multiple of 4', f: (n) => n % 4 === 0 },
  { id: 'm5', text: 'a multiple of 5', f: (n) => n % 5 === 0 },
  { id: 'm6', text: 'a multiple of 6', f: (n) => n % 6 === 0 },
  { id: 'gt50', text: 'greater than 50', f: (n) => n > 50 },
  { id: 'lt40', text: 'less than 40', f: (n) => n < 40 },
  { id: 'inc', text: 'digits strictly increasing (e.g. 37)', f: (n) => T(n) < U(n) },
  { id: 'dec', text: 'digits strictly decreasing (e.g. 73)', f: (n) => T(n) > U(n) },
  { id: 'sumEven', text: 'digit sum even', f: (n) => (T(n) + U(n)) % 2 === 0 },
  { id: 'sumGt9', text: 'digit sum greater than 9', f: (n) => T(n) + U(n) > 9 },
  { id: 'prime', text: 'prime', f: isPrime },
  { id: 'has7', text: 'contains the digit 7', f: (n) => T(n) === 7 || U(n) === 7 },
  { id: 'tensOdd', text: 'tens digit odd', f: (n) => T(n) % 2 === 1 },
  { id: 'unitsLt5', text: 'units digit less than 5', f: (n) => U(n) < 5 },
  { id: 'square', text: 'a perfect square', f: (n) => Math.round(Math.sqrt(n)) ** 2 === n },
];
const AND = (a: Rule, b: Rule): Rule => ({ id: `${a.id}&${b.id}`, text: `${a.text} AND ${b.text}`, f: (n) => a.f(n) && b.f(n) });
const OR = (a: Rule, b: Rule): Rule => ({ id: `${a.id}|${b.id}`, text: `${a.text} OR ${b.text}`, f: (n) => a.f(n) || b.f(n) });
const NOT = (a: Rule): Rule => ({ id: `!${a.id}`, text: `NOT ${a.text}`, f: (n) => !a.f(n) });

export const DOMAIN = Array.from({ length: 90 }, (_, i) => i + 10);
const sig = (r: Rule) => DOMAIN.map((n) => (r.f(n) ? 1 : 0)).join('');

/** Candidates still consistent with every observation. */
export function consistent(cands: Rule[], obs: { n: number; yes: boolean }[]) {
  return cands.filter((r) => obs.every((o) => r.f(o.n) === o.yes));
}

/** Depth of a greedy strategy (best minimax split each step) that pins down any candidate. */
export function greedyDepth(cands: Rule[]): number {
  if (cands.length <= 1) return 0;
  let best = Infinity;
  let bestN = -1;
  for (const n of DOMAIN) {
    const y = cands.filter((r) => r.f(n)).length;
    const worst = Math.max(y, cands.length - y);
    if (worst < best) {
      best = worst;
      bestN = n;
    }
  }
  if (best === cands.length) return Infinity; // indistinguishable
  return 1 + Math.max(greedyDepth(cands.filter((r) => r.f(bestN))), greedyDepth(cands.filter((r) => !r.f(bestN))));
}

export interface HypRound {
  cands: Rule[];
  hidden: number; // index into cands
  budget: number;
}
const CFG: Record<Level, { n: number; combos: number; slack: number; track: boolean }> = {
  easy: { n: 6, combos: 0, slack: 2, track: true },
  medium: { n: 8, combos: 0.5, slack: 1, track: true },
  hard: { n: 10, combos: 0.8, slack: 1, track: false },
};
export const ROUNDS = 4;

export function makeHypothesis(seed: number, level: Level): HypRound[] {
  const r = rng(seed);
  const cfg = CFG[level];
  const out: HypRound[] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 500) {
    const pool: Rule[] = [...BASE];
    const nCombo = Math.round(cfg.n * cfg.combos);
    for (let i = 0; i < nCombo * 3; i++) {
      const a = r.pick(BASE);
      const b = r.pick(BASE);
      if (a === b) continue;
      pool.push(r.next() < 0.6 ? AND(a, b) : r.next() < 0.7 ? OR(a, b) : AND(a, NOT(b)));
    }
    // The hidden rule, then candidates that agree with it on many numbers (hard to tell apart).
    const hidden = cfg.combos && r.next() < cfg.combos ? r.pick(pool.slice(BASE.length)) : r.pick(BASE);
    const hs = sig(hidden);
    // A hidden rule with almost no IN (or OUT) numbers could not reasonably be found.
    const ins = hs.split('1').length - 1;
    if (ins < 6 || ins > 84) continue;
    const agree = (x: Rule) => sig(x).split('').filter((ch, i) => ch === hs[i]).length;
    const ranked = shuffle(pool.filter((x) => x.id !== hidden.id), r.next).sort((a, b) => agree(b) - agree(a));
    const cands: Rule[] = [hidden];
    const sigs = new Set([hs]);
    for (const x of ranked) {
      if (cands.length >= cfg.n) break;
      const s = sig(x);
      // Distinguishable from every other candidate; not trivially always/never true.
      if (sigs.has(s) || !s.includes('1') || !s.includes('0')) continue;
      // Mix close look-alikes with a few easy ones.
      if (cands.length > cfg.n / 2 && r.next() < 0.4) continue;
      sigs.add(s);
      cands.push(x);
    }
    if (cands.length < cfg.n) continue;
    const depth = greedyDepth(cands);
    if (!Number.isFinite(depth)) continue;
    shuffle(cands, r.next);
    out.push({ cands, hidden: cands.findIndex((x) => x.id === hidden.id), budget: depth + cfg.slack });
  }
  return out;
}

/** Score one round: 0 best, 1 worst. */
export function hypPenalty(rd: HypRound, obs: { n: number; yes: boolean }[], pick: number) {
  const left = consistent(rd.cands, obs);
  if (pick !== rd.hidden) return { pen: 1, left: left.length, redundant: 0 };
  // Redundant tests: ones that eliminated no candidate that was still standing.
  let alive = rd.cands;
  let redundant = 0;
  for (const o of obs) {
    const nx = alive.filter((x) => x.f(o.n) === o.yes);
    if (nx.length === alive.length) redundant++;
    alive = nx;
  }
  const lucky = left.length > 1 ? 0.5 : 0;
  return { pen: Math.min(1, lucky + 0.1 * redundant), left: left.length, redundant };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  let rounds: HypRound[] = [];
  let round = 0;
  let phase: 'test' | 'reveal' | 'done' = 'test';
  let obs: { n: number; yes: boolean; cut: number }[] = [];
  let entry = '';
  let sel = -1;
  let struck = new Set<number>();
  let res: { pen: number; tests: number; redundant: number; left: number; best: string }[] = [];
  const track = () => CFG[api.level].track;

  function reset(seed: number) {
    bench.clear();
    rounds = makeHypothesis(seed, api.level);
    round = 0;
    res = [];
    begin();
  }

  function begin() {
    phase = 'test';
    obs = [];
    entry = '';
    sel = -1;
    struck = new Set();
    api.ownKeys(true);
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('One of these rules decides which numbers are IN. Find it.', `Test numbers 10–99 (type, Enter) · ${rounds[round].budget} tests · then tap a rule and Commit${track() ? '' : ' · Hard: strike out rules yourself (tap ✕)'}`);
    stage.request();
  }

  function test() {
    const rd = rounds[round];
    const n = Number(entry);
    entry = '';
    if (phase !== 'test' || !(n >= 10 && n <= 99) || obs.length >= rd.budget) return;
    if (obs.some((o) => o.n === n)) {
      api.prompt(`${n} was already tested.`, 'Repeating a test tells you nothing new.');
      return;
    }
    const yes = rd.cands[rd.hidden].f(n);
    const before = consistent(rd.cands, obs).length;
    const after = consistent(rd.cands, [...obs, { n, yes }]).length;
    obs.push({ n, yes, cut: before - after });
    api.sfx[yes ? 'press' : 'release']();
    const left = rd.budget - obs.length;
    api.prompt(`${n} is ${yes ? 'IN' : 'OUT'}.${track() ? ` ${after} rule${after === 1 ? '' : 's'} still fit.` : ''}`, left ? `${left} test${left === 1 ? '' : 's'} left` : 'No tests left — commit to a rule');
  }

  function commit() {
    const rd = rounds[round];
    if (phase !== 'test' || sel < 0) return;
    const p = hypPenalty(rd, obs, sel);
    // The most informative test: the one that cut the most rules.
    const top = obs.reduce((b, o) => (o.cut > (b?.cut ?? -1) ? o : b), null as null | (typeof obs)[number]);
    const best = top && top.cut ? `${top.n} split off ${top.cut} rule${top.cut > 1 ? 's' : ''}` : '—';
    res.push({ pen: p.pen, tests: obs.length, redundant: p.redundant, left: p.left, best });
    api.judge(p.pen * 100, { x: stage.w / 2, y: 110 });
    const h = rd.cands[rd.hidden];
    api.prompt(
      sel === rd.hidden ? (p.left > 1 ? `Right — but ${p.left} rules still fitted the evidence: a lucky guess.` : `Right: “${h.text}”.`) : `No — it was “${h.text}”.`,
      `${best !== '—' ? `Most useful test: ${best}. ` : ''}${p.redundant ? `${p.redundant} test${p.redundant > 1 ? 's' : ''} eliminated nothing. ` : ''}${round < ROUNDS - 1 ? 'Tap for the next' : ''}`,
    );
    phase = 'reveal';
    api.ownKeys(false);
    if (round === ROUNDS - 1) finish();
  }

  function finish() {
    phase = 'done';
    const pct = mean(res.map((r) => r.pen)) * 100;
    const rows: [string, string][] = rounds.map((rd, i) => [`${i + 1} · ${rd.cands.length} rules, ${rd.budget} tests`, `${res[i].pen === 1 ? '✗' : res[i].pen ? '½' : '✓'} ${res[i].tests} tests · ${res[i].redundant} redundant · ${res[i].left} left standing`]);
    rows.push(['Most useful tests', res.map((r) => r.best).join(' · ')]);
    rows.push(['Lucky guesses', String(res.filter((r) => r.left > 1 && r.pen < 1).length)]);
    bench.finish({
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: 'penalty per rule (wrong, lucky or wasteful)',
      headline: pct === 0 ? 'Every rule found by evidence, with no wasted test.' : `${pct.toFixed(0)}% penalty: ${res.filter((r) => r.pen === 1).length} wrong, ${res.filter((r) => r.left > 1 && r.pen < 1).length} lucky.`,
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct === 0,
      near: pct < 8,
      share: [`HYPOTHESIS · ${api.level}`, `${pct.toFixed(0)}% penalty`],
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
    if (phase === 'test') {
      if (/^[0-9]$/.test(e.key) && entry.length < 2) entry += e.key;
      else if (e.key === 'Backspace') entry = entry.slice(0, -1);
      else if (e.key === 'Enter') {
        if (entry) test();
        else commit();
      } else return;
      e.preventDefault();
    } else if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      next();
    }
  };

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const W = stage.w;
    const top = 74;
    const wide = W >= 760;
    const listW = wide ? Math.min(520, W * 0.55) : W - 32;
    const lx = wide ? 16 + Math.max(0, (W - 32 - listW - 300) / 2) : 16;
    const rowH = 30;
    const alive = new Set(consistent(rd.cands, obs).map((x) => x.id));
    const judged = phase !== 'test';
    plate(c, lx - 6, top - 6, listW + 12, rd.cands.length * rowH + 12, 10);
    rd.cands.forEach((x, i) => {
      const y = top + i * rowH;
      const dead = (track() || judged) && !alive.has(x.id);
      const mine = struck.has(i) && !judged;
      const isSel = sel === i;
      rr(c, lx, y + 2, listW, rowH - 4, 5);
      c.fillStyle = isSel ? alpha(pal.accent, 0.14) : judged && i === rd.hidden ? alpha(pal.accent, 0.2) : 'rgba(0,0,0,0)';
      c.fill();
      if (isSel) {
        c.strokeStyle = judged && i !== rd.hidden ? pal.signal : pal.accent;
        c.lineWidth = 1.5;
        c.stroke();
      }
      text(c, x.text, lx + 10, y + rowH / 2, font.sans(Math.min(13, listW / 34), 450), dead || mine ? pal.ink3 : pal.ink, 'left', 'middle');
      if (dead || mine) {
        c.font = font.sans(Math.min(13, listW / 34), 450);
        const tw = c.measureText(x.text).width;
        c.fillStyle = dead ? pal.ink3 : AMBER;
        c.fillRect(lx + 10, y + rowH / 2, tw, 1);
      }
      if (phase === 'test') {
        bench.hit(lx, y + 2, listW - 34, rowH - 4, () => (sel = sel === i ? -1 : i));
        if (!track()) {
          text(c, '✕', lx + listW - 16, y + rowH / 2, font.mono(12, 500), mine ? AMBER : pal.ink3, 'center', 'middle');
          bench.hit(lx + listW - 32, y + 2, 32, rowH - 4, () => (struck.has(i) ? struck.delete(i) : struck.add(i)));
        }
      }
    });
    // The bench: entry, keypad, evidence.
    const px = wide ? lx + listW + 24 : W / 2 - 150;
    const py = wide ? top : top + rd.cands.length * rowH + 18;
    const pw = Math.min(300, W - 32);
    text(c, `TEST ${obs.length} / ${rd.budget}`, px, py + 10, font.mono(10, 600), pal.ink3);
    rr(c, px, py + 18, pw, 40, 6);
    c.fillStyle = pal.paper2;
    c.fill();
    c.strokeStyle = phase === 'test' ? alpha(pal.accent, 0.6) : pal.line;
    c.stroke();
    text(c, entry || (phase === 'test' ? 'type 10–99' : ''), px + 12, py + 39, entry ? font.mono(20, 600) : font.mono(12, 500), entry ? pal.ink : pal.ink3, 'left', 'middle');
    if (phase === 'test') {
      const kw = (pw - 4 * 6) / 5;
      '1234567890'.split('').forEach((d, i) => bench.button(c, px + (i % 5) * (kw + 6), py + 66 + Math.floor(i / 5) * 40, kw, 34, d, () => entry.length < 2 && (entry += d)));
      const bw = (pw - 12) / 3;
      bench.button(c, px, py + 150, bw, 38, '⌫', () => (entry = entry.slice(0, -1)));
      bench.button(c, px + bw + 6, py + 150, bw, 38, 'Test', test, { off: entry.length !== 2 || obs.length >= rd.budget, key: 'Enter' });
      bench.button(c, px + 2 * (bw + 6), py + 150, bw, 38, 'Commit', commit, { primary: true, off: sel < 0 });
    }
    // Evidence chips.
    const ey = py + (phase === 'test' ? 200 : 70);
    obs.forEach((o, i) => {
      const x = px + (i % 6) * 48;
      const y = ey + Math.floor(i / 6) * 32;
      rr(c, x, y, 42, 26, 5);
      c.fillStyle = o.yes ? alpha(pal.accent, 0.18) : pal.paper2;
      c.fill();
      c.strokeStyle = o.yes ? pal.accent : pal.line;
      c.stroke();
      text(c, `${o.n}${o.yes ? '✓' : '✗'}`, x + 21, y + 13, font.mono(11, 600), o.yes ? pal.accent : pal.ink2, 'center', 'middle');
    });
    roundStrip(c, W, stage.h - 8, res.map((r) => (r.pen === 0 ? '✓' : r.pen === 1 ? '✗' : '½')), ROUNDS, round);
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
