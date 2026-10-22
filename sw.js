// Offline support for the installed app. Network first, so the directory is
// always as fresh as the live site when online; the last copy that loaded is
// used when there's no connection (handy on conference Wi-Fi).
const CACHE = "pd-v2";
const CORE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Same-site files, Google Fonts and the globe's coastline data; nothing else.
  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === "cdn.jsdelivr.net";
  if (!cacheable) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req.mode === "navigate" ? "/" : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then(r => r || caches.match("/")))
  );
});
