"use client";

import { useCallback, useEffect, useState } from "react";

// Telegram Mini App entry: signs in with Telegram's own proof of who is opening it, then opens the player.
type WebApp = { initData: string; ready: () => void; expand: () => void; setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void; close: () => void };
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }

export default function TelegramMiniApp() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);

  const start = useCallback(async () => {
    setBusy(true); setErr("");
    const wa = window.Telegram?.WebApp;
    if (!wa || !wa.initData) { setErr("Open this page from the Telegram bot (the 🎵 Music button)."); setBusy(false); return; }
    try { wa.ready(); wa.expand(); wa.setHeaderColor?.("#0b0b0f"); wa.setBackgroundColor?.("#0b0b0f"); } catch { /* old client */ }
    try {
      const r = await fetch("/api/tg/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: wa.initData }) });
      const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!r.ok || !j.token) { setErr(j.error ?? "Could not sign in."); setBusy(false); return; }
      try { sessionStorage.setItem("tgMini", "1"); localStorage.setItem("listenLink", j.token); } catch { /* private mode */ }
      window.location.replace(`/player/${j.token}`);
    } catch { setErr("No connection to the server."); setBusy(false); }
  }, []);

  useEffect(() => {
    if (window.Telegram?.WebApp) { void start(); return; }
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = () => void start();
    s.onerror = () => { setErr("Could not load Telegram. Check your connection."); setBusy(false); };
    document.head.appendChild(s);
  }, [start]);

  return (
    <div dir="ltr" lang="en" style={{ minHeight: "100dvh", background: "#0b0b0f", color: "#ececf1", display: "grid", placeItems: "center", padding: 24, fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static app icon */}
        <img src="/icons/player-192.png" alt="" width={72} height={72} style={{ borderRadius: 18 }} />
        <h1 style={{ fontSize: 24, margin: "14px 0 6px" }}>My Music</h1>
        {busy && !err && <p style={{ color: "#a1a1aa", margin: 0 }}>Opening your player…</p>}
        {err && (<>
          <p role="alert" style={{ color: "#fca5a5", lineHeight: 1.6 }}>{err}</p>
          <button onClick={() => void start()} style={{ marginTop: 8, height: 48, padding: "0 28px", border: 0, borderRadius: 999, background: "#ececf1", color: "#0b0b0f", fontSize: 16, fontWeight: 700 }}>Try again</button>
        </>)}
      </div>
    </div>
  );
}
