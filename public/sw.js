const CACHE = "stabiflow-shell-v1";
const SHELL = ["/", "/app", "/pricing", "/brand/StabiFlow_Favicon_192x192.png", "/brand/StabiFlow_Favicon_512x512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/app").then((r) => r || caches.match("/"))));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && ["script", "style", "image", "font"].includes(event.request.destination)) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
