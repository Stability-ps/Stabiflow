/* StabiFlow service worker.
 *
 * Deliberately conservative - a stale app shell is worse than no offline
 * support for an authenticated data app:
 *  - Page navigations: NETWORK FIRST. The cached shell (index.html - static,
 *    identical for every user, no data) is only a fallback when offline, so
 *    a deploy is picked up on the next load.
 *  - /assets/* (content-hashed by Vite): cache first, in a cache that belongs
 *    to one deploy ("generation" = hash of that deploy's index.html). When a
 *    navigation sees a new index.html, older generations are deleted - old
 *    hashed files never accumulate.
 *  - Only successful, same-origin, non-HTML responses whose type matches the
 *    file are cached (a missing /assets/ file is answered by the SPA rewrite
 *    with index.html - that must never be stored as an asset).
 *  - Everything else is not intercepted: non-GET requests, other origins
 *    (Supabase REST/auth/storage, Edge Functions) and any other path.
 * Bump VERSION to drop every cache from earlier worker versions.
 */
const VERSION = "v3";
const PREFIX = "sf-";
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const ASSET_PREFIX = `${PREFIX}assets-${VERSION}-`;
const SHELL_URL = "/index.html";
const GENERATION_KEY = "/__sf_generation";

const ASSET_TYPES = [
  [/\.m?js$/i, /javascript/i],
  [/\.css$/i, /text\/css/i],
  [/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i, /^image\//i],
  [/\.(woff2?|ttf|otf|eot)$/i, /(font|octet-stream)/i],
  [/\.json$/i, /json/i],
];

/** Is this response safe to store under this /assets/ path? */
function isCacheableAsset(pathname, response) {
  if (!response || !response.ok || response.status !== 200) return false;
  if (response.type && response.type !== "basic" && response.type !== "default") return false;
  const type = response.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) return false;
  const rule = ASSET_TYPES.find(([ext]) => ext.test(pathname));
  return !!rule && rule[1].test(type);
}

async function hashText(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function currentGeneration() {
  const shell = await caches.open(SHELL_CACHE);
  const marker = await shell.match(GENERATION_KEY);
  return marker ? marker.text() : null;
}

/** Store a fresh shell; if it is a new deploy, start a new asset generation and drop the old ones. */
async function storeShell(html) {
  const generation = await hashText(html);
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(SHELL_URL, new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
  await shell.put(GENERATION_KEY, new Response(generation));
  const keep = `${ASSET_PREFIX}${generation}`;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k.includes("-assets-") && k !== keep).map((k) => caches.delete(k)));
  return generation;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(new Request(SHELL_URL, { cache: "reload" }))
      .then((res) => (res.ok ? res.text().then(storeShell) : undefined))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    currentGeneration()
      .then((generation) => caches.keys().then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith(PREFIX))
          .filter((k) => k !== SHELL_CACHE && k !== `${ASSET_PREFIX}${generation}`)
          .map((k) => caches.delete(k)),
      )))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
            event.waitUntil(res.clone().text().then(storeShell).catch(() => undefined));
          }
          return res;
        })
        .catch(() => caches.open(SHELL_CACHE).then((c) => c.match(SHELL_URL)).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      currentGeneration().then(async (generation) => {
        const cache = generation ? await caches.open(`${ASSET_PREFIX}${generation}`) : null;
        const cached = cache ? await cache.match(req) : undefined;
        if (cached) return cached;
        const res = await fetch(req);
        if (cache && isCacheableAsset(url.pathname, res)) {
          const copy = res.clone();
          event.waitUntil(cache.put(req, copy).catch(() => undefined));
        }
        return res;
      }),
    );
  }
});
