"use client";

import { useEffect } from "react";

// A deploy swaps the JS chunk files; a page that was opened just before it
// asks for chunks that no longer exist and Next shows "Application error: a
// client-side exception". That is almost always fixed by one reload, so do it
// automatically (at most once per 30 s, to never loop) and otherwise offer a button.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|error loading dynamically imported/i.test(`${error?.name} ${error?.message}`);
  useEffect(() => {
    if (!stale) return;
    try {
      const last = Number(sessionStorage.getItem("chunk-reload-at") || 0);
      if (Date.now() - last > 30_000) { sessionStorage.setItem("chunk-reload-at", String(Date.now())); window.location.reload(); }
    } catch { window.location.reload(); }
  }, [stale]);
  return (
    <html lang="en">
      <body style={{ background: "#0b0b0f", color: "#d4d4d8", fontFamily: "system-ui, sans-serif", minHeight: "100dvh", display: "grid", placeItems: "center", margin: 0, textAlign: "center", padding: 24 }}>
        <div>
          <p style={{ fontSize: 15, marginBottom: 16 }}>{stale ? "Updating to the latest version…" : "Something went wrong."}</p>
          <button onClick={() => (stale ? window.location.reload() : reset())} style={{ padding: "10px 22px", borderRadius: 999, border: 0, background: "#ececf1", color: "#0b0b0f", fontWeight: 600, fontSize: 15 }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
