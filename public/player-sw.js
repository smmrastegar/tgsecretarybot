// Offline shell for the private player: network-first for the player page
// and its static assets, falling back to the last cached copy. Audio is
// cached by the page itself (Cache API "player-audio"), never here.
const SHELL = "player-shell-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Only the player and its launcher are ever cached (never dashboard pages).
  const mine = url.pathname.startsWith("/player/") || url.pathname === "/listen" || url.pathname.startsWith("/listen/");
  const shell = (req.mode === "navigate" && mine) || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/api/music/cover/");
  const list = url.pathname === "/api/music";
  if (!shell && !list) return;
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req);
      if (hit) return hit;
      throw new Error("offline");
    }
  })());
});
