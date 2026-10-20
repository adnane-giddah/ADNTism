import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/playfair-display/wght-italic.css';
import './styles.css';
import './lab.css';
import './mobile.css';

import { unlockAudio } from './core/audio';
import { refreshPalette } from './core/draw';
import { apply, onSettings, reducedMotion } from './core/settings';
import { migrate } from './core/records';
import { appPath, href, NATIVE, STANDALONE } from './core/route';
import { homePage } from './pages/home';
import type { Page } from './pages/chrome';

const app = document.getElementById('app')!;
let current: Page | null = null;
let token = 0;
const scrolls = new Map<string, number>();

migrate();
onSettings(refreshPalette);
apply();
refreshPalette();

// iOS & co. only allow audio after a gesture; unlock on the first one.
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

async function resolve(path: string, search: URLSearchParams): Promise<Page> {
  if (path === '/' || path === '/index.html') return homePage();
  const m = path.match(/^\/e\/([a-z-]+)\/?$/);
  if (m) {
    const { playPage } = await import('./pages/play');
    return playPage(m[1], search.has('daily'));
  }
  if (path === '/daily') return (await import('./pages/daily')).dailyPage();
  if (path === '/records') return (await import('./pages/records')).recordsPage();
  if (path === '/about') return (await import('./pages/about')).aboutPage();
  return (await import('./pages/about')).notFound();
}

async function render(restore = false) {
  const t = ++token;
  const page = await resolve(appPath(location.pathname), new URLSearchParams(location.search));
  if (t !== token) {
    page.destroy?.();
    return;
  }
  const swap = () => {
    current?.destroy?.();
    app.replaceChildren(page.el);
    current = page;
    document.title = page.title;
    document.body.classList.toggle('in-xp', !!page.fullscreen);
    document.body.classList.toggle('has-tabbar', !page.fullscreen);
    window.scrollTo(0, restore ? (scrolls.get(location.pathname) ?? 0) : 0);
    page.mounted?.();
  };
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  if (vt && current && !reducedMotion()) vt.call(document, swap);
  else swap();
}

/** Navigate to an app path ("/e/zero?daily"). */
export function go(path: string) {
  scrolls.set(location.pathname, window.scrollY);
  history.pushState(null, '', href(path));
  void render();
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  if (url.pathname + url.search === location.pathname + location.search && !url.hash) return;
  go(appPath(url.pathname) + url.search + url.hash);
});

window.addEventListener('popstate', () => void render(true));
history.scrollRestoration = 'manual';
// GitHub Pages fallback: 404.html stores the deep link it was asked for and loads the app at its root.
try {
  const deep = sessionStorage.getItem('eps:deep');
  if (deep) {
    sessionStorage.removeItem('eps:deep');
    history.replaceState(null, '', deep);
  }
} catch {
  /* storage blocked: start at the home page */
}
document.documentElement.classList.toggle('native', NATIVE);
document.documentElement.classList.toggle('standalone', STANDALONE || NATIVE);
void render();

if (NATIVE) {
  // Android back button: back through the app's pages, leave the app from the home page.
  void import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', () => {
      if (appPath(location.pathname) !== '/') history.back();
      else void App.exitApp();
    }),
  );
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(href('/sw.js')).catch(() => {}));
}
