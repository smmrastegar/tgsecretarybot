"use client";

/* eslint-disable @next/next/no-img-element -- covers come from our own API */

import { use, useCallback, useEffect, useRef, useState } from "react";

// A shared song / album: only these songs, nothing else of the library. A public share opens for anyone; a private one needs a My Music sign-in
// (the viewer's own player link, kept on this device by the app).
type Song = { id: number; title: string | null; artist: string | null; album: string | null; durationS: number | null; hasCover: boolean };
type Share = { kind: string; visibility: "public" | "private"; title: string; tracks: Song[] };

const S = { bg: "#0b0b0f", fg: "#ececf1", dim: "#a1a1aa", card: "rgba(255,255,255,.06)", bd: "rgba(255,255,255,.12)" };

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [share, setShare] = useState<Share | null>(null);
  const [state, setState] = useState<"load" | "ok" | "login" | "gone">("load");
  const [cur, setCur] = useState<number | null>(null);
  const [viewer, setViewer] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);

  const q = viewer ? `?t=${encodeURIComponent(viewer)}` : "";
  const load = useCallback(async () => {
    let t = "";
    try { t = localStorage.getItem("listenLink") ?? ""; } catch { /* private mode */ }
    setViewer(t);
    try {
      const r = await fetch(`/api/music/share/${token}${t ? `?t=${encodeURIComponent(t)}` : ""}`, { cache: "no-store" });
      if (r.status === 401) { setState("login"); return; }
      if (!r.ok) { setState("gone"); return; }
      const j = (await r.json()) as Share;
      setShare(j); setCur(j.tracks[0]?.id ?? null); setState("ok");
    } catch { setState("gone"); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const idx = share && cur != null ? share.tracks.findIndex((t) => t.id === cur) : -1;
  const next = () => { if (share && idx >= 0 && idx < share.tracks.length - 1) setCur(share.tracks[idx + 1]!.id); };
  useEffect(() => {
    const a = audio.current, t = share?.tracks[idx];
    if (!a || !t) return;
    a.load(); void a.play().catch(() => {});
    try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "", artwork: t.hasCover ? [{ src: `/api/music/share/${token}/cover/${t.id}${q}`, sizes: "320x320", type: "image/jpeg" }] : [] }); } catch { /* unsupported */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the song changes
  }, [cur]);

  const now = share?.tracks[idx];
  return (
    <div dir="ltr" lang="en" style={{ minHeight: "100dvh", background: S.bg, color: S.fg, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif', padding: "28px 16px 40px" }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <div style={{ textAlign: "center", color: S.dim, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase" }}>My Music · shared with you</div>

        {state === "load" && <p style={{ textAlign: "center", color: S.dim, marginTop: 60 }}>Opening…</p>}
        {state === "gone" && <p style={{ textAlign: "center", marginTop: 60, fontSize: 17 }}>This link isn’t available any more.</p>}
        {state === "login" && (
          <div style={{ marginTop: 48, textAlign: "center" }}>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>This is a private share</h1>
            <p style={{ color: S.dim, lineHeight: 1.6, margin: "0 0 22px" }}>Sign in to My Music to listen. It only opens these songs — nothing else of the library.</p>
            <a href={`/listen?next=${encodeURIComponent(`/s/${token}`)}`} style={{ display: "block", padding: "15px 0", borderRadius: 999, background: S.fg, color: S.bg, fontWeight: 700, fontSize: 17, textDecoration: "none" }}>Sign in</a>
          </div>
        )}

        {state === "ok" && share && (
          <>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: "18px 0 2px", textAlign: "center" }}>{share.title}</h1>
            <p style={{ color: S.dim, textAlign: "center", margin: "0 0 18px", fontSize: 14 }}>{share.tracks.length === 1 ? "1 song" : `${share.tracks.length} songs`}{share.visibility === "private" ? " · private" : ""}</p>
            {now && (
              <div style={{ textAlign: "center" }}>
                {now.hasCover
                  ? <img src={`/api/music/share/${token}/cover/${now.id}${q}`} alt="" width={240} height={240} style={{ width: 240, height: 240, borderRadius: 18, objectFit: "cover", boxShadow: "0 18px 50px -16px rgba(0,0,0,.9)" }} />
                  : <div style={{ width: 240, height: 240, borderRadius: 18, background: S.card, margin: "0 auto", display: "grid", placeItems: "center", fontSize: 64 }}>♪</div>}
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 16 }}>{now.title ?? "—"}</div>
                <div style={{ color: S.dim, marginTop: 2 }}>{now.artist}</div>
                <audio ref={audio} controls autoPlay playsInline preload="auto" onEnded={next} style={{ width: "100%", marginTop: 16 }}>
                  <source src={`/api/music/share/${token}/stream/${now.id}${q}`} />
                </audio>
              </div>
            )}
            {share.tracks.length > 1 && (
              <ol style={{ listStyle: "none", margin: "22px 0 0", padding: 0, borderTop: `1px solid ${S.bd}` }}>
                {share.tracks.map((t, i) => (
                  <li key={t.id}>
                    <button onClick={() => setCur(t.id)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center", padding: "12px 4px", background: "transparent", border: 0, borderBottom: `1px solid ${S.bd}`, color: t.id === cur ? "#fff" : S.fg, cursor: "pointer" }}>
                      <span style={{ width: 22, color: S.dim, fontSize: 13, textAlign: "right" }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: t.id === cur ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title ?? "—"}</span><span style={{ display: "block", color: S.dim, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</span></span>
                      {t.id === cur && <span aria-hidden>▶</span>}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
