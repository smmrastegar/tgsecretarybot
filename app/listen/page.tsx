"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

// "My Music" launcher: the page the installed app opens. First run: paste your
// player link once; it is remembered on this phone and playback starts from it.
// "Sign out" inside the player forgets it again so a different link can be used.
const KEY = "listenLink";
const PENDING = "listenPending"; // the link token of a sign-up that is waiting for approval

// Accepts the full URL (…/player/<token>) or just the token.
function tokenFrom(raw: string): string | null {
  const t = raw.trim();
  const m = /\/player\/([A-Za-z0-9_-]{40,})/.exec(t);
  const tok = m ? m[1]! : /^[A-Za-z0-9_-]{40,}$/.test(t) ? t : null;
  return tok;
}

export default function ListenPage() {
  return <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#0b0b0f" }} />}><Launcher /></Suspense>;
}

function Launcher() {
  const params = useSearchParams();
  const [value, setValue] = useState("");
  const [state, setState] = useState<"boot" | "ask" | "check">("boot");
  const [err, setErr] = useState("");
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [native, setNative] = useState(false);
  // "Continue with Telegram": the bot confirms who you are; the owner lands on the Main link, everyone else on a link of their own.
  const [tg, setTg] = useState<"idle" | "starting" | "waiting">("idle");
  const [tgUrl, setTgUrl] = useState("");
  const [waitTok, setWaitTok] = useState<string | null>(null); // a sign-up that waits for the owner's approval: the app checks by itself and goes in once it is approved
  const tgNonce = useRef<string | null>(null);
  const tgDeadline = useRef(0);

  const go = useCallback(async (raw: string, via: "auto" | "paste" | "telegram" = "auto") => {
    const tok = tokenFrom(raw);
    if (!tok) { setErr("That doesn't look like a player link."); setState("ask"); return; }
    setState("check"); setErr("");
    try {
      const r = await fetch(`/api/music/version?t=${encodeURIComponent(tok)}`, { cache: "no-store" });
      if (r.status === 404) { setErr("This link isn't valid (or it has been switched off)."); setState("ask"); return; }
      // Any other answer (even offline) is good enough: the player itself handles the rest.
    } catch { /* offline: trust the stored link */ }
    try { localStorage.setItem(KEY, tok); } catch { /* private mode */ }
    // Settings → About shows how and when this phone signed in: written on a real sign-in (pasted link / Telegram), not on every reopen.
    if (via !== "auto") { try { localStorage.setItem("listenLogin", JSON.stringify({ via, at: Date.now() })); } catch { /* private mode */ } }
    const nat = (window as unknown as { AndroidMusic?: { saveLink?: (t: string) => void } }).AndroidMusic;
    try { nat?.saveLink?.(tok); } catch { /* old app */ }
    // The Android app lives on playlist.bz now: move there (the link is kept by the app itself).
    if (nat && window.location.hostname !== "playlist.bz") { window.location.replace(`https://playlist.bz/player/${tok}`); return; }
    window.location.replace(`/player/${tok}`);
  }, []);

  async function startTelegram() {
    setErr(""); setTg("starting");
    const tab = (window as unknown as { AndroidMusic?: unknown }).AndroidMusic ? null : window.open("", "_blank"); // keep the click's permission for a browser tab
    try {
      const r = await fetch("/api/auth/tg-start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player: true }) });
      const d = (await r.json()) as { nonce?: string; url?: string; error?: string; expiresIn?: number };
      if (!r.ok || !d.nonce || !d.url) throw new Error(d.error ?? `Error ${r.status}`);
      tgNonce.current = d.nonce; setTgUrl(d.url); tgDeadline.current = Date.now() + (d.expiresIn ?? 300) * 1000;
      if (tab) tab.location.href = d.url; else window.location.href = d.url;
      setTg("waiting");
    } catch (e) { tab?.close(); setErr(e instanceof Error ? e.message : String(e)); setTg("idle"); }
  }
  // Waiting for the owner: ask now and then (and when the app comes back to the front); in as soon as it is approved.
  useEffect(() => {
    if (!waitTok) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/auth/link-status?t=${encodeURIComponent(waitTok)}`, { cache: "no-store" });
        const d = (await r.json()) as { status?: string };
        if (d.status === "approved") { stop = true; try { localStorage.removeItem(PENDING); } catch { /* ignore */ } void go(waitTok, "telegram"); }
        else if (d.status === "denied" || d.status === "unknown") { stop = true; try { localStorage.removeItem(PENDING); } catch { /* ignore */ } setWaitTok(null); setErr(d.status === "denied" ? "This request wasn't approved." : "This request is no longer valid — tap Continue with Telegram again."); }
      } catch { /* offline for a moment */ }
    };
    void tick();
    const i = setInterval(() => void tick(), 4000);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, [waitTok, go]);

  useEffect(() => {
    if (tg !== "waiting") return;
    let stop = false;
    const tick = async () => {
      if (stop || !tgNonce.current) return;
      if (Date.now() > tgDeadline.current) { stop = true; setErr("Time ran out — try again."); setTg("idle"); return; }
      try {
        const r = await fetch(`/api/auth/tg-poll?nonce=${encodeURIComponent(tgNonce.current)}`, { cache: "no-store" });
        const d = (await r.json()) as { status?: string; token?: string };
        if (d.status === "ok" && d.token) { stop = true; void go(d.token, "telegram"); return; }
        if (d.status === "approval" && d.token) { stop = true; try { localStorage.setItem(PENDING, d.token); } catch { /* private mode */ } setWaitTok(d.token); setTg("idle"); return; }
        if (d.status === "denied") { stop = true; setErr("This request wasn't approved."); setTg("idle"); return; }
        if (d.status === "off") { stop = true; setErr("This account's link has been switched off."); setTg("idle"); return; }
        if (d.status === "closed") { stop = true; setErr("New sign-ups are closed right now. Ask the owner for a link."); setTg("idle"); return; }
        if (d.status === "expired" || d.status === "unknown") { stop = true; setErr("That request expired — try again."); setTg("idle"); }
      } catch { /* offline for a moment */ }
    };
    const i = setInterval(() => void tick(), 1500);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, [tg, go]);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setNative(!!(window as unknown as { AndroidMusic?: unknown }).AndroidMusic);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/player-sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as unknown as { prompt: () => Promise<void> }); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // ?link=<url or token> (e.g. opened from a message), or the remembered link, else ask.
    const fromUrl = params.get("link");
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    const nat = (window as unknown as { AndroidMusic?: { link?: () => string; saveLink?: (t: string) => void; markMigrated?: () => void } }).AndroidMusic;
    if (!saved) { try { saved = nat?.link?.() || null; } catch { /* old app */ } }
    if (params.get("signedout") === "1") { try { nat?.saveLink?.(""); } catch { /* old app */ } }
    // One-time hop from the old address: nothing saved there means nothing to carry over, so go on to the new address.
    if (params.get("migrate") === "1" && !saved && !fromUrl) { try { nat?.markMigrated?.(); } catch { /* old app */ } window.location.replace("https://playlist.bz/listen"); return; }
    let pending: string | null = null;
    try { pending = localStorage.getItem(PENDING); } catch { /* ignore */ }
    if (pending && !fromUrl && !saved) { setWaitTok(pending); setState("ask"); } // reopened while a request waits: carry on waiting
    else if (fromUrl) void go(fromUrl, "paste");
    else if (saved && params.get("signedout") !== "1") void go(saved);
    else setState("ask");
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once at launch
  }, []);

  async function paste() {
    try { const nat = (window as unknown as { AndroidMusic?: { clipboard?: () => string } }).AndroidMusic; const t = nat?.clipboard ? nat.clipboard() : await navigator.clipboard.readText(); setValue(t); if (tokenFrom(t)) void go(t, "paste"); } catch { setErr("Couldn't read the clipboard — paste the link into the box instead."); }
  }

  const S = { bg: "#0b0b0f", fg: "#ececf1", dim: "#a1a1aa", card: "rgba(255,255,255,.06)", bd: "rgba(255,255,255,.12)" };
  return (
    <div dir="ltr" lang="en" style={{ minHeight: "100dvh", background: S.bg, color: S.fg, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif', display: "grid", placeItems: "center", padding: "24px 20px", letterSpacing: "-0.011em" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static app icon */}
          <img src="/icons/player-192.png" alt="" width={84} height={84} style={{ borderRadius: 22, boxShadow: "0 12px 40px -12px rgba(0,0,0,.8)" }} />
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "16px 0 4px" }}>My Music</h1>
          <p style={{ color: S.dim, fontSize: 15, margin: 0 }}>{state === "ask" ? "Paste your player link to start listening." : "Opening your player…"}</p>
        </div>

        {state === "ask" && (
          <div>
            <textarea value={value} onChange={(e) => { setValue(e.target.value); setErr(""); }} rows={3} placeholder="https://…/player/…" aria-label="Player link" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ width: "100%", boxSizing: "border-box", borderRadius: 16, background: S.card, border: `1px solid ${S.bd}`, color: S.fg, padding: "14px 16px", fontSize: 15, fontFamily: "ui-monospace, Menlo, monospace", resize: "none", outline: "none" }} />
            {err && <p role="alert" style={{ color: "#fca5a5", fontSize: 14, margin: "10px 2px 0" }}>{err}</p>}
            <button onClick={() => void go(value, "paste")} disabled={!value.trim()} style={{ marginTop: 14, width: "100%", height: 54, borderRadius: 999, border: 0, background: S.fg, color: S.bg, fontSize: 17, fontWeight: 700, opacity: value.trim() ? 1 : 0.4 }}>Start listening</button>
            <button onClick={() => void paste()} style={{ marginTop: 10, width: "100%", height: 50, borderRadius: 999, border: `1px solid ${S.bd}`, background: "transparent", color: S.fg, fontSize: 16, fontWeight: 600 }}>Paste from clipboard</button>
            <p style={{ color: S.dim, fontSize: 13, textAlign: "center", marginTop: 18, lineHeight: 1.6 }}>The link is stored only on this phone. You can sign out any time (Settings inside the player) and use a different link.</p>
          </div>
        )}
        {state === "ask" && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: S.dim, fontSize: 13, margin: "0 0 14px" }}><span style={{ flex: 1, height: 1, background: S.bd }} />or<span style={{ flex: 1, height: 1, background: S.bd }} /></div>
            {tg === "waiting" ? (
              <div style={{ borderRadius: 16, background: S.card, border: `1px solid ${S.bd}`, padding: 16, fontSize: 14, lineHeight: 1.6 }}>
                <b>Waiting for Telegram…</b>
                <div style={{ color: S.dim, marginTop: 4 }}>Tap <b>Start</b> in the bot chat, then come back here. This opens by itself.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <a href={tgUrl} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: "center", padding: "11px 0", borderRadius: 999, background: "#2AABEE", color: "#fff", fontWeight: 700, textDecoration: "none" }}>Open Telegram again</a>
                  <button onClick={() => { setTg("idle"); tgNonce.current = null; }} style={{ padding: "11px 18px", borderRadius: 999, border: `1px solid ${S.bd}`, background: "transparent", color: S.fg, fontWeight: 600 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
              {waitTok && (
                <div role="status" style={{ margin: "0 0 12px", borderRadius: 16, background: S.card, border: `1px solid ${S.bd}`, padding: 14, fontSize: 14, lineHeight: 1.6 }}>
                  <b style={{ color: "#86efac" }}>Waiting for approval…</b>
                  <div style={{ color: S.dim, marginTop: 2 }}>Your request was sent. This opens by itself as soon as it is approved — you can leave the app open.</div>
                </div>
              )}
              <button onClick={() => void startTelegram()} disabled={tg === "starting"} style={{ width: "100%", height: 54, borderRadius: 999, border: 0, background: "#2AABEE", color: "#fff", fontSize: 17, fontWeight: 700, opacity: tg === "starting" ? 0.6 : 1 }}>{tg === "starting" ? "Opening Telegram…" : "Continue with Telegram"}</button>
              </>
            )}
          </div>
        )}
        {state === "check" && <p style={{ textAlign: "center", color: S.dim }}>Checking link…</p>}

        {state === "ask" && !native && !ios && (
          <a href="/downloads/MyMusic.apk" style={{ display: "block", marginTop: 22, textAlign: "center", padding: "14px 16px", borderRadius: 16, border: `1px solid ${S.bd}`, color: S.fg, textDecoration: "none", fontSize: 15, fontWeight: 600 }}>
            Android app (APK) <span style={{ color: S.dim, fontWeight: 400 }}>· plays with the screen off, lock-screen controls</span>
          </a>
        )}

        {!standalone && !native && state === "ask" && (
          <div style={{ marginTop: 26, padding: 16, borderRadius: 16, background: S.card, border: `1px solid ${S.bd}`, fontSize: 14, lineHeight: 1.6 }}>
            <b style={{ display: "block", marginBottom: 4 }}>Install it as an app</b>
            {installEvt
              ? <><span style={{ color: S.dim }}>Full screen, its own icon, works offline.</span><button onClick={() => void installEvt.prompt()} style={{ display: "block", marginTop: 10, padding: "10px 20px", borderRadius: 999, border: 0, background: S.fg, color: S.bg, fontWeight: 700 }}>Install</button></>
              : ios ? <span style={{ color: S.dim }}>In Safari tap <b>Share</b> → <b>Add to Home Screen</b>. Then open it from your home screen.</span>
              : <span style={{ color: S.dim }}>Use your browser menu → <b>Install app</b> / <b>Add to Home screen</b>.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
