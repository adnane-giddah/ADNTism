/** True if a keyboard event should drive the experiment (not a button, link or field, no modifiers). */
export function gameKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  // The target can be the window or the document (no .closest) — those are never form controls.
  const t = e.target as HTMLElement | null;
  if (t && typeof t.closest === 'function' && t.closest('button, a, input, select, textarea, [contenteditable]')) return false;
  return true;
}

/** Listen on window; returns an unsubscribe. */
export function listen<K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) {
  window.addEventListener(type, fn, opts);
  return () => window.removeEventListener(type, fn, opts);
}

/**
 * Primary pointer only: ignore second fingers and right/middle clicks. Mouse `pointermove` events report
 * button −1 ("no change"), so −1 must pass too — otherwise every mouse drag is silently dropped.
 */
export const primary = (e: PointerEvent) => e.isPrimary && (e.pointerType !== 'mouse' || e.button <= 0);

/** setPointerCapture can throw (e.g. pointer already gone); never let that swallow an input. */
export function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}
