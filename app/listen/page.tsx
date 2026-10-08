"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// "My Music" launcher: the page the installed app opens. First run: paste your
// player link once; it is remembered on this phone and playback starts from it.
// "Sign out" inside the player forgets it again so a different link can be used.
const KEY = "listenLink";

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

  const go = useCallback(async (raw: string) => {
    const tok = tokenFrom(raw);
    if (!tok) { setErr("That doesn't look like a player link."); setState("ask"); return; }
    setState("check"); setErr("");
    try {
      const r = await fetch(`/api/music/version?t=${encodeURIComponent(tok)}`, { cache: "no-store" });
      if (r.status === 404) { setErr("This link isn't valid (or it has been switched off)."); setState("ask"); return; }
      // Any other answer (even offline) is good enough: the player itself handles the rest.
    } catch { /* offline: trust the stored link */ }
    try { localStorage.setItem(KEY, tok); } catch { /* private mode */ }
    window.location.replace(`/player/${tok}`);
  }, []);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/player-sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as unknown as { prompt: () => Promise<void> }); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // ?link=<url or token> (e.g. opened from a message), or the remembered link, else ask.
    const fromUrl = params.get("link");
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (fromUrl) void go(fromUrl);
    else if (saved && params.get("signedout") !== "1") void go(saved);
    else setState("ask");
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once at launch
  }, []);

  async function paste() {
    try { const t = await navigator.clipboard.readText(); setValue(t); if (tokenFrom(t)) void go(t); } catch { setErr("Couldn't read the clipboard — paste the link into the box instead."); }
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
            <button onClick={() => void go(value)} disabled={!value.trim()} style={{ marginTop: 14, width: "100%", height: 54, borderRadius: 999, border: 0, background: S.fg, color: S.bg, fontSize: 17, fontWeight: 700, opacity: value.trim() ? 1 : 0.4 }}>Start listening</button>
            <button onClick={() => void paste()} style={{ marginTop: 10, width: "100%", height: 50, borderRadius: 999, border: `1px solid ${S.bd}`, background: "transparent", color: S.fg, fontSize: 16, fontWeight: 600 }}>Paste from clipboard</button>
            <p style={{ color: S.dim, fontSize: 13, textAlign: "center", marginTop: 18, lineHeight: 1.6 }}>The link is stored only on this phone. You can sign out any time (Settings inside the player) and use a different link.</p>
          </div>
        )}
        {state === "check" && <p style={{ textAlign: "center", color: S.dim }}>Checking link…</p>}

        {!standalone && state === "ask" && (
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
