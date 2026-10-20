// 50 · REGIME — learn a rule, then notice when it stops being true.
// Each symbol has a colour (cyan / amber) and a shape (circle / square); you answer ← or →. A hidden rule
// maps the four symbols to the two answers, and the rule changes at change points fixed before the block
// starts (segment lengths are drawn afresh each block, so the timing cannot be memorised). Symbols are
// dealt in shuffled groups of four, so every segment contains the symbols on which old and new rules
// disagree. In noisy blocks the feedback is wrong on a stated share of trials; your score always uses the
// true rule, never the noisy feedback.
// Scoring separates adaptation from slips: after each change, the delay is the number of trials until your
// first three correct answers in a row; errors outside those adaptation windows (once the first rule is
// learned) are counted as unnecessary switches. Penalty = 0.55 × delay part + 0.45 × slip part.
import { clamp, font, pal, text } from '../core/draw';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip, shuffle } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

/** Response (0 = ←, 1 = →) for each symbol index c·2 + s (c: 0 cyan / 1 amber, s: 0 circle / 1 square). */
export type Rule = { map: number[]; name: string };
export interface Segment {
  rule: Rule;
  len: number;
}
export interface RegimeRound {
  kind: 'mapping' | 'feature' | 'reversal' | 'noisy' | 'multi';
  segs: Segment[];
  stims: number[];
  /** Feedback is flipped on these trials (noisy blocks). */
  lies: boolean[];
  lieRate: number;
}

const SYM = ['cyan circle', 'cyan square', 'amber circle', 'amber square'];
const colourRule = (p: number): Rule => ({ map: [0, 1, 2, 3].map((i) => ((i >> 1) ^ p) & 1), name: p ? 'amber → ←, cyan → →' : 'cyan → ←, amber → →' });
const shapeRule = (p: number): Rule => ({ map: [0, 1, 2, 3].map((i) => ((i & 1) ^ p) & 1), name: p ? 'square → ←, circle → →' : 'circle → ←, square → →' });
const reverse = (r: Rule): Rule => ({ map: r.map.map((v) => 1 - v), name: `reversed: ${r.name}` });
/** The three ways to split four symbols two-and-two (colour, shape, and the diagonal pairing). */
const PARTS = [
  [0, 0, 1, 1],
  [0, 1, 0, 1],
  [0, 1, 1, 0],
];
const mapping = (k: number, flip: number): Rule => ({ map: PARTS[k].map((v) => v ^ flip), name: `pairs ${PARTS[k].map((v, i) => (v ^ flip ? '' : SYM[i])).filter(Boolean).join(' + ')} → ←` });

const sameRule = (a: Rule, b: Rule) => a.map.join() === b.map.join();

function stimsFor(r: Rng, segs: Segment[]) {
  const out: number[] = [];
  for (const s of segs) {
    const seg: number[] = [];
    while (seg.length < s.len) seg.push(...shuffle([0, 1, 2, 3], r.next));
    out.push(...seg.slice(0, s.len));
  }
  return out;
}

const segLen = (r: Rng, band: Band, first = false) => r.int(first ? 9 : 8, first ? [15, 14, 13, 12][band] : [13, 12, 11, 10][band]);

function make(r: Rng, kind: RegimeRound['kind'], segs: Segment[], lieRate = 0): RegimeRound | null {
  for (let i = 1; i < segs.length; i++) if (sameRule(segs[i].rule, segs[i - 1].rule)) return null;
  const stims = stimsFor(r, segs);
  const lies = stims.map(() => r.next() < lieRate);
  // Evidence: every segment after a change contains at least three trials where old and new rules disagree.
  let at = segs[0].len;
  for (let i = 1; i < segs.length; i++) {
    const dis = stims.slice(at, at + segs[i].len).filter((s) => segs[i].rule.map[s] !== segs[i - 1].rule.map[s]).length;
    if (dis < 3) return null;
    at += segs[i].len;
  }
  return { kind, segs, stims, lies, lieRate };
}

function genMapping(r: Rng, band: Band) {
  const k1 = r.int(0, 2);
  const k2 = (k1 + r.int(1, 2)) % 3;
  return make(r, 'mapping', [
    { rule: mapping(k1, r.int(0, 1)), len: segLen(r, band, true) },
    { rule: mapping(k2, r.int(0, 1)), len: segLen(r, band) + 4 },
  ]);
}
function genFeature(r: Rng, band: Band) {
  const c = r.next() < 0.5;
  const a = c ? colourRule(r.int(0, 1)) : shapeRule(r.int(0, 1));
  const b = c ? shapeRule(r.int(0, 1)) : colourRule(r.int(0, 1));
  return make(r, 'feature', [
    { rule: a, len: segLen(r, band, true) + (band === 0 ? 3 : 0) },
    { rule: b, len: segLen(r, band) + 4 },
  ]);
}
function genReversal(r: Rng, band: Band) {
  const a = r.next() < 0.5 ? colourRule(r.int(0, 1)) : shapeRule(r.int(0, 1));
  return make(r, 'reversal', [
    { rule: a, len: segLen(r, band, true) },
    { rule: reverse(a), len: segLen(r, band) + 4 },
  ]);
}
function genNoisy(r: Rng, band: Band) {
  const a = r.next() < 0.5 ? colourRule(r.int(0, 1)) : shapeRule(r.int(0, 1));
  const b = r.next() < 0.5 ? reverse(a) : a.name.startsWith('cyan') || a.name.startsWith('amber') ? shapeRule(r.int(0, 1)) : colourRule(r.int(0, 1));
  return make(
    r,
    'noisy',
    [
      { rule: a, len: segLen(r, band, true) + 3 },
      { rule: b, len: segLen(r, band) + 6 },
    ],
    [0.12, 0.15, 0.18, 0.2][band],
  );
}
function genMulti(r: Rng, band: Band) {
  const n = band >= 3 ? 5 : band === 2 ? 4 : 3;
  const segs: Segment[] = [];
  let cur: Rule = r.next() < 0.5 ? colourRule(r.int(0, 1)) : shapeRule(r.int(0, 1));
  for (let i = 0; i < n; i++) {
    segs.push({ rule: cur, len: segLen(r, band, i === 0) });
    const t = r.int(0, 2);
    cur = t === 0 ? reverse(cur) : t === 1 ? (cur.name.includes('cyan') ? shapeRule(r.int(0, 1)) : colourRule(r.int(0, 1))) : mapping(2, r.int(0, 1));
  }
  return make(r, 'multi', segs);
}

const lens = (rd: RegimeRound) => rd.segs.map((s) => s.len).join('-');
export const FAMILIES: Family<RegimeRound>[] = [
  { id: 'feature', name: 'Feature switch', teach: 'Answer ← or → for each symbol; feedback tells you if you were right. The rule uses colour or shape — and it can change without warning.', bands: [0, 3], intro: true, gen: genFeature, sig: (rd) => `${rd.segs.map((s) => s.rule.name).join('>')}|${lens(rd)}` },
  { id: 'reversal', name: 'Reversal', teach: 'A rule that worked may flip to its exact opposite. One error is not proof; a run of errors is.', bands: [0, 3], gen: genReversal, sig: (rd) => `${rd.segs[0].rule.name}|${lens(rd)}` },
  { id: 'mapping', name: 'Mapping switch', teach: 'Here the four symbols are paired arbitrarily — learn which two go left. The pairing will change.', bands: [1, 3], gen: genMapping, sig: (rd) => `${rd.segs.map((s) => s.rule.map.join('')).join('>')}|${lens(rd)}` },
  { id: 'noisy', name: 'Noisy feedback', teach: 'Feedback lies on some trials (the share is shown). Do not abandon a rule over a single “wrong”.', bands: [1, 3], gen: genNoisy, sig: (rd) => `${rd.segs.map((s) => s.rule.name).join('>')}|${lens(rd)}` },
  { id: 'multi', name: 'Several changes', teach: 'More than one change in this block. Each time, re-learn the rule from the evidence.', bands: [1, 3], gen: genMulti, sig: (rd) => `${rd.segs.length}|${lens(rd)}` },
];

export const ROUNDS = 3;

/** Adaptation analysis of a block from the player's correctness per trial (true rule). */
export function analyse(rd: RegimeRound, ok: boolean[]) {
  const starts: number[] = [];
  let at = 0;
  for (const s of rd.segs) {
    starts.push(at);
    at += s.len;
  }
  const adaptedAt: number[] = [];
  const window = new Set<number>();
  starts.forEach((c, si) => {
    const end = c + rd.segs[si].len;
    let a = end;
    for (let t = c; t + 2 < end; t++)
      if (ok[t] && ok[t + 1] && ok[t + 2]) {
        a = t;
        break;
      }
    adaptedAt.push(a);
    for (let t = c; t < a; t++) window.add(t);
  });
  const delays = starts.slice(1).map((c, i) => adaptedAt[i + 1] - c);
  const stable = ok.map((_, t) => t).filter((t) => !window.has(t));
  const slips = stable.filter((t) => !ok[t]).length;
  const delayPart = delays.length ? delays.reduce((a, d) => a + clamp((d - 2) / 10, 0, 1), 0) / delays.length : 0;
  const slipRate = stable.length ? slips / stable.length : 0;
  return { starts, adaptedAt, delays, slips, stableN: stable.length, pen: clamp(0.55 * delayPart + 0.45 * Math.min(1, 2.5 * slipRate), 0, 1) };
}

export const truthOf = (rd: RegimeRound, t: number) => {
  let at = 0;
  for (const s of rd.segs) {
    if (t < at + s.len) return s.rule.map[rd.stims[t]];
    at += s.len;
  }
  return 0;
};

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<RegimeRound>(api, 'regime', FAMILIES, ROUNDS);
  let rd: RegimeRound;
  let phase: 'ready' | 'trial' | 'fb' | 'reveal' | 'done' = 'ready';
  let t = 0;
  let ok: boolean[] = [];
  let fb: { shownOk: boolean } | null = null;
  let res: ReturnType<typeof analyse> | null = null;

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    rd = sess.next().rd;
    phase = 'ready';
    t = 0;
    ok = [];
    fb = null;
    res = null;
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const n = rd.stims.length;
    api.prompt(
      `${n} symbols. Answer ← or → for each; find the rule and keep up with it.`,
      `${sess.teach ? sess.teach + ' · ' : ''}${rd.lieRate ? `Feedback is wrong on about ${Math.round(rd.lieRate * 100)}% of trials · ` : ''}Press Start`,
    );
    stage.request();
  }

  function start() {
    if (phase !== 'ready') return;
    phase = 'trial';
    api.prompt('', '');
    stage.request();
  }

  function answer(a: 0 | 1) {
    if (phase !== 'trial') return;
    const right = a === truthOf(rd, t);
    ok.push(right);
    const shown = rd.lies[t] ? !right : right;
    fb = { shownOk: shown };
    phase = 'fb';
    api.sfx[shown ? 'soft' : 'release']();
    stage.request();
    bench.later(() => {
      t++;
      fb = null;
      if (t >= rd.stims.length) finishBlock();
      else phase = 'trial';
      stage.request();
    }, 260);
  }

  function finishBlock() {
    res = analyse(rd, ok);
    const acc = ok.filter(Boolean).length / ok.length;
    const d = res.delays;
    phase = 'reveal';
    const main = `${Math.round(acc * 100)}% correct · adapted after ${d.length ? d.map((x) => `${x}`).join(', ') : '—'} trial${d.length === 1 && d[0] === 1 ? '' : 's'} · ${res.slips} slip${res.slips === 1 ? '' : 's'}.`;
    const sub = `${rd.segs.map((s, i) => `${i ? 'then ' : ''}${s.rule.name} (${s.len})`).join(', ')}. ${rd.lieRate ? 'A single “wrong” in a noisy block is weak evidence; three in a row is strong. ' : ''}One surprising error is not a change; a cluster of them is.`;
    sess.done(res.pen, `${Math.round(acc * 100)}% · delays ${d.join('/') || '—'} · ${res.slips} slips`, { x: stage.w / 2, y: 120 });
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next block'));
    api.ownKeys(false);
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per block (slow adaptation and unnecessary switches)', share: 'REGIME' });
      if (r) bench.finish(r);
    }
  }

  bench.onTap = (p) => {
    if (phase === 'reveal') return begin();
    if (phase === 'trial' && p.y > 140) answer(p.x < stage.w / 2 ? 0 : 1);
  };
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase === 'ready' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return start();
    }
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'f' || e.key === 'F') answer(0);
    else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') answer(1);
    else return;
    e.preventDefault();
  };

  function symbol(c: CanvasRenderingContext2D, s: number, x: number, y: number, R: number) {
    const col = s >> 1 ? AMBER : pal.accent;
    c.fillStyle = col;
    if (s & 1) {
      rr(c, x - R, y - R, 2 * R, 2 * R, 6);
      c.fill();
    } else {
      c.beginPath();
      c.arc(x, y, R, 0, Math.PI * 2);
      c.fill();
    }
  }

  stage.draw = () => {
    bench.frame();
    const c = stage.ctx;
    if (!rd) return false;
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const n = rd.stims.length;
    const cy = 130 + Math.min(130, (H - 330) / 2);
    if (phase === 'trial' || phase === 'fb') {
      const R = Math.min(56, H * 0.08);
      plate(c, W / 2 - R * 2, cy - R * 2, R * 4, R * 4, 10);
      symbol(c, rd.stims[t], W / 2, cy, R);
      if (fb) text(c, fb.shownOk ? '✓' : '✗', W / 2, cy + R * 2 + 26, font.mono(22, 700), fb.shownOk ? pal.accent : pal.signal, 'center', 'middle');
      bench.row(
        c,
        W / 2,
        cy + R * 2 + 52,
        Math.min(380, W - 32),
        [
          { label: '←', run: () => answer(0), o: { key: 'F / ←', px: 20 } },
          { label: '→', run: () => answer(1), o: { key: 'J / →', px: 20 } },
        ],
        64,
      );
      text(c, `${t + 1} / ${n}`, W / 2, cy - R * 2 - 14, font.mono(10, 500), pal.ink3, 'center');
    } else if (phase === 'ready') {
      [0, 1, 2, 3].forEach((s, i) => symbol(c, s, W / 2 - 120 + i * 80, cy, 22));
      text(c, 'colour: cyan or amber · shape: circle or square', W / 2, cy + 50, font.mono(11, 500), pal.ink3, 'center');
      bench.button(c, W / 2 - 70, cy + 80, 140, 44, 'Start', start, { primary: true, key: 'Space' });
    }
    // Timeline (after the block): correct up, errors down, change points, adaptation windows.
    if ((phase === 'reveal' || phase === 'done') && res) {
      const x0 = 30;
      const w = W - 60;
      const y0 = cy + 40;
      plate(c, x0 - 10, y0 - 70, w + 20, 130, 8);
      const X = (i: number) => x0 + (i / (n - 1)) * w;
      res.starts.forEach((s, i) => {
        if (i) {
          c.fillStyle = AMBER;
          c.fillRect(X(s) - 1, y0 - 60, 2, 110);
          text(c, `change`, X(s) + 4, y0 - 50, font.mono(9, 600), AMBER);
        }
        c.fillStyle = alpha(pal.signal, 0.08);
        c.fillRect(X(s), y0 - 60, Math.max(0, X(res!.adaptedAt[i]) - X(s)), 110);
      });
      ok.forEach((v, i) => {
        c.fillStyle = v ? pal.accent : pal.signal;
        c.fillRect(X(i) - 2, v ? y0 - 28 : y0 + 2, 4, 26);
        if (rd.lies[i]) {
          c.beginPath();
          c.arc(X(i), y0 + 40, 2, 0, Math.PI * 2);
          c.fillStyle = pal.ink3;
          c.fill();
        }
      });
      c.fillStyle = pal.line;
      c.fillRect(x0, y0, w, 1);
      text(c, 'correct ↑  error ↓  · shaded: adapting after a change' + (rd.lieRate ? ' · dot: feedback lied' : ''), x0, y0 + 56, font.mono(9, 500), pal.ink3);
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
