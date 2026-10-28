// Offline support: serve game files from cache, refresh them in the background.
const CACHE = "skyhop-v1";
const FILES = ["./", "index.html", "styles.css", "levels.js", "game.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    // only clean up this game's own old caches: Cache Storage is shared with
    // the whole origin (staz.ai's offline cache, AI model downloads, ...)
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("skyhop-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request).then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
