// Offline shell for the private player: network-first for the player page
// and its static assets, falling back to the last cached copy. Audio is
// cached by the page itself (Cache API "player-audio"), never here.
// A cached library answer is tagged "x-sw-cache: 1" so the page knows it is looking at an old copy.
const SHELL = "player-shell-v4";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("player-shell-") && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

// Shown when the server can't be reached and nothing is cached yet: a button to try again, and it retries by itself when the connection returns.
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>My Music</title>
<style>html,body{margin:0;height:100%;background:#0b0b0f;color:#ececf1;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{min-height:100%;display:grid;place-content:center;gap:14px;text-align:center;padding:24px}h1{font-size:22px;margin:0}p{margin:0;color:#a1a1aa;line-height:1.6}
button{margin-top:6px;height:50px;padding:0 28px;border:0;border-radius:999px;background:#ececf1;color:#0b0b0f;font-size:16px;font-weight:700}</style></head>
<body><main><h1>Can't reach the server</h1><p>Check your connection. Downloaded songs still play once the player is open.</p><button id="r">Try again</button></main>
<script>const go=()=>location.reload();document.getElementById("r").onclick=go;addEventListener("online",go);setInterval(()=>{if(navigator.onLine)go()},15000)</script></body></html>`;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Only the player and its launcher are ever cached (never dashboard pages).
  const mine = url.pathname.startsWith("/player/") || url.pathname === "/listen" || url.pathname.startsWith("/listen/");
  const nav = req.mode === "navigate" && mine;
  const shell = nav || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/api/music/cover/");
  const list = url.pathname === "/api/music";
  if (!shell && !list) return;
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const stale = async () => {
      const hit = await cache.match(req);
      if (!hit) return null;
      if (!list) return hit;
      const h = new Headers(hit.headers); h.set("x-sw-cache", "1");
      return new Response(await hit.blob(), { status: hit.status, headers: h });
    };
    // Hashed build files never change: serve the copy we have. A page opened before a deploy keeps working with ITS OWN
    // files even after the server has replaced them (that mismatch was the "Application error: a client-side exception").
    if (url.pathname.startsWith("/_next/static/")) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    // The server restarts for a few seconds on every deploy: try again a few times before giving up.
    const tries = self.navigator.onLine === false ? [0] : [0, 700, 1500, 3000];
    let last = null;
    for (const wait of tries) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await fetch(req);
        if (res.ok) { cache.put(req, res.clone()); return res; }
        if (res.status < 500) { last = res; break; } // a real answer (404 …): no point retrying
        last = res;
      } catch { last = null; }
    }
    // Still failing: an old copy beats an error page.
    const old = await stale();
    if (old) return old;
    if (last) return last;
    if (nav) return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    return Response.error();
  })());
});
