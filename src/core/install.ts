// Web-app install prompt (Chrome / Edge on Android and desktop). The browser fires `beforeinstallprompt`
// once, early; keep it so the "Install" button can show the native dialog later.
type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: Prompt | null = null;
const subs = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as Prompt;
    subs.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    subs.forEach((f) => f());
  });
}

export const canInstall = () => !!deferred;
export const onInstallChange = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export async function promptInstall() {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  await d.prompt();
  const r = await d.userChoice.catch(() => ({ outcome: 'dismissed' }));
  subs.forEach((f) => f());
  return r.outcome === 'accepted';
}

/** The visitor's platform, for highlighting the right download. */
export function platform(): 'android' | 'ios' | 'desktop' {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}
