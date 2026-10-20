// 24 · RULE HUNTER — infer the hidden rule from three states, then build the next one.
// Every puzzle is checked for ambiguity: among all candidate rules of the level, every rule that explains
// S₀ → S₁ → S₂ must predict the same S₃. Otherwise the puzzle is discarded. Score: the share of cells you got
// wrong (lower is better). The reveal names the rule and shows how it turns S₂ into S₃.
import { Controls } from '../core/controls';
import { clamp, font, line, pal, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { alpha, bar, glow, plate, rr } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

export type Grid = number[][];
export interface Rule {
  id: string;
  name: string;
  why: string;
  /** Number of values a cell can take for this rule (2 = on/off, 3 = three shades). */
  values: 2 | 3;
  f: (g: Grid) => Grid;
}

const N = (g: Grid) => g.length;
const map = (g: Grid, fn: (v: number, r: number, c: number) => number) => g.map((row, r) => row.map((v, c) => fn(v, r, c)));
const at = (g: Grid, r: number, c: number) => g[((r % N(g)) + N(g)) % N(g)][((c % N(g)) + N(g)) % N(g)];
const inside = (g: Grid, r: number, c: number) => (r >= 0 && c >= 0 && r < N(g) && c < N(g) ? g[r][c] : 0);

export const RULES: Record<string, Rule> = {
  rot90: { id: 'rot90', name: 'Rotate 90° clockwise', why: 'The whole grid turns a quarter turn clockwise each step.', values: 3, f: (g) => map(g, (_, r, c) => g[N(g) - 1 - c][r]) },
  rot180: { id: 'rot180', name: 'Rotate 180°', why: 'The whole grid turns upside down each step.', values: 3, f: (g) => map(g, (_, r, c) => g[N(g) - 1 - r][N(g) - 1 - c]) },
  flipH: { id: 'flipH', name: 'Mirror left ↔ right', why: 'Each row is reversed: a reflection in the vertical axis.', values: 3, f: (g) => map(g, (_, r, c) => g[r][N(g) - 1 - c]) },
  flipV: { id: 'flipV', name: 'Mirror top ↔ bottom', why: 'Rows swap top for bottom: a reflection in the horizontal axis.', values: 3, f: (g) => map(g, (_, r, c) => g[N(g) - 1 - r][c]) },
  transpose: { id: 'transpose', name: 'Reflect in the diagonal', why: 'Rows become columns: cell (r, c) moves to (c, r).', values: 3, f: (g) => map(g, (_, r, c) => g[c][r]) },
  shiftR: { id: 'shiftR', name: 'Shift right, wrapping', why: 'Everything moves one cell right; the last column re-enters on the left (modular position).', values: 3, f: (g) => map(g, (_, r, c) => at(g, r, c - 1)) },
  shiftD: { id: 'shiftD', name: 'Shift down, wrapping', why: 'Everything moves one cell down; the bottom row re-enters at the top.', values: 3, f: (g) => map(g, (_, r, c) => at(g, r - 1, c)) },
  invert: { id: 'invert', name: 'Invert', why: 'Every filled cell empties and every empty cell fills.', values: 2, f: (g) => map(g, (v) => 1 - v) },
  inc3: { id: 'inc3', name: 'Add one, modulo 3', why: 'Each cell steps empty → grey → black → empty: value + 1 (mod 3).', values: 3, f: (g) => map(g, (v) => (v + 1) % 3) },
  oddCols: { id: 'oddCols', name: 'Invert every second column', why: 'Only columns 2, 4, 6… flip; the others stay — a conditional rule.', values: 2, f: (g) => map(g, (v, _, c) => (c % 2 === 1 ? 1 - v : v)) },
  grow: { id: 'grow', name: 'Grow into neighbours', why: 'A cell fills if it or any of its four neighbours was filled (no wrap at the edges).', values: 2, f: (g) => map(g, (v, r, c) => (v || inside(g, r - 1, c) || inside(g, r + 1, c) || inside(g, r, c - 1) || inside(g, r, c + 1) ? 1 : 0)) },
  gravity: {
    id: 'gravity',
    name: 'Gravity',
    why: 'In every column the filled cells fall to the bottom, keeping their count.',
    values: 2,
    f: (g) => {
      const n = N(g);
      const out = g.map((row) => row.map(() => 0));
      for (let c = 0; c < n; c++) {
        // Filled cells drop to the bottom in order, keeping their values.
        const filled = g.map((row) => row[c]).filter((v) => v !== 0);
        filled.forEach((v, i) => (out[n - filled.length + i][c] = v));
      }
      return out;
    },
  },
  life: {
    id: 'life',
    name: 'Game of Life',
    why: 'A cellular automaton on a wrapping grid: a filled cell survives with 2 or 3 filled neighbours (of 8); an empty cell fills with exactly 3.',
    values: 2,
    f: (g) =>
      map(g, (v, r, c) => {
        let s = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) s += at(g, r + dr, c + dc);
        return s === 3 || (v && s === 2) ? 1 : 0;
      }),
  },
  xorLR: { id: 'xorLR', name: 'Left XOR right', why: 'Each cell becomes filled exactly when one — not both — of its left and right neighbours was filled (wrapping).', values: 2, f: (g) => map(g, (_, r, c) => at(g, r, c - 1) ^ at(g, r, c + 1)) },
};

const combo = (a: Rule, b: Rule): Rule => ({
  id: `${a.id}+${b.id}`,
  name: `${a.name}, then ${b.name.toLowerCase()}`,
  why: `Two rules applied in order: ${a.why} Then: ${b.why}`,
  values: (Math.min(a.values, b.values) as 2 | 3),
  f: (g) => b.f(a.f(g)),
});

export function family(level: Level): Rule[] {
  const R = RULES;
  const easy = [R.rot90, R.rot180, R.flipH, R.flipV, R.shiftR, R.shiftD, R.invert];
  if (level === 'easy') return easy;
  const med = [...easy, R.transpose, R.inc3, R.oddCols, R.grow, R.gravity, combo(R.rot90, R.invert), combo(R.shiftR, R.flipV), combo(R.flipH, R.shiftD)];
  if (level === 'medium') return med;
  return [...med, R.life, R.xorLR, combo(R.shiftR, R.invert), combo(R.rot90, R.shiftD), combo(R.gravity, R.flipH)];
}

const same = (a: Grid, b: Grid) => a.every((row, r) => row.every((v, c) => v === b[r][c]));

export interface RulePuzzle {
  rule: Rule;
  states: Grid[]; // S0, S1, S2
  answer: Grid; // S3
  values: 2 | 3;
}

function randomGrid(r: Rng, n: number, values: 2 | 3, density: number): Grid {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => (r.next() < density ? (values === 3 ? r.int(1, 2) : 1) : 0)));
}

/** A puzzle with exactly one consistent prediction among the level's candidate rules. */
export function makeRulePuzzle(r: Rng, level: Level, rule: Rule): RulePuzzle | null {
  const n = level === 'easy' ? 5 : level === 'medium' ? 6 : 7;
  const fam = family(level);
  for (let tries = 0; tries < 300; tries++) {
    const values = rule.values === 3 && rule.id.includes('inc3') ? 3 : 2;
    const S0 = randomGrid(r, n, values, rule.id === 'grow' ? 0.12 : rule.id === 'life' ? 0.32 : 0.38);
    const S1 = rule.f(S0);
    const S2 = rule.f(S1);
    const S3 = rule.f(S2);
    if (same(S0, S1) || same(S1, S2) || same(S2, S3)) continue;
    const filled = S3.flat().filter((v) => v).length;
    if (filled < 2 || filled > n * n - 2) continue;
    // Ambiguity check: every candidate that explains both shown steps must give the same next state.
    const fits = fam.filter((c) => (values === 3 ? c.values === 3 : true)).filter((c) => same(c.f(S0), S1) && same(c.f(S1), S2));
    if (!fits.every((c) => same(c.f(S2), S3))) continue;
    return { rule, states: [S0, S1, S2], answer: S3, values };
  }
  return null;
}

export function makeRules(seed: number, level: Level): RulePuzzle[] {
  const r = rng(seed);
  const fam = family(level);
  const out: RulePuzzle[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < 4 && guard++ < 200) {
    const rule = r.pick(fam);
    if (used.has(rule.id)) continue;
    const p = makeRulePuzzle(r, level, rule);
    if (!p) continue;
    used.add(rule.id);
    out.push(p);
  }
  return out;
}

/** Share of cells that differ (%). */
export const gridError = (a: Grid, b: Grid) => (a.flat().reduce((s, v, i) => s + (v === b.flat()[i] ? 0 : 1), 0) / a.flat().length) * 100;

const factory: GameFactory = (api) => {
  const { stage } = api;
  let puzzles: RulePuzzle[] = [];
  let round = 0;
  let mine: Grid = [];
  let cursor = { r: 0, c: 0 };
  let kbd = false;
  let phase: 'build' | 'reveal' | 'done' = 'build';
  let results: number[] = [];
  let finTimer = 0;
  const controls = new Controls(stage, () => submit());

  const geom = () => {
    const W = stage.w;
    const H = stage.h;
    const p = puzzles[round];
    const n = p ? p.states[0].length : 5;
    const top = 74;
    const wide = W > H * 1.1;
    // Three small example grids and one big editable grid.
    const small = Math.max(8, Math.min(wide ? (W - 80) / (3 * n + 2 * n * 1.6 + 6) : (W - 60) / (3 * n + 4), 26));
    const big = Math.max(18, Math.min(wide ? small * 1.6 : (W - 40) / n, (H - top - 150 - (wide ? 0 : small * n + 40)) / n, 54));
    const exW = 3 * n * small + 2 * 28;
    if (wide) {
      const total = exW + 40 + n * big;
      const x0 = W / 2 - total / 2;
      return { n, small, big, ex: { x: x0, y: top + 30 }, ed: { x: x0 + exW + 40, y: top + 30 }, ctrlY: top + 40 + n * big + 10 };
    }
    return { n, small, big, ex: { x: W / 2 - exW / 2, y: top + 24 }, ed: { x: W / 2 - (n * big) / 2, y: top + 54 + n * small }, ctrlY: top + 64 + n * small + n * big + 6 };
  };

  function setRound() {
    const p = puzzles[round];
    mine = p.states[2].map((row) => row.map(() => 0));
    cursor = { r: 0, c: 0 };
    phase = 'build';
    controls.set([]);
    controls.enabled = true;
    controls.touched = true;
    controls.lockLabel = 'Submit';
    api.progress(`${round + 1} / ${puzzles.length}`);
    api.prompt(
      'What comes next? Build S₃.',
      `Tap cells to cycle ${p.values === 3 ? 'empty → grey → black' : 'empty ↔ filled'} · C copies S₂ as a start · arrows + Space for keys · Submit (Enter)`,
    );
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    puzzles = makeRules(seed, api.level);
    round = 0;
    results = [];
    kbd = false;
    setRound();
    stage.request();
  }

  function submit() {
    if (phase !== 'build') return;
    const p = puzzles[round];
    const e = gridError(mine, p.answer);
    const g = geom();
    api.judge(e, { x: g.ed.x + (g.n * g.big) / 2, y: g.ed.y + (g.n * g.big) / 2 });
    results.push(e);
    phase = 'reveal';
    controls.enabled = false;
    api.sfx[e === 0 ? 'near' : 'release']();
    api.prompt(`${e === 0 ? 'Exactly right.' : `${e.toFixed(0)}% of cells wrong.`} The rule: ${p.rule.name}.`, `${p.rule.why}${round < puzzles.length - 1 ? ' · tap for the next' : ''}`);
    if (round === puzzles.length - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= puzzles.length - 1) return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    const disp = mean.toFixed(1);
    const solved = results.filter((e) => e === 0).length;
    const rows: [string, string][] = puzzles.map((p, i) => [`${i + 1} · ${p.rule.name}`, results[i] === 0 ? 'solved' : `${results[i].toFixed(0)}% cells wrong`]);
    rows.push(['Rules found exactly', `${solved} of ${puzzles.length}`]);
    rows.push(['Fairness', 'every puzzle is checked: all candidate rules that fit S₀→S₁→S₂ predict the same S₃']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '%',
          label: 'cells wrong',
          headline: solved === puzzles.length ? `All ${puzzles.length} rules found, every cell right.` : `${solved} of ${puzzles.length} rules found exactly; ${disp}% of cells wrong on average.`,
          rows,
          perfect: disp === '0.0',
          near: mean < 3,
          share: [`RULE HUNTER · ${api.level} — infer the hidden rule`, `${solved}/${puzzles.length} exact`],
        }),
      api.motion() ? 600 : 0,
    );
  }

  const cellAt = (x: number, y: number) => {
    const g = geom();
    const c = Math.floor((x - g.ed.x) / g.big);
    const r = Math.floor((y - g.ed.y) / g.big);
    return r >= 0 && c >= 0 && r < g.n && c < g.n ? { r, c } : null;
  };
  const cycle = (r: number, c: number) => {
    const p = puzzles[round];
    mine[r][c] = (mine[r][c] + 1) % p.values;
    api.sfx.soft();
    stage.request();
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') return next();
    if (phase !== 'build') return;
    const p = stage.pt(e);
    const cell = cellAt(p.x, p.y);
    if (cell) {
      kbd = false;
      cycle(cell.r, cell.c);
    }
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.defaultPrevented) return;
      if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        return next();
      }
      if (phase !== 'build') return;
      const n = puzzles[round].states[0].length;
      const mv: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (mv[e.key]) {
        e.preventDefault();
        kbd = true;
        cursor = { r: clamp(cursor.r + mv[e.key][0], 0, n - 1), c: clamp(cursor.c + mv[e.key][1], 0, n - 1) };
        stage.request();
      } else if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        kbd = true;
        cycle(cursor.r, cursor.c);
      } else if ((e.key === 'c' || e.key === 'C') && !e.repeat) {
        mine = puzzles[round].states[2].map((row) => row.slice());
        api.sfx.step();
        stage.request();
      }
    }),
  ];

  function grid(c: CanvasRenderingContext2D, g: Grid, x: number, y: number, s: number, values: number, opts: { wrong?: Grid; cursor?: { r: number; c: number }; lit?: boolean } = {}) {
    const n = g.length;
    // A board of rounded tiles: shaded when filled, faint when empty.
    plate(c, x - 5, y - 5, n * s + 10, n * s + 10, Math.min(10, s / 2));
    const rad = Math.min(4, s / 5);
    g.forEach((row, r) =>
      row.forEach((v, cc) => {
        const tx = x + cc * s + 1.5;
        const ty = y + r * s + 1.5;
        if (v) {
          const col = opts.lit ? (values === 3 && v === 1 ? alpha(pal.accent, 0.45) : pal.accent) : values === 3 && v === 1 ? pal.ink3 : pal.ink;
          if (opts.lit && !(values === 3 && v === 1)) {
            c.save();
            c.shadowColor = alpha(pal.accent, 0.5);
            c.shadowBlur = 10;
            bar(c, tx, ty, s - 3, s - 3, col, rad);
            c.restore();
          } else bar(c, tx, ty, s - 3, s - 3, col, rad);
        }
        else {
          rr(c, tx, ty, s - 3, s - 3, rad);
          c.fillStyle = pal.line2;
          c.fill();
        }
        if (opts.wrong && opts.wrong[r][cc] !== v) {
          // A cross marks a wrong cell — shape, not colour.
          line(c, x + cc * s + 3, y + r * s + 3, x + cc * s + s - 3, y + r * s + s - 3, pal.signal, 2);
          line(c, x + cc * s + s - 3, y + r * s + 3, x + cc * s + 3, y + r * s + s - 3, pal.signal, 2);
        }
      }),
    );
    if (opts.cursor) {
      glow(c, x + opts.cursor.c * s + s / 2, y + opts.cursor.r * s + s / 2, s, pal.accent, 0.7);
      rr(c, x + opts.cursor.c * s + 1, y + opts.cursor.r * s + 1, s - 2, s - 2, rad + 1);
      c.strokeStyle = pal.accent;
      c.lineWidth = 2.5;
      c.stroke();
    }
  }

  stage.draw = () => {
    const c = stage.ctx;
    const p = puzzles[round];
    if (!p) return false;
    const g = geom();
    p.states.forEach((s, i) => {
      const x = g.ex.x + i * (g.n * g.small + 28);
      grid(c, s, x, g.ex.y, g.small, p.values);
      text(c, `S${'₀₁₂'[i]}`, x, g.ex.y - 8, font.mono(11, 500), pal.ink2, 'left');
      if (i < 2) text(c, '→', x + g.n * g.small + 14, g.ex.y + (g.n * g.small) / 2, font.mono(16), pal.ink3, 'center', 'middle');
    });
    text(c, phase === 'build' ? 'S₃ — yours' : 'S₃ — yours, ✕ = wrong', g.ed.x, g.ed.y - 8, font.mono(11, 500), pal.ink, 'left');
    grid(c, mine, g.ed.x, g.ed.y, g.big, p.values, { wrong: phase !== 'build' ? p.answer : undefined, cursor: phase === 'build' && kbd ? cursor : undefined, lit: true });
    if (phase !== 'build') {
      // The true S3 beside your answer, small.
      const tx = g.ed.x + g.n * g.big + 18;
      if (tx + g.n * g.small < stage.w - 8) {
        grid(c, p.answer, tx, g.ed.y, g.small, p.values);
        text(c, 'true S₃', tx, g.ed.y - 8, font.mono(11, 500), pal.ink2, 'left');
      }
      if (round < puzzles.length - 1) text(c, 'tap for the next ▸', stage.w / 2, g.ctrlY + 22, font.mono(11, 500), pal.ink2, 'center');
    } else controls.draw(c, stage.w / 2 - 90, g.ctrlY, 180);
    const sy = stage.h - 10;
    for (let i = 0; i < puzzles.length; i++) text(c, i < results.length ? results[i].toFixed(0) + '%' : i === round ? '•' : '·', stage.w / 2 + (i - 1.5) * 56, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    return false;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      controls.destroy();
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
