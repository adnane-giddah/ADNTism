export interface Settings {
  sound: boolean;
  haptics: boolean;
  theme: 'system' | 'light' | 'dark';
  motion: 'system' | 'reduce';
  contrast: boolean;
  /** Master volume, 0..1. */
  volume: number;
  /** No flashes: no screen inversion on EXACT, beat lamps glow gently instead of flashing. */
  noFlash: boolean;
  /** Larger interface and canvas text. */
  textSize: 'normal' | 'large';
  /** Larger touch targets (slider knobs, start zones, hit tolerances where that doesn't change the score). */
  targets: 'normal' | 'large';
  /** Keyboard adjustment speed for sliders and arrow-key cursors. */
  sensitivity: 'low' | 'normal' | 'high';
}

const KEY = 'eps:settings';
const defaults: Settings = {
  sound: true,
  haptics: true,
  theme: 'system',
  motion: 'system',
  contrast: false,
  volume: 0.8,
  noFlash: false,
  textSize: 'normal',
  targets: 'normal',
  sensitivity: 'normal',
};
const listeners = new Set<() => void>();

function load(): Settings {
  let s: Settings;
  try {
    s = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    s = { ...defaults };
  }
  // Older saves lack the newer keys (they get defaults above); hand-edited values are put back in range.
  if (typeof s.volume !== 'number' || !Number.isFinite(s.volume)) s.volume = defaults.volume;
  s.volume = Math.min(1, Math.max(0, s.volume));
  if (s.textSize !== 'large') s.textSize = 'normal';
  if (s.targets !== 'large') s.targets = 'normal';
  if (s.sensitivity !== 'low' && s.sensitivity !== 'high') s.sensitivity = 'normal';
  s.noFlash = !!s.noFlash;
  return s;
}

export const settings: Settings = load();

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings live for this session only */
  }
  apply();
}

export function onSettings(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mqDark = matchMedia('(prefers-color-scheme: dark)');

export const reducedMotion = () => settings.motion === 'reduce' || mqMotion.matches;
/** Flashing visuals allowed? Off with "no flash" or reduced motion. */
export const flashOK = () => !settings.noFlash && !reducedMotion();
/** Canvas text scale. */
export const textScale = () => (settings.textSize === 'large' ? 1.2 : 1);
/** Hit-target scale for touch targets. */
export const targetScale = () => (settings.targets === 'large' ? 1.6 : 1);
/** Keyboard adjustment speed multiplier. */
export const sensitivity = () => (settings.sensitivity === 'low' ? 0.5 : settings.sensitivity === 'high' ? 2 : 1);
/** The lab is dark by default; only an explicit light choice (the parchment variant) leaves it. */
export const isDark = () => settings.theme !== 'light';

export function apply() {
  const d = document.documentElement;
  if (settings.theme === 'system') delete d.dataset.theme;
  else d.dataset.theme = settings.theme;
  if (settings.contrast) d.dataset.contrast = '1';
  else delete d.dataset.contrast;
  if (settings.motion === 'reduce') d.dataset.motion = 'reduce';
  else delete d.dataset.motion;
  if (settings.textSize === 'large') d.dataset.text = 'large';
  else delete d.dataset.text;
  const bg = getComputedStyle(d).getPropertyValue('--paper').trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = bg;
    m.removeAttribute('media');
  });
  listeners.forEach((f) => f());
}

mqDark.addEventListener('change', apply);
mqMotion.addEventListener('change', apply);

/** Toggle between light and dark (explicit choice overrides the system). */
export function toggleTheme() {
  setSetting('theme', isDark() ? 'light' : 'dark');
}

export function buzz(ms: number | number[]) {
  if (!settings.haptics || reducedMotion()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
