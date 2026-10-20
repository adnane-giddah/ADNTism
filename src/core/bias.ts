// Personal bias profile: signed errors kept per experiment and challenge type, on this device only.
// Used to tell a systematic tendency ("you stretch lengths by 4%") from random scatter — and to say
// "not enough data" until there is enough to tell. See biasSummary() for the rule.
import { biasSummary } from './scoring';

const PREFIX = 'eps:bias:';
const KEEP = 120;

export interface BiasSample {
  /** Signed error, in the type's own unit (relative errors as fractions). */
  e: number;
  /** True when a context/illusion was present. */
  ctx: boolean;
  /** Error re-signed so that positive = in the illusion's predicted direction (absent if no prediction). */
  fooled?: number;
  t: number;
}

type Store = Record<string, BiasSample[]>;

function read(game: string): Store {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + game) || '{}');
    if (!v || typeof v !== 'object') return {};
    const out: Store = {};
    for (const [k, arr] of Object.entries(v)) if (Array.isArray(arr)) out[k] = arr.filter((s) => s && Number.isFinite(s.e));
    return out;
  } catch {
    return {};
  }
}

export function addBias(game: string, type: string, s: Omit<BiasSample, 't'>) {
  const st = read(game);
  const arr = (st[type] ??= []);
  arr.push({ ...s, t: Date.now() });
  if (arr.length > KEEP) arr.splice(0, arr.length - KEEP);
  try {
    localStorage.setItem(PREFIX + game, JSON.stringify(st));
  } catch {
    /* storage full or blocked */
  }
}

export function biasOf(game: string, type: string, filter: (s: BiasSample) => boolean = () => true) {
  const arr = (read(game)[type] ?? []).filter(filter);
  return { ...biasSummary(arr.map((s) => s.e)), abs: arr.length ? arr.reduce((a, s) => a + Math.abs(s.e), 0) / arr.length : NaN };
}

export function fooledOf(game: string, type: string) {
  const arr = (read(game)[type] ?? []).filter((s) => s.fooled != null).map((s) => s.fooled!);
  return biasSummary(arr);
}
