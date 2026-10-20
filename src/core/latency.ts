// Tap-along latency calibration, used by experiments that score taps against a scheduled beat
// (False Beat, Perception's on-the-beat mode). It estimates one stable systematic offset — audio output
// delay plus your own habit of tapping early or late — and subtracts it from tap times.
//
// Honesty: this does not make browser timing physically perfect. It removes a constant offset measured
// on this device, under the same sound condition (heard clicks vs. seen flashes have different delays).
// Stored under eps:cal… so "clear records" removes it too.
import { settings } from './settings';

const KEY = 'eps:cal:latency';

export interface LatencyCal {
  /** ms to subtract from each tap (positive = you/your device run late). */
  offset: number;
  spread: number;
  at: number;
}

type Store = Partial<Record<'sound' | 'visual', LatencyCal>>;

function read(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export const latencyCondition = (): 'sound' | 'visual' => (settings.sound ? 'sound' : 'visual');

/** The calibration for the current sound condition, if any. */
export function latency(): LatencyCal | null {
  const c = read()[latencyCondition()];
  return c && Number.isFinite(c.offset) && Math.abs(c.offset) <= 300 ? c : null;
}

export function saveLatency(cal: LatencyCal) {
  const s = read();
  s[latencyCondition()] = cal;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: lives for this page only */
  }
}

export function clearLatency() {
  const s = read();
  delete s[latencyCondition()];
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
