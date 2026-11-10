// Chunian Ride — service worker (v2.6.0, zero-budget PWA).
// Cache-first for same-origin static assets (CSS/JS/images/fonts);
// network-first for /api/* and for HTML (the app sets Cache-Control:
// no-store on HTML, so pages are never served stale from this cache).
// Versioned cache name — bump on every release so old assets die.
// v2.6.0 cache supersedes the old chunian-ride-v2.5.0 cache (deleted on activate).
const CACHE_NAME = "chunian-ride-v2.6.0";
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

// ---------- Web Push (v2.3) ----------
// Payload shape (server/db.mjs sendPushToUser): JSON {title, body, type,
// ride_id, url}. url is "/driver" when the push is driver-bound; rider
// pushes carry a ride_id — open the rider trip for it. Never invent a URL.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Chunian Ride";
  const body = data.body || "You have a new notification.";
  let url = data.url || "/";
  if (data.ride_id && (!data.url || data.url === "/driver")) {
    // A ride push without an explicit rider URL opens the rider trip.
    // Driver-bound pushes keep "/driver" (the server sets it).
    url = data.url || ("/rider?ride=" + data.ride_id);
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url, ride_id: data.ride_id || null, type: data.type || null },
      tag: data.ride_id ? ("ride-" + data.ride_id) : (data.type || "chunian-ride"),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  const full = new URL(url, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url === full) return c.focus();
      }
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin) return c.navigate(full).then((cl) => cl.focus());
      }
      return clients.openWindow(full);
    })
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
