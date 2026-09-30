/* StabiFlow service worker.
 *
 * Deliberately conservative - a stale app shell is worse than no offline
 * support for a data app:
 *  - Page navigations: NETWORK FIRST. The cached shell is only a fallback
 *    when the network is unavailable, so a deploy is picked up on the next
 *    load and navigation is never served stale while online.
 *  - /assets/* (content-hashed by Vite, immutable): cache first.
 *  - Everything else (API, Supabase, auth, /business pages, other origins):
 *    not intercepted at all.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const SHELL_CACHE = `sf-shell-${VERSION}`;
const ASSET_CACHE = `sf-assets-${VERSION}`;
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add(new Request(SHELL_URL, { cache: "reload" }))).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sf-") && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/business/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })),
    );
  }
});
