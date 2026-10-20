import type { Sfx } from './audio';
import type { Fx } from './fx';
import type { Better } from './records';
import type { Stage } from './stage';

export type Level = 'easy' | 'medium' | 'hard';
export const LEVELS: Level[] = ['easy', 'medium', 'hard'];

export type Category = 'speed' | 'precision' | 'control' | 'geometry' | 'balance' | 'chaos' | 'perception' | 'memory' | 'reasoning' | 'fluids' | 'weird';

export interface Result {
  /** Primary metric, stored in records. */
  score: number;
  /** Primary metric formatted, without unit, e.g. "0.004". */
  value: string;
  unit: string;
  /** What the primary metric is, e.g. "final error". */
  label: string;
  /** One human sentence. "You stopped 1.4 u short." */
  headline: string;
  /** Measurement rows: target / you / error / secondary metrics. */
  rows: [string, string][];
  /** 0..1 if the experiment has a natural accuracy. */
  accuracy?: number;
  /** Exactly zero at the displayed precision. Rare on purpose. */
  perfect?: boolean;
  /** Very close: earns the soft chime. */
  near?: boolean;
  /** Plain-text lines for sharing. */
  share?: string[];
  /** Extra result actions specific to the experiment (e.g. Echo: hear the rhythm again). */
  actions?: { label: string; run: () => void }[];
}

export interface GameAPI {
  stage: Stage;
  /** Presentational effects over the stage (sparks, shockwaves, shake). Never part of a measurement. */
  fx: Fx;
  seed: number;
  /** Difficulty. Changing it restarts the attempt via reset(). */
  level: Level;
  /** Scoring variant id (first mode when the experiment has none). */
  mode: string;
  daily: boolean;
  /** Practice / warm-up attempt: not ranked. Experiments may reveal extra help (never on ranked runs). */
  practice: boolean;
  /**
   * Report an input condition that changes what the player can see (e.g. 'keyboard' in Exact Hard).
   * Such runs are recorded in a separate record category instead of being mixed with the others.
   */
  setInput: (condition: string | null) => void;
  /** First attempt ever on this device: show onboarding hints. */
  firstTime: boolean;
  motion: () => boolean;
  /** Instruction line over the stage. Empty string hides it. */
  prompt: (main: string, sub?: string) => void;
  /** Round / phase indicator in the header, e.g. "2 / 5". */
  progress: (text: string) => void;
  finish: (r: Result) => void;
  sfx: Sfx;
  buzz: (ms: number | number[]) => void;
  /** Abandon the current attempt (e.g. the tab was hidden mid-run). Nothing is recorded; a fresh attempt starts. */
  voidRun: (reason: string) => void;
  /**
   * Judge one round's error (in the score's unit): shows EXACT / EXCELLENT / GREAT / GOOD / OFF with a combo
   * counter and a chime, using the game's star thresholds. `at` places the label (stage px); default: centre.
   */
  judge: (err: number, at?: { x: number; y: number }) => string;
  /** While on, plain character keys belong to the experiment (the shell's single-key shortcuts pause). Esc still works. */
  ownKeys: (on: boolean) => void;
  /** Best ranked score at this level and scoring mode, or null (e.g. to put a "best" marker in the world). */
  best?: () => number | null;
  /** The ★ ★★ ★★★ targets at the current level, in the score's unit (null if the game has none). */
  stars?: () => [number, number, number] | null;
  /** From the result: start the next attempt now (instant-retry games). Ignored outside the result. */
  again?: () => void;
}

export interface GameHandle {
  /** Start a fresh attempt with a new seed. */
  reset: (seed: number) => void;
  destroy: () => void;
}

export type GameFactory = (api: GameAPI) => GameHandle;

export interface GameMeta {
  id: string;
  no: string;
  name: string;
  /** One line, shown on cards. */
  tagline: string;
  /** "Hold to measure. Release to commit." — shown before the first attempt. */
  howto: string;
  /** What the measurement means, shown after the first attempt. */
  explain: string;
  measures: string;
  unit: string;
  better: Better;
  /** Digits for the primary score display. */
  digits: number;
  categories: Category[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Typical attempt length in seconds. */
  seconds: number;
  input: string;
  keys: string;
  /** What changes at each level — shown in the level picker. */
  levels: Record<Level, string>;
  /** Star targets on Medium (score at or under each earns ★, ★★, ★★★), in the game's unit. */
  stars?: [number, number, number];
  /** Per-level multiplier for the star targets (defaults: Easy 0.6, Medium 1, Hard 1.6). */
  starScale?: Partial<Record<Level, number>>;
  /** Optional step-by-step instructions, shown in the help popover. */
  steps?: string[];
  /** Optional scoring variants. The first is the default. Records are kept per mode. */
  modes?: { id: string; label: string; name: string; hint: string }[];
  load: () => Promise<{ default: GameFactory }>;
}
