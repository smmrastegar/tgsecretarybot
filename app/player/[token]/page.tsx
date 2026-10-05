"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MusicStats from "@/components/music/Stats";
import TrackDetail from "@/components/music/TrackDetail";
import { useListenTracker } from "@/components/music/useListenTracker";

// Private personal player. The URL's 256-bit token is the credential.
// Mobile-first: a glass mini player that expands into a full "now
// playing" screen with big artwork tinted by the cover's own colour.

type Track = {
  id: number; title: string | null; artist: string | null; album: string | null; durationS: number | null;
  hasCover: boolean; status: string; rating: number; playCount: number; skipCount: number; lastPlayedAt: string | null;
  releaseDate: string | null; mime: string | null; readyAt: string | null; createdAt: string; listenSeconds: number; sizeBytes: number | null;
};
type Playlist = { id: number; name: string; trackIds: number[] };

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const DEFAULT_ACCENT = "29,185,84";

function Eq({ on }: { on: boolean }) {
  return (
    <span className="inline-flex items-end gap-[2px] h-4 w-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] rounded-sm bg-[rgb(var(--ac))]" style={{ height: on ? undefined : "30%", animation: on ? `eq 0.9s ${i * 0.18}s ease-in-out infinite` : undefined }} />
      ))}
    </span>
  );
}

export default function PlayerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const tq = `t=${encodeURIComponent(token)}`;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<"all" | "liked" | number>("all");
  const [q, setQ] = useState("");
  const [queue, setQueue] = useState<number[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [vol, setVol] = useState(1);
  const [mixOn, setMixOn] = useState(false);
  const [tab, setTab] = useState<"songs" | "stats">("songs");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const audio = useRef<HTMLAudioElement>(null);
  const history = useRef<number[]>([]);
  const tracker = useListenTracker(tq);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/music?${tq}`, { cache: "no-store" });
    if (r.status === 404) { setDenied(true); return; }
    if (!r.ok) return;
    const j = (await r.json()) as { tracks: Track[]; playlists: Playlist[] };
    setTracks(j.tracks.filter((t) => t.status === "ready")); setPlaylists(j.playlists);
  }, [tq]);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    let list = tracks;
    if (view === "liked") list = tracks.filter((t) => t.rating > 0);
    else if (view !== "all") list = (playlists.find((p) => p.id === view)?.trackIds ?? []).map((id) => byId.get(id)).filter((t): t is Track => !!t);
    const s = q.trim().toLowerCase();
    return s ? list.filter((t) => `${t.title ?? ""} ${t.artist ?? ""} ${t.album ?? ""}`.toLowerCase().includes(s)) : list;
  }, [tracks, playlists, view, q, byId]);

  const playTrack = useCallback((id: number) => {
    const ids = visible.map((t) => t.id);
    setQueue(shuffle ? [id, ...ids.filter((x) => x !== id).sort(() => Math.random() - 0.5)] : ids);
    setMixOn(false); history.current = []; setCur(id);
  }, [visible, shuffle]);

  const smartMix = useCallback(() => {
    const now = Date.now();
    const pool = visible.filter((t) => t.rating >= 0).map((t) => {
      const recent = t.lastPlayedAt && now - Date.parse(t.lastPlayedAt.replace(" ", "T")) < 86400000 ? 0.3 : 1;
      const w = ((t.rating > 0 ? 3 : 1) * recent) / (1 + t.skipCount * 0.4);
      return { id: t.id, key: Math.pow(Math.random(), 1 / Math.max(w, 0.05)) };
    }).sort((a, b) => b.key - a.key);
    if (pool.length === 0) return;
    const ids = pool.map((p) => p.id);
    setQueue(ids); setMixOn(true); history.current = []; setCur(ids[0]!);
  }, [visible]);

  const step = useCallback((dir: 1 | -1, auto = false) => {
    if (cur == null || queue.length === 0) return;
    const a = audio.current;
    if (dir === -1 && !auto) {
      if (a && a.currentTime > 3) { a.currentTime = 0; return; }
      const back = history.current.pop();
      if (back != null) { setCur(back); return; }
    }
    if (auto && repeat === "one") { if (a) { a.currentTime = 0; void a.play(); } return; }
    const i = queue.indexOf(cur); let n = i + dir;
    if (n >= queue.length) { if (repeat === "all" || !auto) n = 0; else { setPlaying(false); return; } }
    if (n < 0) n = queue.length - 1;
    if (dir === 1) history.current.push(cur);
    setCur(queue[n]!);
  }, [cur, queue, repeat]);

  async function rate(t: Track, r: number) {
    const next = t.rating === r ? 0 : r;
    setTracks((all) => all.map((x) => (x.id === t.id ? { ...x, rating: next } : x)));
    await fetch(`/api/music/${t.id}/rate?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: next }) });
    if (next < 0 && cur === t.id) step(1);
  }

  // Load + media session + accent colour from the cover.
  useEffect(() => {
    const a = audio.current; if (!a || cur == null) return;
    tracker.begin(cur);
    a.src = `/api/music/stream/${cur}?${tq}`; void a.play().catch(() => {});
    const t = byId.get(cur);
    if ("mediaSession" in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "",
        artwork: t.hasCover ? [{ src: `/api/music/cover/${t.id}?${tq}`, sizes: "640x640", type: "image/jpeg" }] : [],
      });
    }
    setAccent(DEFAULT_ACCENT);
    if (t?.hasCover) {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = c.height = 8;
          const x = c.getContext("2d"); if (!x) return;
          x.drawImage(img, 0, 0, 8, 8);
          const d = x.getImageData(0, 0, 8, 8).data;
          let best = [29, 185, 84], score = -1;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx === 0 ? 0 : (mx - mn) / mx, val = mx / 255;
            const sc = sat * (0.4 + val) * (val > 0.25 ? 1 : 0.3);
            if (sc > score) { score = sc; best = [r, g, b]; }
          }
          // keep it bright enough to read on a dark background
          const k = Math.max(1, 150 / Math.max(...best));
          setAccent(best.map((v) => Math.min(255, Math.round(v * k))).join(","));
        } catch { /* cross-origin or canvas blocked: keep default */ }
      };
      img.src = `/api/music/cover/${t.id}?${tq}`;
    }
  }, [cur, byId, tq, tracker]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
    navigator.mediaSession.setActionHandler("play", () => void audio.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.current?.pause());
  }, [step]);

  const now = cur != null ? byId.get(cur) : null;
  const upNext = useMemo(() => {
    if (cur == null) return [];
    const i = queue.indexOf(cur);
    return queue.slice(i + 1, i + 6).map((id) => byId.get(id)).filter((t): t is Track => !!t);
  }, [cur, queue, byId]);
  const toggle = () => (playing ? audio.current?.pause() : void audio.current?.play());
  const cover = (t: Track) => `/api/music/cover/${t.id}?${tq}`;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  if (denied) return <div dir="rtl" style={{ background: "#07070b", color: "#71717a", minHeight: "100dvh" }} className="grid place-items-center text-sm">این لینک معتبر نیست.</div>;

  const pill = (on: boolean) => `text-[13px] px-4 py-2 rounded-full whitespace-nowrap transition ${on ? "bg-[rgb(var(--ac))] text-black font-semibold shadow-[0_0_24px_-4px_rgb(var(--ac))]" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`;

  return (
    <div dir="rtl" style={{ ["--ac" as string]: accent, background: "#07070b", color: "#ececf1", minHeight: "100dvh", fontFamily: "Vazirmatn, -apple-system, system-ui, sans-serif" }} className="relative overflow-x-hidden">
      <style>{`
        @keyframes eq { 0%,100% { height: 25% } 50% { height: 100% } }
        @keyframes spin-slow { to { transform: rotate(360deg) } }
        @keyframes rise { from { transform: translateY(100%) } to { transform: none } }
        input[type=range] { accent-color: rgb(var(--ac)); }
        .glass { background: rgba(18,18,24,.72); backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4); }
      `}</style>

      {/* ambient background from the playing cover */}
      <div className="fixed inset-0 pointer-events-none -z-0">
        {now?.hasCover && <img src={cover(now)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-3xl scale-125 transition-opacity duration-700" />}
        <div className="absolute inset-0" style={{ background: "radial-gradient(900px 500px at 80% -10%, rgba(var(--ac),.28), transparent 60%), linear-gradient(180deg, rgba(7,7,11,.55), #07070b 70%)" }} />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 pt-6 pb-40">
        <header className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ textShadow: "0 0 30px rgba(var(--ac),.5)" }}>🎧 موزیک من</h1>
          <div className="flex gap-1 p-1 rounded-full bg-white/5">
            <button onClick={() => setTab("songs")} className={pill(tab === "songs")}>آهنگ‌ها</button>
            <button onClick={() => setTab("stats")} className={pill(tab === "stats")}>آمار</button>
          </div>
        </header>

        {tab === "stats" ? <MusicStats tq={tq} /> : (
          <>
            <div className="flex gap-3 mb-5">
              <button onClick={() => visible[0] && playTrack(visible[0].id)} disabled={!visible.length} className="flex-1 py-3.5 rounded-2xl font-bold text-black disabled:opacity-40 active:scale-[.98] transition" style={{ background: "linear-gradient(135deg, rgb(var(--ac)), rgba(var(--ac),.65))", boxShadow: "0 10px 30px -10px rgb(var(--ac))" }}>▶ پخش همه</button>
              <button onClick={smartMix} disabled={!visible.length} className={`flex-1 py-3.5 rounded-2xl font-bold border active:scale-[.98] transition disabled:opacity-40 ${mixOn ? "border-[rgb(var(--ac))] text-[rgb(var(--ac))] bg-[rgba(var(--ac),.1)]" : "border-white/15 bg-white/5"}`}>🎲 ترکیب هوشمند</button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 [scrollbar-width:none]">
              <button onClick={() => setView("all")} className={pill(view === "all")}>همه · {tracks.length}</button>
              <button onClick={() => setView("liked")} className={pill(view === "liked")}>❤️ لایک‌ها · {tracks.filter((t) => t.rating > 0).length}</button>
              {playlists.map((p) => <button key={p.id} onClick={() => setView(p.id)} className={pill(view === p.id)}>{p.name}</button>)}
            </div>

            <div className="relative mb-4">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی آهنگ، خواننده، آلبوم…" className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-[rgb(var(--ac))] transition" />
            </div>

            <div className="flex flex-col gap-2">
              {visible.length === 0 && <div className="text-sm text-zinc-500 py-16 text-center">آهنگی نیست.</div>}
              {visible.map((t) => {
                const active = cur === t.id;
                return (
                  <div key={t.id} className={`group flex items-center gap-3 p-2.5 rounded-2xl border transition ${t.rating < 0 ? "opacity-40" : ""} ${active ? "border-[rgba(var(--ac),.6)] bg-[rgba(var(--ac),.12)]" : "border-white/5 bg-white/[.03] hover:bg-white/[.07]"}`}>
                    <button onClick={() => playTrack(t.id)} className="relative w-14 h-14 rounded-xl overflow-hidden bg-zinc-800 shrink-0 shadow-lg">
                      {t.hasCover ? <img src={cover(t)} alt="" className="w-full h-full object-cover" /> : <span className="grid place-items-center w-full h-full text-2xl">🎵</span>}
                      {active && <span className="absolute inset-0 grid place-items-center bg-black/45"><Eq on={playing} /></span>}
                    </button>
                    <button onClick={() => playTrack(t.id)} className="min-w-0 flex-1 text-right">
                      <div className={`text-[15px] font-semibold truncate ${active ? "text-[rgb(var(--ac))]" : ""}`}>{t.title ?? "—"}</div>
                      <div className="text-xs text-zinc-400 truncate mt-0.5">{t.artist}{t.durationS ? ` · ${fmt(t.durationS)}` : ""}</div>
                    </button>
                    <button onClick={() => void rate(t, 1)} className={`text-xl px-1.5 transition ${t.rating > 0 ? "scale-110" : "opacity-25 hover:opacity-70"}`} aria-label="لایک">❤️</button>
                    <button onClick={() => setDetailId(t.id)} className="text-lg px-1.5 text-zinc-400 hover:text-white" aria-label="جزئیات">⋯</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <audio ref={audio} onTimeUpdate={(e) => { setPos(e.currentTarget.currentTime); tracker.tick(e.currentTarget.currentTime, e.currentTarget.duration); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { tracker.flush(true); step(1, true); }} />

      {/* mini player */}
      {now && !full && (
        <div className="fixed bottom-3 inset-x-3 z-30 max-w-3xl mx-auto glass rounded-3xl border border-white/10 shadow-2xl overflow-hidden" style={{ boxShadow: "0 20px 50px -15px rgba(var(--ac),.45)" }}>
          <div className="h-[3px] bg-white/10"><div className="h-full bg-[rgb(var(--ac))] transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
          <div className="flex items-center gap-3 p-2.5">
            <button onClick={() => setFull(true)} className="flex items-center gap-3 min-w-0 flex-1 text-right">
              <span className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-800 shrink-0" style={{ animation: playing ? undefined : undefined }}>
                {now.hasCover ? <img src={cover(now)} alt="" className="w-full h-full object-cover" /> : <span className="grid place-items-center w-full h-full text-xl">🎵</span>}
              </span>
              <span className="min-w-0"><span className="block text-sm font-semibold truncate">{now.title}</span><span className="block text-xs text-zinc-400 truncate">{now.artist}</span></span>
            </button>
            <button onClick={() => void rate(now, 1)} className={`text-xl px-1 ${now.rating > 0 ? "" : "opacity-30"}`}>❤️</button>
            <button onClick={toggle} className="w-12 h-12 rounded-full grid place-items-center text-xl text-black font-bold shrink-0" style={{ background: "rgb(var(--ac))" }}>{playing ? "⏸" : "▶"}</button>
            <button onClick={() => step(1)} className="text-xl px-1.5">⏭</button>
          </div>
        </div>
      )}

      {/* full now-playing */}
      {now && full && (
        <div className="fixed inset-0 z-40 overflow-y-auto" style={{ animation: "rise .28s ease-out", background: "#07070b" }}>
          {now.hasCover && <img src={cover(now)} alt="" className="fixed inset-0 w-full h-full object-cover opacity-35 blur-3xl scale-125" />}
          <div className="fixed inset-0" style={{ background: "radial-gradient(800px 500px at 50% 0%, rgba(var(--ac),.35), transparent 60%), linear-gradient(180deg, rgba(7,7,11,.3), #07070b 85%)" }} />
          <div className="relative max-w-md mx-auto px-6 pt-4 pb-10 min-h-full flex flex-col">
            <div className="flex items-center justify-between">
              <button onClick={() => setFull(false)} className="text-2xl px-2 py-1" aria-label="بستن">⌄</button>
              <div className="text-xs tracking-widest text-zinc-400">{mixOn ? "ترکیب هوشمند" : "در حال پخش"}</div>
              <button onClick={() => setDetailId(now.id)} className="text-2xl px-2 py-1" aria-label="جزئیات">ⓘ</button>
            </div>

            <div className="mt-6 mx-auto w-full aspect-square max-w-[22rem] rounded-[2rem] overflow-hidden bg-zinc-800 transition-transform duration-500"
              style={{ transform: playing ? "scale(1)" : "scale(.93)", boxShadow: "0 40px 80px -20px rgba(var(--ac),.6), 0 0 0 1px rgba(255,255,255,.06)" }}>
              {now.hasCover ? <img src={cover(now)} alt="" className="w-full h-full object-cover" /> : <span className="grid place-items-center w-full h-full text-7xl">🎵</span>}
            </div>

            <div className="mt-7 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-extrabold truncate">{now.title}</div>
                <div className="text-base text-zinc-300 truncate">{now.artist}</div>
                {now.album && <div className="text-xs text-zinc-500 truncate mt-0.5">{now.album}</div>}
              </div>
              <button onClick={() => void rate(now, 1)} className={`text-3xl transition ${now.rating > 0 ? "scale-110" : "opacity-30"}`} aria-label="لایک">❤️</button>
              <button onClick={() => void rate(now, -1)} className={`text-3xl transition ${now.rating < 0 ? "scale-110" : "opacity-30"}`} aria-label="دیسلایک">👎</button>
            </div>

            <div className="mt-5" dir="ltr">
              <input type="range" min={0} max={dur || 1} step={1} value={pos} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} className="w-full h-2" />
              <div className="flex justify-between text-xs text-zinc-400 mt-1"><span>{fmt(pos)}</span><span>{fmt(dur)}</span></div>
            </div>

            <div className="mt-4 flex items-center justify-between" dir="ltr">
              <button onClick={() => setShuffle((s) => !s)} className={`text-2xl ${shuffle ? "text-[rgb(var(--ac))]" : "text-zinc-500"}`}>🔀</button>
              <button onClick={() => step(-1)} className="text-4xl">⏮</button>
              <button onClick={toggle} className="w-20 h-20 rounded-full grid place-items-center text-4xl text-black active:scale-95 transition" style={{ background: "rgb(var(--ac))", boxShadow: "0 12px 40px -8px rgb(var(--ac))" }}>{playing ? "⏸" : "▶"}</button>
              <button onClick={() => step(1)} className="text-4xl">⏭</button>
              <button onClick={() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))} className={`text-2xl ${repeat !== "off" ? "text-[rgb(var(--ac))]" : "text-zinc-500"}`}>{repeat === "one" ? "🔂" : "🔁"}</button>
            </div>

            <div className="mt-5 flex items-center gap-3" dir="ltr">
              <span className="text-lg">🔈</span>
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audio.current) audio.current.volume = v; }} className="flex-1" />
              <span className="text-lg">🔊</span>
            </div>

            {upNext.length > 0 && (
              <div className="mt-6">
                <div className="text-xs text-zinc-400 mb-2">بعدی در صف</div>
                {upNext.map((t) => (
                  <button key={t.id} onClick={() => setCur(t.id)} className="w-full flex items-center gap-3 py-2 text-right border-b border-white/5">
                    <span className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 shrink-0">{t.hasCover ? <img src={cover(t)} alt="" className="w-full h-full object-cover" /> : <span className="grid place-items-center w-full h-full">🎵</span>}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm truncate">{t.title}</span><span className="block text-xs text-zinc-500 truncate">{t.artist}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {detailId != null && byId.get(detailId) && <TrackDetail dark t={byId.get(detailId)!} tq={tq} onClose={() => setDetailId(null)} onRate={(r) => void rate(byId.get(detailId)!, r)} live={detailId === cur ? { pos, dur, playing } : null} />}
    </div>
  );
}
