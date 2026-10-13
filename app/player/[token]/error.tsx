"use client";

import { useEffect } from "react";
import { reportClient } from "@/lib/client-report";

// Last line of defence for the player page (the parts inside it have their own boundaries): reported, then one tap to recover.
export default function PlayerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClient("player-error", error); }, [error]);
  const stale = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed/i.test(`${error?.name} ${error?.message}`);
  useEffect(() => {
    if (!stale) return;
    try { const last = Number(sessionStorage.getItem("chunk-reload-at") || 0); if (Date.now() - last > 30_000) { sessionStorage.setItem("chunk-reload-at", String(Date.now())); window.location.reload(); } } catch { /* ignore */ }
  }, [stale]);
  return (
    <div dir="ltr" lang="en" style={{ minHeight: "100dvh", background: "#0b0b0f", color: "#ececf1", display: "grid", placeItems: "center", padding: 24, textAlign: "center", fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div>
        <p style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>{stale ? "Updating to the latest version…" : "The player hit a problem"}</p>
        <p style={{ fontSize: 14, color: "#a1a1aa", margin: "0 0 18px" }}>It has been reported. Your downloaded songs and settings are safe.</p>
        <button onClick={() => reset()} style={{ height: 46, padding: "0 24px", borderRadius: 999, border: 0, background: "#ececf1", color: "#0b0b0f", fontWeight: 700, fontSize: 15, marginRight: 8 }}>Try again</button>
        <button onClick={() => window.location.reload()} style={{ height: 46, padding: "0 24px", borderRadius: 999, border: "1px solid #3f3f46", background: "transparent", color: "#ececf1", fontWeight: 600, fontSize: 15 }}>Reload</button>
      </div>
    </div>
  );
}
