// Where the app lives. The same build runs at a site root, under a sub-path (GitHub Pages: /ADNTism/),
// and inside the Android app (Capacitor serves it from https://localhost/). Internal links are written as
// app paths ("/e/zero") and passed through `href()`; the router strips the base again.

/** '' at a root, '/ADNTism' on GitHub Pages. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (path: string) => BASE + path;
export const appPath = (pathname: string) => (BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname);

type Cap = { isNativePlatform?: () => boolean };
/** Running inside the installed Android app. */
export const NATIVE = typeof window !== 'undefined' && (window as unknown as { Capacitor?: Cap }).Capacitor?.isNativePlatform?.() === true;
/** Running as an installed web app (home-screen / desktop install). */
export const STANDALONE =
  typeof window !== 'undefined' && (matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** The public website (share links from the app point here, not at the app's local origin). */
export const SITE = 'https://adnane-giddah.github.io/ADNTism';
export const publicUrl = (path: string) => (NATIVE ? SITE : location.origin + BASE) + path;

/** Release downloads (stable names, always the latest release). */
export const APK_URL = 'https://github.com/adnane-giddah/ADNTism/releases/latest/download/epsilon.apk';
