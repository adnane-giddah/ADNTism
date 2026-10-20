// 26 · QUANTITY SENSE — what share of the items are ●?
// Two kinds of item (filled discs ● and hollow squares □: shape and fill, never colour alone). Item sizes are
// set per group at random — and on Hard against the counts — so the share of *ink* is a poor shortcut for the
// share of *items*. You answer on a 0–100 % gauge. Score: absolute error in percentage points; the result
// also gives the relative error and tells you whether your answer sat closer to the area share or the count.
import { Controls } from '../core/controls';
import { circle, clamp, font, line, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { bar, glow, plate, slot, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 6;
export interface Item {
  x: number;
  y: number;
  s: number; // radius / half-side (u)
  kind: 0 | 1; // 0 = ●, 1 = □
}
export interface QuantityRound {
  items: Item[];
  a: number; // count of ●
  b: number; // count of □
  share: number; // a / (a + b)
  area: number; // ●'s share of the total area
  mixed: boolean;
}

export function makeQuantity(seed: number, level: Level): QuantityRound[] {
  const r = rng(seed);
  const [lo, hi] = level === 'easy' ? [10, 30] : level === 'medium' ? [20, 60] : [40, 110];
  const out: QuantityRound[] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 500) {
    const total = r.int(lo, hi);
    // Shares away from the trivial 50%, spread across the range.
    const share = r.range(0.15, 0.85);
    const a = Math.max(2, Math.round(total * share));
    const b = total - a;
    if (b < 2 || Math.abs(a / total - 0.5) < 0.06) continue;
    // Sizes: independent per group; on Hard, the bigger group gets the smaller items.
    let sa = r.range(1.2, 2.6);
    let sb = r.range(1.2, 2.6);
    if (level === 'hard') {
      const big = r.range(2.2, 2.8);
      const small = r.range(1.1, 1.5);
      [sa, sb] = a > b ? [small, big] : [big, small];
    }
    const mixed = level !== 'easy';
    const items: Item[] = [];
    const place = (kind: 0 | 1, n: number, s0: number) => {
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 400; t++) {
          const s = s0 * r.range(0.85, 1.15);
          const x = mixed ? r.range(-44, 44) : kind === 0 ? r.range(-44, -4) : r.range(4, 44);
          const y = r.range(-40, 40);
          if (items.some((q) => Math.hypot(q.x - x, q.y - y) < q.s + s + 1.2)) continue;
          items.push({ x, y, s, kind });
          break;
        }
      }
    };
    place(0, a, sa);
    place(1, b, sb);
    const ca = items.filter((i) => i.kind === 0).length;
    const cb = items.length - ca;
    if (ca !== a || cb !== b) continue;
    // Disc area π s², square area 4 s².
    const areaA = items.filter((i) => i.kind === 0).reduce((s, i) => s + Math.PI * i.s * i.s, 0);
    const areaB = items.filter((i) => i.kind === 1).reduce((s, i) => s + 4 * i.s * i.s, 0);
    out.push({ items, a, b, share: a / (a + b), area: areaA / (areaA + areaB), mixed });
  }
  return out;
}

export function quantityErrors(est: number, rd: QuantityRound) {
  return {
    abs: Math.abs(est - rd.share) * 100, // percentage points
    rel: (Math.abs(est - rd.share) / rd.share) * 100, // % of the true share
    signed: (est - rd.share) * 100,
    byArea: Math.abs(est - rd.area) < Math.abs(est - rd.share),
  };
}

const EXPOSE: Record<Level, number> = { easy: 2500, medium: 1500, hard: 900 };

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: QuantityRound[] = [];
  let round = 0;
  let phase: 'ready' | 'look' | 'answer' | 'reveal' | 'done' = 'ready';
  let phaseAt = 0;
  let timer = 0;
  let finTimer = 0;
  let answers: number[] = [];
  const statik = () => api.mode === 'static';
  const controls = new Controls(stage, () => lock());

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 70;
    const F = Math.max(160, Math.min(W - 32, H - top - 110, 560));
    return { k: F / 100, F, cx: W / 2, cy: top + F / 2, ctrlY: top + F + 8, cw: Math.min(W - 32, 480) };
  };

  function prompt() {
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt('What share of all the items are ● ?', statik() ? 'Static: the items stay while you answer' : `Press to look — you get ${(EXPOSE[api.level] / 1000).toFixed(1)} s`);
  }

  function reset(seed: number) {
    clearTimeout(timer);
    clearTimeout(finTimer);
    rounds = makeQuantity(seed, api.level);
    round = 0;
    answers = [];
    phase = 'ready';
    controls.set([]);
    prompt();
    stage.request();
  }

  function look() {
    phase = 'look';
    phaseAt = performance.now();
    clearTimeout(timer);
    if (statik()) return toAnswer();
    timer = window.setTimeout(toAnswer, EXPOSE[api.level]);
    stage.request();
  }

  function toAnswer() {
    phase = 'answer';
    const start = rng(round * 131 + 9).range(0.3, 0.7);
    controls.set([{ id: 'p', label: 'share of ●', lo: 0, hi: 1, value: start, speed: 0.25, readout: (v) => `${(v * 100).toFixed(0)}%` }]);
    controls.enabled = true;
    controls.lockLabel = 'Lock';
    api.prompt('Set the gauge: what share are ● ?', 'Drag (or ← →, Shift fine) · Lock');
    stage.request();
  }

  function lock() {
    if (phase !== 'answer') return;
    const rd = rounds[round];
    const est = controls.get('p').value;
    answers.push(est);
    const e = quantityErrors(est, rd);
    {
      const { cx, ctrlY, cw } = layout();
      api.judge(e.abs, { x: cx - cw / 2 + rd.share * cw, y: ctrlY - 30 });
    }
    phase = 'reveal';
    controls.enabled = false;
    api.sfx.release();
    api.prompt(
      `True share ${(rd.share * 100).toFixed(1)}% (${rd.a} ● of ${rd.a + rd.b}). You said ${(est * 100).toFixed(0)}%: ${e.abs.toFixed(1)} points off.`,
      `● covered ${(rd.area * 100).toFixed(0)}% of the ink — your answer was closer to the ${e.byArea ? 'ink (area) share' : 'count'}${round < ROUNDS - 1 ? ' · tap for the next' : ''}`,
    );
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    phase = 'ready';
    controls.set([]);
    prompt();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const errs = rounds.map((rd, i) => quantityErrors(answers[i], rd));
    const mean = errs.reduce((a, e) => a + e.abs, 0) / errs.length;
    const rel = errs.reduce((a, e) => a + e.rel, 0) / errs.length;
    const bias = errs.reduce((a, e) => a + e.signed, 0) / errs.length;
    const byArea = errs.filter((e) => e.byArea).length;
    const disp = mean.toFixed(1);
    const rows: [string, string][] = rounds.map((rd, i) => [`${i + 1} · ${rd.a} ● / ${rd.a + rd.b}`, `${(rd.share * 100).toFixed(1)}% → ${(answers[i] * 100).toFixed(0)}% (${errs[i].signed >= 0 ? '+' : '−'}${Math.abs(errs[i].signed).toFixed(1)} pts)`]);
    rows.push(['Relative error (mean)', `${rel.toFixed(1)}% of the true share`]);
    rows.push(['Absolute vs relative', 'absolute = points on the 0–100 % gauge; relative = that error ÷ the true share (harsher on small shares)']);
    rows.push(['Closer to the ink than the count', `${byArea} of ${ROUNDS} rounds`]);
    rows.push(['Bias', `${bias >= 0 ? '+' : '−'}${Math.abs(bias).toFixed(1)} pts — ${Math.abs(bias) < 2 ? 'centred' : bias > 0 ? 'you overestimate ●' : 'you underestimate ●'}`]);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'pts',
          label: 'mean absolute error (percentage points)',
          headline: `Off by ${disp} points on average${byArea >= ROUNDS / 2 ? ' — and you mostly followed the ink, not the count' : ''}.`,
          rows,
          perfect: disp === '0.0',
          near: mean < 2,
          share: [`QUANTITY SENSE · ${api.level} · ${api.mode} — share of ●`, `${disp} points off`],
        }),
      api.motion() ? 500 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'ready') look();
    else if (phase === 'reveal') next();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const onVis = () => {
    if (document.hidden && phase === 'look') {
      clearTimeout(timer);
      api.voidRun('Attempt voided — the tab was hidden while the items were showing.');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.repeat || e.defaultPrevented) return;
      if (e.key !== 'Enter' && e.code !== 'Space') return;
      if (phase === 'ready') {
        e.preventDefault();
        look();
      } else if (phase === 'reveal') {
        e.preventDefault();
        next();
      }
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const { k, F, cx, cy, ctrlY, cw } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    let more = controls.tick(now);
    // A plain plate (the items themselves stay flat: their ink area is part of the test).
    plate(c, cx - F / 2, cy - F / 2, F, F, 14);
    const visible = phase === 'look' || phase === 'reveal' || phase === 'done' || (phase === 'answer' && statik());
    if (visible) {
      for (const it of rd.items) {
        if (it.kind === 0) circle(c, X(it.x), Y(it.y), it.s * k, undefined, pal.ink);
        else {
          c.strokeStyle = pal.ink;
          c.lineWidth = Math.max(1.25, it.s * k * 0.28);
          c.strokeRect(X(it.x - it.s) + 0.75, Y(it.y - it.s) + 0.75, 2 * it.s * k - 1.5, 2 * it.s * k - 1.5);
        }
      }
      if (!rd.mixed) line(c, X(0), Y(-46), X(0), Y(46), pal.line, 1, [3, 4]);
    }
    if (phase === 'look' && !statik()) {
      const left = 1 - (now - phaseAt) / EXPOSE[api.level];
      slot(c, cx - F / 2, cy + F / 2 + 10, cx + F / 2, cy + F / 2 + 10, 6);
      bar(c, cx - F / 2, cy + F / 2 + 7.5, F * clamp(left, 0, 1), 5, pal.accent, 2.5);
      more = true;
    }
    if (phase === 'answer') controls.draw(c, cx - cw / 2, ctrlY, cw);
    if (phase === 'reveal' || phase === 'done') {
      // Count, area and your answer on one 0–100 % bar.
      const L = cx - cw / 2;
      const R = cx + cw / 2;
      const y = ctrlY + 26;
      slot(c, L, y, R, y, 6);
      for (let p = 0; p <= 10; p++) line(c, L + (p / 10) * (R - L), y - (p % 5 ? 3 : 6), L + (p / 10) * (R - L), y + (p % 5 ? 3 : 6), pal.ink3, 1);
      // Each value is a pin with a round head.
      const mark = (v: number, label: string, color: string, dy: number) => {
        const x = L + v * (R - L);
        line(c, x, y - 12, x, y + 12, color, 2.5);
        softShadow(c, x, y + 14, 6, 2, 1.1);
        sphere(c, x, y - 12, 4.5, color);
        tag(c, label, x, y + dy, color, 10);
      };
      glow(c, L + rd.share * (R - L), y - 12, 26, pal.accent, 0.7);
      mark(rd.share, `count ${(rd.share * 100).toFixed(1)}%`, pal.accent, -22);
      mark(rd.area, `ink ${(rd.area * 100).toFixed(0)}%`, pal.ink3, 24);
      mark(answers[round], `you ${(answers[round] * 100).toFixed(0)}%`, pal.ink, 42);
    }
    if (phase === 'ready') text(c, 'press to look', cx, cy, font.mono(12, 500), pal.ink2, 'center', 'middle');
    const sy = stage.h - 8;
    for (let i = 0; i < ROUNDS; i++) text(c, i < answers.length ? quantityErrors(answers[i], rounds[i]).abs.toFixed(1) : i === round ? '•' : '·', stage.w / 2 + (i - 2.5) * 46, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(timer);
      clearTimeout(finTimer);
      controls.destroy();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
