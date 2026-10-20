// Personal records live on this device only (localStorage). No account, no server.
//
// Storage (version 2, backwards-compatible with version 1):
//   eps:version          → "2"
//   eps:rec:<recordId>   → { runs: Run[], n, best }
// recordId = <game>[.<level>][~<mode>]  (Medium and the default mode keep the bare game id)
//
// Run kinds:
//   ranked    — a normal attempt with a fresh random seed. Counts for best / stats.
//   daily     — an official daily attempt (fixed shared seed). Counts for best / stats.
//   practice  — warm-up or practice attempt. Kept in the journal, never in best / stats.
//   challenge — a run from a shared seed link. Kept in the journal, never in best / stats
//               (a known seed can be rehearsed, so it isn't comparable with fresh runs).

import { mad, median, validScore } from './scoring';

export type Better = 'lower' | 'higher';
export type RunKind = 'ranked' | 'daily' | 'practice' | 'challenge';

/**
 * Which way is better for a record id. Records can't import the game registry (it would be circular), so the
 * registry installs the real lookup at start-up. Without it every record is treated as lower-is-better.
 */
let betterFor: (recordId: string) => Better = () => 'lower';
export function setBetterLookup(fn: (recordId: string) => Better) {
  betterFor = fn;
}

export interface Run {
  /** Primary score in the game's own unit. */
  s: number;
  /** Timestamp (ms). */
  t: number;
  /** Daily key (YYYY-MM-DD) if the run was an official daily attempt. */
  d?: string;
  /** Kind; missing on version-1 data, which is read as 'ranked' (or 'daily' when `d` is set). */
  k?: RunKind;
  /** Seed (32-bit), so any run can be replayed. */
  seed?: number;
  /** Optional player note (journal). */
  note?: string;
  /** Input condition, when it changed what the player could see (e.g. 'keyboard'). */
  input?: string;
}

interface Rec {
  runs: Run[];
  n: number;
  best: number | null;
}

export const STORAGE_VERSION = 2;
const PREFIX = 'eps:rec:';
const KEEP = 400;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export const kindOf = (r: Run): RunKind => r.k ?? (r.d ? 'daily' : 'ranked');
const counts = (r: Run) => {
  const k = kindOf(r);
  return k === 'ranked' || k === 'daily';
};

/** Keep only well-formed runs (corrupted or hand-edited storage must never crash the app). */
function sanitize(raw: unknown, better: Better = 'lower'): Rec {
  const empty: Rec = { runs: [], n: 0, best: null };
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Partial<Rec>;
  if (!Array.isArray(r.runs)) return empty;
  const runs = r.runs.filter(
    (x): x is Run => !!x && typeof x === 'object' && validScore((x as Run).s) && Number.isFinite((x as Run).t),
  );
  const ranked = runs.filter(counts).map((x) => x.s);
  const best = ranked.length ? (better === 'lower' ? Math.min(...ranked) : Math.max(...ranked)) : null;
  // Best is recomputed from runs, but a best older than the kept window is preserved.
  const keptBest = typeof r.best === 'number' && validScore(r.best) ? r.best : null;
  return {
    runs,
    n: typeof r.n === 'number' && r.n >= runs.length ? r.n : runs.length,
    best: keptBest != null && (best == null || (better === 'lower' ? keptBest < best : keptBest > best)) ? keptBest : best,
  };
}

function read(id: string): Rec {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (raw) return sanitize(JSON.parse(raw), betterFor(id));
  } catch {
    /* corrupt JSON or storage unavailable */
  }
  return { runs: [], n: 0, best: null };
}

function write(id: string, rec: Rec) {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(rec));
  } catch {
    /* storage full or blocked: the run still shows, it just won't persist */
  }
}

/** Version-1 data needs no rewrite (all new fields are optional); we only stamp the version. */
export function migrate() {
  try {
    const v = Number(localStorage.getItem('eps:version') || '1');
    if (v < STORAGE_VERSION) localStorage.setItem('eps:version', String(STORAGE_VERSION));
  } catch {
    /* ignore */
  }
}

export const isBetter = (a: number, b: number | null, better: Better) =>
  b == null || (better === 'lower' ? a < b : a > b);

export interface PushOpts {
  kind: RunKind;
  daily?: string;
  seed?: number;
  input?: string;
}

export function pushRun(id: string, score: number, better: Better, opts: PushOpts) {
  if (!validScore(score)) return { isBest: false, first: false, prevBest: null, recorded: false };
  const rec = read(id);
  const prevBest = rec.best;
  const ranked = opts.kind === 'ranked' || opts.kind === 'daily';
  const isBest = ranked && isBetter(score, prevBest, better);
  const run: Run = { s: score, t: Date.now(), k: opts.kind };
  if (opts.daily) run.d = opts.daily;
  if (opts.seed != null) run.seed = opts.seed >>> 0;
  if (opts.input) run.input = opts.input;
  rec.runs.push(run);
  if (rec.runs.length > KEEP) rec.runs.splice(0, rec.runs.length - KEEP);
  rec.n += 1;
  if (isBest) rec.best = score;
  write(id, rec);
  notify();
  return { isBest: isBest && prevBest != null, first: ranked && prevBest == null, prevBest, recorded: true, t: run.t };
}

export interface Stats {
  /** Ranked + daily runs ever recorded for this id. */
  n: number;
  best: number | null;
  last: number | null;
  /** Median of the last 10 ranked runs (null with fewer than 3). */
  median10: number | null;
  /** Median absolute deviation of the last 10 ranked runs — spread in the score's own unit. */
  spread10: number | null;
  /** Last 40 ranked scores, oldest first. */
  history: number[];
  /** Relative improvement of the median of the last 5 vs the first 5 ranked runs (null if undefined). */
  trend: number | null;
  /** All runs including practice/challenge (journal count). */
  all: number;
  dailyBest: (key: string) => number | null;
  dailyCount: (key: string) => number;
}

export function stats(id: string, better: Better): Stats {
  const rec = read(id);
  const ranked = rec.runs.filter(counts);
  const scores = ranked.map((r) => r.s);
  const recent = scores.slice(-10);
  let trend: number | null = null;
  if (scores.length >= 10) {
    const a = median(scores.slice(0, 5));
    const b = median(scores.slice(-5));
    // A near-zero baseline makes a relative trend meaningless — report nothing rather than nonsense.
    if (Math.abs(a) > 1e-6) trend = better === 'lower' ? (a - b) / Math.abs(a) : (b - a) / Math.abs(a);
  }
  const daily = (key: string) => rec.runs.filter((r) => r.d === key && kindOf(r) === 'daily');
  return {
    n: rec.runs.length === rec.n ? ranked.length : Math.max(ranked.length, rec.n - (rec.runs.length - ranked.length)),
    best: rec.best,
    last: scores.length ? scores[scores.length - 1] : null,
    median10: recent.length >= 3 ? median(recent) : null,
    spread10: recent.length >= 3 ? mad(recent) : null,
    history: scores.slice(-40),
    trend,
    all: rec.runs.length,
    dailyBest: (key) => {
      const d = daily(key);
      if (!d.length) return null;
      return d.reduce((b, r) => (isBetter(r.s, b, better) ? r.s : b), null as number | null);
    },
    dailyCount: (key) => daily(key).length,
  };
}

// ── Journal ───────────────────────────────────────────────────────────────────

export interface JournalEntry extends Run {
  recordId: string;
  game: string;
  level: 'easy' | 'medium' | 'hard';
  mode?: string;
  kind: RunKind;
}

export function parseRecordId(rid: string) {
  const [base, mode] = rid.split('~');
  const [game, lv] = base.split('.');
  const level = lv === 'easy' || lv === 'hard' ? lv : 'medium';
  return { game, level: level as JournalEntry['level'], mode };
}

/** Every run on this device, newest first. */
export function journal(): JournalEntry[] {
  const out: JournalEntry[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PREFIX)) continue;
      const rid = key.slice(PREFIX.length);
      const meta = parseRecordId(rid);
      for (const r of read(rid).runs) out.push({ ...r, recordId: rid, ...meta, kind: kindOf(r) });
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.t - a.t);
}

export function setNote(rid: string, t: number, note: string) {
  const rec = read(rid);
  const run = rec.runs.find((r) => r.t === t);
  if (!run) return;
  const clean = note.trim().slice(0, 280);
  if (clean) run.note = clean;
  else delete run.note;
  write(rid, rec);
  notify();
}

export function onRecords(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearAll() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) || k.startsWith('eps:seen:') || k.startsWith('eps:cal') || k.startsWith('eps:bias:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  notify();
}

// ── Backup ────────────────────────────────────────────────────────────────────

export function exportAll(): string {
  const out: Record<string, Rec> = {};
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) out[k] = read(k.slice(PREFIX.length));
  } catch {
    /* ignore */
  }
  return JSON.stringify({ app: 'epsilon', v: STORAGE_VERSION, at: new Date().toISOString(), data: out }, null, 1);
}

/**
 * Import a backup (version 1 or 2). Every record is validated; invalid runs are dropped.
 * Runs are merged with what is already here (deduplicated by timestamp), never silently lost.
 */
export function importAll(json: string) {
  let parsed: { app?: string; v?: number; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON');
  }
  if (parsed?.app !== 'epsilon' || !parsed.data || typeof parsed.data !== 'object') throw new Error('Not an epsilon records file');
  if ((parsed.v ?? 1) > STORAGE_VERSION) throw new Error('This backup is from a newer version of epsilon');
  let added = 0;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!k.startsWith(PREFIX) || !/^[a-z]+(\.(easy|hard))?(~[a-z]+){0,2}$/.test(k.slice(PREFIX.length))) continue;
    const rid = k.slice(PREFIX.length);
    const better = betterFor(rid);
    const incoming = sanitize(v, better);
    const here = read(rid);
    const seenT = new Set(here.runs.map((r) => r.t));
    const merged = [...here.runs, ...incoming.runs.filter((r) => !seenT.has(r.t))].sort((a, b) => a.t - b.t);
    added += merged.length - here.runs.length;
    const bests = [here.best, incoming.best].filter((b): b is number => b != null).sort((a, b) => (better === 'lower' ? a - b : b - a));
    write(rid, sanitize({ runs: merged.slice(-KEEP), n: Math.max(here.n, incoming.n, merged.length), best: bests[0] ?? null }, better));
  }
  notify();
  return added;
}

/** First-visit flags, for onboarding that disappears after the first attempt. */
export const seen = {
  get: (id: string) => {
    try {
      return localStorage.getItem('eps:seen:' + id) === '1';
    } catch {
      return false;
    }
  },
  set: (id: string) => {
    try {
      localStorage.setItem('eps:seen:' + id, '1');
    } catch {
      /* ignore */
    }
  },
};
