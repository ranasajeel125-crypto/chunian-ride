// Chunian Ride — service worker (v2.2, zero-budget PWA).
// Cache-first for same-origin static assets (CSS/JS/images/fonts);
// network-first for /api/* and for HTML (the app sets Cache-Control:
// no-store on HTML, so pages are never served stale from this cache).
// Versioned cache name — bump on every release so old assets die.
const CACHE_NAME = "chunian-ride-v2.2";
const STATIC_RE = /\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?)$/i;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third-party: leave alone

  if (url.pathname.startsWith("/api/")) {
    // API: network-first; fall back to a cached GET only when offline.
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (STATIC_RE.test(url.pathname)) {
    // Static assets: cache-first.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML / navigation: network-first, never cached (honours no-store).
  event.respondWith(fetch(req));
});
