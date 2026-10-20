// Progression: star ratings, Hard unlocking, the play streak, and per-round tiers.
// Everything is derived from the records already stored on this device — nothing new to migrate, and a
// player's existing bests immediately count. Stars are targets in each game's own unit (lower is better).
import { journal, stats } from './records';
import type { GameMeta, Level } from './types';
import { games, recId } from '../games/registry';

/** Default scale of the Medium thresholds per level: Easy asks for more, Hard forgives more. */
export const STAR_SCALE: Record<Level, number> = { easy: 0.6, medium: 1, hard: 1.6 };

export type Stars = 0 | 1 | 2 | 3;

/** Thresholds for ★, ★★, ★★★ at a level (a score at or under the threshold earns it). */
export function starThresholds(g: GameMeta, level: Level): [number, number, number] | null {
  if (!g.stars) return null;
  const k = g.starScale?.[level] ?? STAR_SCALE[level];
  return [g.stars[0] * k, g.stars[1] * k, g.stars[2] * k];
}

/** Stars earned by one score. Scores are compared at the game's displayed precision. */
export function starsFor(g: GameMeta, level: Level, score: number | null): Stars {
  const t = starThresholds(g, level);
  if (!t || score == null || !Number.isFinite(score)) return 0;
  const s = Number(score.toFixed(g.digits));
  // Higher-is-better games (distances) earn a star at or above each target.
  if (g.better === 'higher') return (s >= t[2] ? 3 : s >= t[1] ? 2 : s >= t[0] ? 1 : 0) as Stars;
  return (s <= t[2] ? 3 : s <= t[1] ? 2 : s <= t[0] ? 1 : 0) as Stars;
}

/** "≤" or "≥": how a score compares with a star target. */
export const starCmp = (g: GameMeta) => (g.better === 'higher' ? '≥' : '≤');

/** Best stars at a level (default scoring mode), from the stored best. */
export function bestStars(g: GameMeta, level: Level, mode?: string): Stars {
  return starsFor(g, level, stats(recId(g.id, level, mode), g.better).best);
}

/** All stars earned on this device: every game, every level, default scoring. */
export function totalStars() {
  let n = 0;
  for (const g of games) for (const l of ['easy', 'medium', 'hard'] as Level[]) n += bestStars(g, l);
  return { earned: n, possible: games.filter((g) => g.stars).length * 9 };
}

/**
 * Hard unlocks with ★ on Medium. Anyone who already played Hard keeps it, and Practice / challenge links
 * can always open it (the shell decides that).
 */
export function hardUnlocked(g: GameMeta) {
  if (!g.stars) return true;
  if (bestStars(g, 'medium') >= 1) return true;
  return stats(recId(g.id, 'hard'), g.better).all > 0;
}

/** Consecutive days (ending today, or yesterday if nothing yet today) with at least one run of anything. */
export function playStreak(today = new Date()) {
  const days = new Set(
    journal().map((r) => {
      const d = new Date(r.t);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }),
  );
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const d = new Date(today);
  if (!days.has(key(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(key(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return { days: n, playedToday: days.has(key(today)) };
}

export type Tier = 'exact' | 'excellent' | 'great' | 'good' | 'off';
export const TIER_LABEL: Record<Tier, string> = { exact: 'EXACT', excellent: 'EXCELLENT', great: 'GREAT', good: 'GOOD', off: 'OFF' };

/** The tier of one round's error, using the same thresholds as the stars (rounds are in the score's unit). */
export function tierOf(g: GameMeta, level: Level, err: number): Tier {
  if (Number(Math.abs(err).toFixed(g.digits)) === 0) return 'exact';
  const s = starsFor(g, level, Math.abs(err));
  return s === 3 ? 'excellent' : s === 2 ? 'great' : s === 1 ? 'good' : 'off';
}

export const starString = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** The next star to earn at a level: how many you have and the score that earns one more (null at three). */
export function nextStar(g: GameMeta, level: Level, best: number | null): { have: Stars; at: number | null } | null {
  const t = starThresholds(g, level);
  if (!t) return null;
  const have = starsFor(g, level, best);
  return { have, at: have === 3 ? null : t[have as 0 | 1 | 2] };
}
