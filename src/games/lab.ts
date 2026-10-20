// Shared bench for the cognitive games 41–52: a per-game variation scheduler with a persistent
// recent-history window, a round session that adapts its difficulty band to the player, canvas sliders,
// and the common result card. Pure logic (chooseFamily, generate, pushHistory, nextBand) is testable
// without a canvas or storage.
import { clamp, font, pal, text } from '../core/draw';
import { alpha, knob, rr, slot } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import type { GameAPI, Level, Result } from '../core/types';
import { mean, shuffle, type Pt } from './kit';

type C = CanvasRenderingContext2D;

/** Difficulty band: 0 onboarding, 1 ordinary, 2 advanced, 3 mastery. */
export type Band = 0 | 1 | 2 | 3;

export interface Family<R> {
  id: string;
  /** Short name, shown on the stage and in the result. */
  name: string;
  /** One line taught the first time this family appears on this device. */
  teach: string;
  /** Lowest and highest band at which the family is offered. */
  bands: [Band, Band];
  /** The family that opens a first session (the playable tutorial). */
  intro?: boolean;
  /** Build one challenge, already validated, or null when this draw is invalid (the caller draws again). */
  gen: (r: Rng, band: Band) => R | null;
  /** Gameplay identity: two challenges with the same signature are the same puzzle. */
  sig: (rd: R) => string;
}

export interface History {
  /** Recent family ids, oldest first. */
  v: string[];
  /** Recent configuration signatures, oldest first. */
  s: string[];
}

const KEEP_V = 30;
const KEEP_S = 80;
/** Window over which a family's frequency is counted. */
const WINDOW = 12;

export const emptyHistory = (): History => ({ v: [], s: [] });

export function loadHistory(game: string): History {
  try {
    const v = JSON.parse(localStorage.getItem('eps:var:' + game) || 'null');
    if (v && Array.isArray(v.v) && Array.isArray(v.s)) return { v: v.v.filter((x: unknown) => typeof x === 'string'), s: v.s.filter((x: unknown) => typeof x === 'string') };
  } catch {
    /* corrupt or blocked: start a fresh history */
  }
  return emptyHistory();
}

export function saveHistory(game: string, h: History) {
  try {
    localStorage.setItem('eps:var:' + game, JSON.stringify(h));
  } catch {
    /* storage full or blocked: variety still works within the session */
  }
}

export function pushHistory(h: History, id: string, sig: string): History {
  return { v: [...h.v, id].slice(-KEEP_V), s: [...h.s, `${id}:${sig}`].slice(-KEEP_S) };
}

const eligible = <R>(fams: Family<R>[], band: Band) => {
  const el = fams.filter((f) => band >= f.bands[0] && band <= f.bands[1]);
  return el.length ? el : fams;
};

/**
 * Pick the next family: never the one just played (when there is another), then the least frequent in
 * the recent window, then the least recent, with seeded randomness among the better half so that the
 * order itself is not predictable.
 */
export function chooseFamily<R>(fams: Family<R>[], band: Band, h: History, r: Rng): Family<R> {
  let el = eligible(fams, band);
  const last = h.v[h.v.length - 1];
  if (el.length > 1) el = el.filter((f) => f.id !== last);
  const win = h.v.slice(-WINDOW);
  const freq = (id: string) => win.reduce((n, x) => n + (x === id ? 1 : 0), 0);
  const ago = (id: string) => {
    const i = h.v.lastIndexOf(id);
    return i < 0 ? 1e9 : h.v.length - i;
  };
  const ranked = shuffle([...el], r.next).sort((a, b) => freq(a.id) - freq(b.id) || ago(b.id) - ago(a.id));
  const minF = freq(ranked[0].id);
  const best = ranked.filter((f) => freq(f.id) === minF);
  const pool = best.slice(0, Math.max(1, Math.ceil(best.length / 2) + (best.length > 2 ? 1 : 0)));
  return pool[Math.floor(r.next() * pool.length)];
}

/**
 * Generate a challenge of a family, avoiding recently seen configurations. Bounded: a fixed number of
 * draws at the asked band, then the same at easier bands; a family whose generator cannot produce
 * anything is a bug and throws (the tests sweep every family over many seeds).
 */
export function generate<R>(fam: Family<R>, band: Band, h: History, r: Rng, tries = 40): { rd: R; sig: string; band: Band } {
  let fallback: { rd: R; sig: string; band: Band } | null = null;
  for (let b = clamp(band, fam.bands[0], fam.bands[1]); b >= fam.bands[0]; b--) {
    for (let i = 0; i < tries; i++) {
      const rd = fam.gen(r, b as Band);
      if (rd == null) continue;
      const sig = fam.sig(rd);
      if (!h.s.includes(`${fam.id}:${sig}`)) return { rd, sig, band: b as Band };
      fallback ??= { rd, sig, band: b as Band };
    }
    if (fallback) return fallback;
  }
  throw new Error(`${fam.id}: no valid challenge at band ${band}`);
}

// Shifted up: Easy reaches advanced rounds, Medium lives at advanced/mastery, Hard is mastery throughout.
export const LEVEL_BANDS: Record<Level, [Band, Band]> = { easy: [0, 2], medium: [2, 3], hard: [3, 3] };

/** Adapt the band to the round just played, within the level's range. */
export function nextBand(band: Band, pen: number, lv: [Band, Band]): Band {
  if (pen <= 0.15) return Math.min(lv[1], band + 1) as Band;
  if (pen >= 0.6) return Math.max(lv[0], band - 1) as Band;
  return band;
}

export interface RoundRes {
  fam: string;
  name: string;
  band: Band;
  /** 0 best … 1 worst. */
  pen: number;
  note: string;
}

export const markOf = (pen: number) => (pen <= 0.15 ? '✓' : pen < 0.6 ? '½' : '✗');

/**
 * A run of rounds. Each round draws a family from the scheduler, generates a fresh valid challenge at the
 * current band, and records it in the history only when it is presented. Scoring: the mean round penalty,
 * in percent.
 */
export class Session<R> {
  results: RoundRes[] = [];
  round = -1;
  band: Band = 1;
  fam!: Family<R>;
  rd!: R;
  sig = '';
  /** The family's teaching line, the first time it is met on this device. */
  teach = '';
  private r: Rng = rng(1);
  private hist: History = emptyHistory();
  private taught = new Set<string>();
  private finished = false;

  constructor(
    private api: GameAPI,
    readonly game: string,
    readonly fams: Family<R>[],
    readonly rounds: number,
  ) {
    // These games need about 440 logical px across; phones scale the drawing down a little instead.
    api.stage.setMinWidth?.(440);
  }

  start(seed: number) {
    this.r = rng(seed);
    this.hist = loadHistory(this.game);
    this.results = [];
    this.round = -1;
    this.finished = false;
    this.band = LEVEL_BANDS[this.api.level][0];
    try {
      this.taught = new Set(JSON.parse(localStorage.getItem('eps:taught:' + this.game) || '[]'));
    } catch {
      this.taught = new Set();
    }
  }

  get last() {
    return this.round >= this.rounds - 1;
  }

  /** Draw and generate the next round. */
  next() {
    this.round++;
    let band = this.band;
    let fam: Family<R> | undefined;
    // A first session (or Easy) opens with the playable tutorial family at the gentlest band.
    if (this.round === 0 && (this.api.firstTime || this.api.level === 'easy')) {
      fam = this.fams.find((f) => f.intro);
      if (fam) band = fam.bands[0];
    }
    // The last round is a mastery challenge on Hard, and on Medium for a player who has been sure-footed.
    if (this.last && this.round > 0 && (this.api.level === 'hard' || (this.api.level === 'medium' && mean(this.results.map((x) => x.pen)) < 0.2))) band = 3;
    fam ??= chooseFamily(this.fams, band, this.hist, this.r);
    const g = generate(fam, band, this.hist, this.r);
    this.fam = fam;
    this.rd = g.rd;
    this.sig = g.sig;
    this.hist = pushHistory(this.hist, fam.id, g.sig);
    saveHistory(this.game, this.hist);
    this.teach = this.taught.has(fam.id) ? '' : fam.teach;
    if (this.teach) {
      this.taught.add(fam.id);
      try {
        localStorage.setItem('eps:taught:' + this.game, JSON.stringify([...this.taught]));
      } catch {
        /* ignore */
      }
    }
    this.curBand = g.band;
    return { fam, rd: g.rd, band: g.band };
  }

  /** The band the current challenge was actually generated at. */
  curBand: Band = 1;

  /** A sub-stream of the session's generator (e.g. for noise during a round). */
  get rand() {
    return this.r;
  }

  /** Score the current round (once). Returns false if it was already scored. */
  done(pen: number, note: string, at?: Pt) {
    if (this.results.length > this.round) return false;
    pen = clamp(Number.isFinite(pen) ? pen : 1, 0, 1);
    this.results.push({ fam: this.fam.id, name: this.fam.name, band: this.curBand, pen, note });
    this.api.judge(pen * 100, at);
    this.band = nextBand(this.band, pen, LEVEL_BANDS[this.api.level]);
    return true;
  }

  get scored() {
    return this.results.length > this.round;
  }

  marks() {
    return this.results.map((x) => markOf(x.pen));
  }

  /** The result card (once per run). */
  result(o: { label: string; headline?: string; rows?: [string, string][]; share?: string }): Result | null {
    if (this.finished) return null;
    this.finished = true;
    const pct = mean(this.results.map((x) => x.pen)) * 100;
    const rows: [string, string][] = this.results.map((x, i) => [`${i + 1} · ${x.name}${x.band === 3 ? ' (mastery)' : ''}`, `${markOf(x.pen)} ${x.note}`]);
    rows.push(...(o.rows ?? []));
    rows.push(['Variations played', [...new Set(this.results.map((x) => x.name))].join(' · ')]);
    const good = this.results.filter((x) => x.pen <= 0.15).length;
    return {
      score: pct,
      value: pct.toFixed(1),
      unit: '%',
      label: o.label,
      headline: o.headline ?? (pct < 0.05 ? 'Every round clean.' : `${good} of ${this.results.length} rounds clean · ${pct.toFixed(0)}% mean penalty.`),
      rows,
      accuracy: 1 - pct / 100,
      perfect: pct < 0.05,
      near: pct < 8,
      share: [`${o.share ?? this.game.toUpperCase()} · ${this.api.level}`, `${pct.toFixed(1)}% penalty`],
    };
  }
}

// ── Sliders ──────────────────────────────────────────────────────────────────────

interface Sl {
  x: number;
  y: number;
  w: number;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
}

/**
 * Canvas sliders, registered every frame they are drawn (like Bench buttons). Drag the knob or anywhere
 * on the track; ↑ ↓ choose a slider, ← → nudge it (Shift: fine).
 */
export class Sliders {
  private regs: Sl[] = [];
  private grab: Sl | null = null;
  focus = 0;

  frame() {
    this.regs = [];
  }

  draw(c: C, x: number, y: number, w: number, label: string, min: number, max: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, o: { color?: string; step?: number; off?: boolean } = {}) {
    const i = this.regs.length;
    const v = get();
    const k = clamp((v - min) / (max - min), 0, 1);
    const focused = i === this.focus && !o.off;
    text(c, label, x, y - 14, font.mono(10, 600), focused ? pal.ink : pal.ink3);
    text(c, fmt(v), x + w, y - 14, font.mono(11, 600), o.off ? pal.ink3 : (o.color ?? pal.accent), 'right');
    slot(c, x, y, x + w, y, 6);
    c.save();
    c.strokeStyle = alpha(o.color ?? pal.accent, o.off ? 0.2 : 0.7);
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w * k, y);
    c.stroke();
    c.restore();
    knob(c, x + w * k, y, 8, o.off ? pal.ink3 : (o.color ?? pal.accent), focused && this.grab?.y === y);
    if (!o.off) this.regs.push({ x, y, w, min, max, step: o.step ?? (max - min) / 400, get, set });
  }

  private apply(s: Sl, px: number) {
    const raw = s.min + clamp((px - s.x) / s.w, 0, 1) * (s.max - s.min);
    s.set(clamp(Math.round(raw / s.step) * s.step, s.min, s.max));
  }

  /** A press: true if it grabbed a slider. */
  down(p: Pt) {
    const i = this.regs.findIndex((s) => p.x >= s.x - 12 && p.x <= s.x + s.w + 12 && Math.abs(p.y - s.y) <= 16);
    if (i < 0) return false;
    this.focus = i;
    this.grab = this.regs[i];
    this.apply(this.grab, p.x);
    return true;
  }

  move(p: Pt) {
    if (!this.grab || !Number.isFinite(p.x)) return false;
    this.apply(this.grab, p.x);
    return true;
  }

  up() {
    const was = !!this.grab;
    this.grab = null;
    return was;
  }

  get dragging() {
    return !!this.grab;
  }

  /** Arrow keys: true if handled. */
  key(e: KeyboardEvent) {
    if (!this.regs.length) return false;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      this.focus = (this.focus + (e.key === 'ArrowDown' ? 1 : this.regs.length - 1)) % this.regs.length;
      return true;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
    const s = this.regs[Math.min(this.focus, this.regs.length - 1)];
    const d = (e.key === 'ArrowRight' ? 1 : -1) * s.step * (e.shiftKey ? 1 : 10);
    s.set(clamp(Math.round((s.get() + d) / s.step) * s.step, s.min, s.max));
    return true;
  }
}

// ── Shared drawing ───────────────────────────────────────────────────────────────

/** The variation's name in a small pill (top-left of the bench), with the band as dots. */
export function famChip(c: C, x: number, y: number, name: string, band: Band) {
  c.font = font.mono(10, 600);
  const label = name.toUpperCase();
  const w = c.measureText(label).width + 44;
  rr(c, x, y, w, 22, 11);
  c.fillStyle = alpha(pal.accent, 0.08);
  c.fill();
  c.strokeStyle = alpha(pal.accent, 0.35);
  c.lineWidth = 1;
  c.stroke();
  text(c, label, x + 10, y + 11.5, font.mono(10, 600), pal.accent, 'left', 'middle');
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.arc(x + w - 26 + i * 6, y + 11, 2, 0, Math.PI * 2);
    c.fillStyle = i <= band ? pal.accent : alpha(pal.ink, 0.18);
    c.fill();
  }
  return w;
}

/** Wrapped text inside a width; returns the height used. */
export function para(c: C, s: string, x: number, y: number, w: number, f: string, color: string, lh = 16, align: CanvasTextAlign = 'left') {
  c.font = f;
  const words = s.split(' ');
  let line = '';
  let yy = y;
  for (const wd of words) {
    const t = line ? line + ' ' + wd : wd;
    if (c.measureText(t).width > w && line) {
      text(c, line, x, yy, f, color, align);
      line = wd;
      yy += lh;
    } else line = t;
  }
  if (line) text(c, line, x, yy, f, color, align);
  return yy - y + lh;
}

export const inBox = (p: Pt, x: number, y: number, w: number, h: number) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

/** A seeded stream derived from a parent stream (independent but reproducible). */
export const fork = (r: Rng) => rng((r.next() * 0xffffffff) >>> 0);
