// Keyboard lanes for Letterfall. Lanes are PHYSICAL keys (KeyboardEvent.code), so the game works on any
// layout; only the labels differ. The layout is chosen by the player (or detected where the browser exposes
// it) — never guessed from language or country. Custom per-lane mappings are stored on this device.

export type LayoutId = 'auto' | 'qwerty' | 'azerty' | 'qwertz' | 'dvorak' | 'custom';

/** Home-row physical keys, left to right. */
export const HOME = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];

/** What each layout prints on those physical keys. */
export const LABELS: Record<Exclude<LayoutId, 'auto' | 'custom'>, Record<string, string>> = {
  qwerty: { KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyJ: 'J', KeyK: 'K', KeyL: 'L', Semicolon: ';' },
  azerty: { KeyA: 'Q', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyJ: 'J', KeyK: 'K', KeyL: 'L', Semicolon: 'M' },
  qwertz: { KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyJ: 'J', KeyK: 'K', KeyL: 'L', Semicolon: 'Ö' },
  dvorak: { KeyA: 'A', KeyS: 'O', KeyD: 'E', KeyF: 'U', KeyJ: 'H', KeyK: 'T', KeyL: 'N', Semicolon: 'S' },
};

export const LAYOUT_NAMES: Record<LayoutId, string> = {
  auto: 'Auto (detected)',
  qwerty: 'QWERTY',
  azerty: 'AZERTY',
  qwertz: 'QWERTZ',
  dvorak: 'Dvorak',
  custom: 'Custom',
};
export const LAYOUT_ORDER: LayoutId[] = ['auto', 'qwerty', 'azerty', 'qwertz', 'dvorak', 'custom'];

interface Stored {
  layout: LayoutId;
  /** Custom lanes: physical codes chosen by the player, plus the key text they produced. */
  custom?: { code: string; label: string }[];
}
const KEY = 'eps:keymap';

export function loadKeymap(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    const layout = LAYOUT_ORDER.includes(v.layout) ? v.layout : 'auto';
    const custom = Array.isArray(v.custom) ? v.custom.filter((c: unknown) => c && typeof (c as { code: unknown }).code === 'string').slice(0, 8) : undefined;
    return { layout, custom };
  } catch {
    return { layout: 'auto' };
  }
}

export function saveKeymap(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Labels detected from the browser (Chromium's Keyboard Map API), or null where it isn't available. */
let detected: Record<string, string> | null = null;
export async function detectLayout() {
  try {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    const map = await kb?.getLayoutMap?.();
    if (!map) return null;
    const out: Record<string, string> = {};
    for (const code of HOME) {
      const k = map.get(code);
      if (k) out[code] = k.toUpperCase();
    }
    detected = Object.keys(out).length === HOME.length ? out : null;
  } catch {
    detected = null;
  }
  return detected;
}

/** Which home-row keys a lane count uses: centred on F / J. */
export function laneCodes(n: number) {
  if (n === 4) return ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
  if (n === 6) return ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];
  return HOME.slice(0, 8);
}

/** The lanes for this game: physical codes and their visible labels. */
export function resolveLanes(n: number, s: Stored): { code: string; label: string }[] {
  if (s.layout === 'custom' && s.custom && s.custom.length >= n) return s.custom.slice(0, n);
  const codes = laneCodes(n);
  const labels = s.layout === 'auto' ? (detected ?? LABELS.qwerty) : LABELS[s.layout === 'custom' ? 'qwerty' : s.layout];
  return codes.map((code) => ({ code, label: labels[code] ?? code.replace('Key', '') }));
}

export const isDetected = () => detected != null;
