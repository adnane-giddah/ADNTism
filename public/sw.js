// Offline-first: precache the shell, then cache everything same-origin as it is fetched.
// Paths are relative to the worker's scope, so the site works at a root or under a sub-path (GitHub Pages).
const CACHE = 'eps-v3';
const SCOPE = self.registration.scope; // e.g. https://user.github.io/ADNTism/
const SHELL = [SCOPE, SCOPE + 'icon.svg', SCOPE + 'manifest.webmanifest', SCOPE + 'icon-192.png', SCOPE + 'icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => c.add(SCOPE))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // The Android app download always comes from the network (never cached, never stale).
  if (new URL(req.url).pathname.endsWith('.apk')) return;
  if (req.mode === 'navigate') {
    // Network first for pages so deploys show up; offline, every route falls back to the cached shell.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SCOPE, copy));
          }
          return res.ok ? res : caches.match(SCOPE).then((hit) => hit || res);
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
