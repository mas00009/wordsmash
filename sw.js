// MasGames service worker — caches the app shell so it opens instantly / offline.
// Bump CACHE when you change the app shell so clients pick up the new version.
const CACHE = "wordsmash-v186";
// Only what the app actually loads. logo.svg, logo-trans.png, logo-mas-trans.png
// and logo-tagline-trans.png were still listed here but referenced nowhere —
// 4.6 MB of dead weight downloaded onto every phone on install.
const SHELL = [
  "./",
  "./index.html",
  "./qr.js",
  "./decks.js",
  "./wordsmash.js",
  "./board.html",
  "./live.js",
  "./ico-settings.png",
  "./wordsmash-logo.png",
  "./home-bg.webm",
  "./home-bg.jpg",
  "./join-bg.webm",
  "./join-bg.jpg",
  "./wordsmash-mark.png",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  // Fetch the shell straight from the network, not through the HTTP cache —
  // plain addAll happily installs a stale copy the browser cached earlier,
  // and cache-first then serves that stale build until the next version bump.
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((u) =>
        fetch(u, { cache: "reload" }).then((r) => {
          if (!r.ok) throw new Error(u);
          return c.put(u, r);
        })
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Only handle same-origin GETs (the app shell). Let cross-origin calls
  // (OpenRouter, the Cloudflare Worker API) go straight to the network.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method !== "GET") return;
  // Video elements fetch with Range headers; answering those from a cached
  // full response (or caching a 206 partial) corrupts playback with a decode
  // error. Let media streaming talk to the network directly.
  if (req.headers.get("range")) return;
  // Cache-first for the app shell, fall back to network.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // never store partial (206) responses — they poison later playback
      if (res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
