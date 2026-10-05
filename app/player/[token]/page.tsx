"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MusicStats from "@/components/music/Stats";
import { ChevronDownIcon, HeartIcon, InfoIcon, MoonIcon, MoreIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, SparkIcon, SunIcon, ThumbDownIcon, VolumeIcon } from "@/components/music/Icons";
import Spectrum from "@/components/music/Spectrum";
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

// No cover: a tile tinted from the track id with the title's first letter.
function Tile({ t, className = "" }: { t: { id: number; title: string | null }; className?: string }) {
  const hue = (t.id * 47) % 360;
  return (
    <span className={`grid place-items-center w-full h-full font-bold ${className}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 60% 22%))`, color: "rgba(255,255,255,.85)" }}>
      {(t.title ?? "♪").trim().charAt(0).toUpperCase() || "♪"}
    </span>
  );
}

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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("player.theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
      else if (window.matchMedia("(prefers-color-scheme: light)").matches) setTheme("light");
    } catch { /* storage blocked: stay dark */ }
  }, []);
  const flipTheme = () => setTheme((t) => { const n = t === "dark" ? "light" : "dark"; try { localStorage.setItem("player.theme", n); } catch {} return n; });
  const accent = theme === "dark" ? "255,255,255" : "24,24,32";
  const vars: Record<string, string> = theme === "dark"
    ? { "--acfg": "#0b0b10", "--bg": "#07070b", "--bg2": "#0d0d13", "--fg": "#ececf1", "--s0": "rgba(255,255,255,.03)", "--s1": "rgba(255,255,255,.05)", "--s2": "rgba(255,255,255,.10)", "--bd": "rgba(255,255,255,.10)", "--bd0": "rgba(255,255,255,.05)", "--dim": "#a1a1aa", "--dim2": "#d4d4d8", "--dim3": "#71717a", "--glass": "rgba(18,18,24,.72)", "--amb": ".30" }
    : { "--acfg": "#ffffff", "--bg": "#f5f5f8", "--bg2": "#ffffff", "--fg": "#16161d", "--s0": "rgba(0,0,0,.025)", "--s1": "rgba(0,0,0,.05)", "--s2": "rgba(0,0,0,.09)", "--bd": "rgba(0,0,0,.12)", "--bd0": "rgba(0,0,0,.06)", "--dim": "#52525b", "--dim2": "#3f3f46", "--dim3": "#71717a", "--glass": "rgba(255,255,255,.78)", "--amb": ".16" };
  const audio = useRef<HTMLAudioElement>(null);
  const history = useRef<number[]>([]);
  const tracker = useListenTracker(tq);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

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
    const t = byIdRef.current.get(cur);
    if ("mediaSession" in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "",
        artwork: t.hasCover ? [{ src: `/api/music/cover/${t.id}?${tq}`, sizes: "640x640", type: "image/jpeg" }] : [],
      });
    }
  }, [cur, tq, tracker]);

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

  if (denied) return <div dir="ltr" style={{ background: "#07070b", color: "#71717a", minHeight: "100dvh" }} className="grid place-items-center text-sm">This link is not valid.</div>;

  const pill = (on: boolean) => `text-[13px] px-4 py-2 rounded-full whitespace-nowrap transition ${on ? "bg-[rgb(var(--ac))] text-[var(--acfg)] font-semibold shadow-[0_6px_18px_-8px_rgba(0,0,0,.5)]" : "bg-[var(--s1)] text-[var(--dim2)] hover:bg-[var(--s2)]"}`;

  return (
    <div dir="ltr" style={{ ["--ac" as string]: accent, ...vars, background: "var(--bg)", color: "var(--fg)", minHeight: "100dvh", fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', letterSpacing: "-0.01em" }} className="relative overflow-x-hidden">
      <style>{`
        @keyframes eq { 0%,100% { height: 25% } 50% { height: 100% } }
        @keyframes spin-slow { to { transform: rotate(360deg) } }
        @keyframes rise { from { transform: translateY(100%) } to { transform: none } }
        input[type=range] { accent-color: rgb(var(--ac)); }
        .glass { background: var(--glass); backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4); }
      `}</style>

      {/* ambient background from the playing cover */}
      <div className="fixed inset-0 pointer-events-none -z-0">
        {now?.hasCover && <img src={cover(now)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[var(--amb)] blur-3xl scale-125 transition-opacity duration-700" />}
        <div className="absolute inset-0" style={{ background: "radial-gradient(900px 500px at 80% -10%, rgba(var(--ac),.10), transparent 60%), linear-gradient(180deg, color-mix(in srgb, var(--bg) 55%, transparent), var(--bg) 70%)" }} />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 pt-6 pb-56">
        <header className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ textShadow: "none" }}>My Music</h1>
          <div className="flex items-center gap-2">
          <button onClick={flipTheme} className="w-10 h-10 rounded-full bg-[var(--s1)] grid place-items-center text-lg" aria-label="Toggle theme">{theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}</button>
          <div className="flex gap-1 p-1 rounded-full bg-[var(--s1)]">
            <button onClick={() => setTab("songs")} className={pill(tab === "songs")}>Songs</button>
            <button onClick={() => setTab("stats")} className={pill(tab === "stats")}>Stats</button>
          </div>
          </div>
        </header>

        {tab === "stats" ? <MusicStats tq={tq} lang="en" /> : (
          <>
            <div className="flex gap-3 mb-5">
              <button onClick={() => visible[0] && playTrack(visible[0].id)} disabled={!visible.length} className="flex-1 py-3.5 rounded-2xl font-bold text-[var(--acfg)] disabled:opacity-40 active:scale-[.98] transition" style={{ background: "linear-gradient(135deg, rgb(var(--ac)), rgba(var(--ac),.65))", boxShadow: "0 10px 28px -12px rgba(0,0,0,.5)" }}><span className="inline-flex items-center justify-center gap-2"><PlayIcon size={18} /> Play all</span></button>
              <button onClick={smartMix} disabled={!visible.length} className={`flex-1 py-3.5 rounded-2xl font-bold border active:scale-[.98] transition disabled:opacity-40 ${mixOn ? "border-[rgb(var(--ac))] text-[rgb(var(--ac))] bg-[rgba(var(--ac),.1)]" : "border-[var(--bd)] bg-[var(--s1)]"}`}><span className="inline-flex items-center justify-center gap-2"><SparkIcon size={18} /> Smart mix</span></button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 [scrollbar-width:none]">
              <button onClick={() => setView("all")} className={pill(view === "all")}>All · {tracks.length}</button>
              <button onClick={() => setView("liked")} className={pill(view === "liked")}><span className="inline-flex items-center gap-1.5"><HeartIcon size={14} filled /> Liked · {tracks.filter((t) => t.rating > 0).length}</span></button>
              {playlists.map((p) => <button key={p.id} onClick={() => setView(p.id)} className={pill(view === p.id)}>{p.name}</button>)}
            </div>

            <div className="relative mb-4">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, artists, albums…" className="w-full rounded-2xl bg-[var(--s1)] border border-[var(--bd)] px-4 py-3 text-sm outline-none focus:border-[rgb(var(--ac))] transition" />
            </div>

            <div className="flex flex-col gap-2">
              {visible.length === 0 && <div className="text-sm text-[var(--dim3)] py-16 text-center">No songs.</div>}
              {visible.map((t) => {
                const active = cur === t.id;
                return (
                  <div key={t.id} className={`group flex items-center gap-3 p-2.5 rounded-2xl border transition ${t.rating < 0 ? "opacity-40" : ""} ${active ? "border-[rgba(var(--ac),.6)] bg-[rgba(var(--ac),.12)]" : "border-[var(--bd0)] bg-[var(--s0)] hover:bg-[var(--s2)]"}`}>
                    <button onClick={() => playTrack(t.id)} className="relative w-14 h-14 rounded-xl overflow-hidden bg-[var(--s2)] shrink-0 shadow-lg">
                      {t.hasCover ? <img src={cover(t)} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Tile t={t} className="text-xl" />}
                      {active && <span className="absolute inset-0 grid place-items-center bg-black/45"><Eq on={playing} /></span>}
                    </button>
                    <button onClick={() => playTrack(t.id)} className="min-w-0 flex-1 text-left">
                      <div className={`text-[15px] font-semibold truncate ${active ? "text-[rgb(var(--ac))]" : ""}`}>{t.title ?? "—"}</div>
                      <div className="text-xs text-[var(--dim)] truncate mt-0.5">{t.artist}{t.durationS ? ` · ${fmt(t.durationS)}` : ""}</div>
                    </button>
                    <button onClick={() => void rate(t, 1)} className={`p-2 transition ${t.rating > 0 ? "text-rose-500 scale-110" : "text-[var(--dim3)] hover:text-[var(--fg)]"}`} aria-label="Like"><HeartIcon size={22} filled={t.rating > 0} /></button>
                    <button onClick={() => setDetailId(t.id)} className="p-2 text-[var(--dim)] hover:text-[var(--fg)]" aria-label="Details"><MoreIcon size={22} /></button>
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
        <div className="fixed bottom-3 inset-x-3 z-30 max-w-3xl mx-auto glass rounded-3xl border border-[var(--bd)] shadow-2xl overflow-hidden" style={{ boxShadow: "0 20px 50px -15px rgba(0,0,0,.45)" }}>
          <div className="flex items-center gap-3 p-2.5 pb-1">
            <button onClick={() => setFull(true)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
              <span className="w-12 h-12 rounded-xl overflow-hidden bg-[var(--s2)] shrink-0">
                {now.hasCover ? <img src={cover(now)} alt="" className="w-full h-full object-cover" /> : <Tile t={now} />}
              </span>
              <span className="min-w-0"><span className="block text-sm font-semibold truncate">{now.title}</span><span className="block text-xs text-[var(--dim)] truncate">{now.artist}</span></span>
            </button>
            <button onClick={() => void rate(now, 1)} className={`p-2 ${now.rating > 0 ? "text-rose-500" : "text-[var(--dim3)]"}`} aria-label="Like"><HeartIcon size={22} filled={now.rating > 0} /></button>
            <button onClick={toggle} className="w-12 h-12 rounded-full grid place-items-center text-[var(--acfg)] shrink-0 active:scale-95 transition" style={{ background: "rgb(var(--ac))" }} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon size={22} /> : <PlayIcon size={22} className="translate-x-[1px]" />}</button>
            <button onClick={() => step(1)} className="p-2" aria-label="Next"><NextIcon size={24} /></button>
          </div>
          <Spectrum audio={audio} playing={playing} bars={40} height={26} rgb={theme === "dark" ? "255,255,255" : "24,24,32"} className="px-3" />
          <div className="flex items-center gap-2 px-3 pb-2" dir="ltr">
            <span className="text-[11px] tabular-nums w-9 text-right text-[var(--dim)]">{fmt(pos)}</span>
            <input type="range" min={0} max={dur || 1} step={1} value={Math.min(pos, dur || 1)} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} className="flex-1 h-1.5" />
            <span className="text-[11px] tabular-nums w-9 text-[var(--dim)]">{fmt(dur || now.durationS || 0)}</span>
          </div>
        </div>
      )}

      {/* full now-playing */}
      {now && full && (
        <div className="fixed inset-0 z-40 overflow-y-auto" style={{ animation: "rise .28s ease-out", background: "var(--bg)" }}>
          {now.hasCover && <img src={cover(now)} alt="" className="fixed inset-0 w-full h-full object-cover opacity-[var(--amb)] blur-3xl scale-125" />}
          <div className="fixed inset-0" style={{ background: "radial-gradient(800px 500px at 50% 0%, rgba(var(--ac),.12), transparent 60%), linear-gradient(180deg, color-mix(in srgb, var(--bg) 30%, transparent), var(--bg) 85%)" }} />
          <div className="relative max-w-md mx-auto px-6 pt-4 pb-10 min-h-full flex flex-col">
            <div className="flex items-center justify-between">
              <button onClick={() => setFull(false)} className="p-2" aria-label="Close"><ChevronDownIcon size={28} /></button>
              <div className="text-xs tracking-widest text-[var(--dim)]">{mixOn ? "SMART MIX" : "NOW PLAYING"}</div>
              <button onClick={() => setDetailId(now.id)} className="p-2" aria-label="Details"><InfoIcon size={26} /></button>
            </div>

            <div className="relative mt-6 mx-auto w-full aspect-square max-w-[22rem] rounded-[2rem] overflow-hidden bg-[var(--s2)] transition-transform duration-500"
              style={{ transform: playing ? "scale(1)" : "scale(.93)", boxShadow: "0 40px 80px -20px rgba(0,0,0,.55), 0 0 0 1px rgba(128,128,128,.12)" }}>
              {now.hasCover ? <img src={cover(now)} alt="" className="w-full h-full object-cover" /> : <Tile t={now} className="text-8xl" />}
              {/* neutral, translucent spectrum laid over the artwork's lower edge */}
              <div className="absolute inset-x-0 bottom-0 h-24 pointer-events-none" style={{ background: "linear-gradient(0deg, rgba(0,0,0,.45), transparent)" }}>
                <Spectrum audio={audio} playing={playing} bars={36} height={88} rgb="255,255,255" className="px-3" />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-extrabold truncate">{now.title}</div>
                <div className="text-base text-[var(--dim2)] truncate">{now.artist}</div>
                {now.album && <div className="text-xs text-[var(--dim3)] truncate mt-0.5">{now.album}</div>}
              </div>
              <button onClick={() => void rate(now, 1)} className={`p-2 transition ${now.rating > 0 ? "text-rose-500 scale-110" : "text-[var(--dim3)]"}`} aria-label="Like"><HeartIcon size={30} filled={now.rating > 0} /></button>
              <button onClick={() => void rate(now, -1)} className={`p-2 transition ${now.rating < 0 ? "text-amber-400 scale-110" : "text-[var(--dim3)]"}`} aria-label="Dislike"><ThumbDownIcon size={28} filled={now.rating < 0} /></button>
            </div>

            <div className="mt-5" dir="ltr">
              <input type="range" min={0} max={dur || 1} step={1} value={Math.min(pos, dur || 1)} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} className="w-full h-2" />
              <div className="flex justify-between text-sm tabular-nums text-[var(--dim2)] mt-1"><span>{fmt(pos)}</span><span>{fmt(dur || now.durationS || 0)}</span></div>
            </div>

            <div className="mt-4 flex items-center justify-between" dir="ltr">
              <button onClick={() => setShuffle((s) => !s)} className={`p-2 ${shuffle ? "text-[rgb(var(--ac))]" : "text-[var(--dim3)]"}`} aria-label="Shuffle"><ShuffleIcon size={26} /></button>
              <button onClick={() => step(-1)} className="p-2" aria-label="Previous"><PrevIcon size={36} /></button>
              <button onClick={toggle} className="w-20 h-20 rounded-full grid place-items-center text-[var(--acfg)] active:scale-95 transition" style={{ background: "rgb(var(--ac))", boxShadow: "0 12px 36px -10px rgba(0,0,0,.5)" }} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon size={38} /> : <PlayIcon size={38} className="translate-x-[2px]" />}</button>
              <button onClick={() => step(1)} className="p-2" aria-label="Next"><NextIcon size={36} /></button>
              <button onClick={() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))} className={`p-2 ${repeat !== "off" ? "text-[rgb(var(--ac))]" : "text-[var(--dim3)]"}`} aria-label="Repeat"><RepeatIcon size={26} one={repeat === "one"} /></button>
            </div>

            <div className="mt-5 flex items-center gap-3" dir="ltr">
              <VolumeIcon size={20} low className="text-[var(--dim)]" />
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audio.current) audio.current.volume = v; }} className="flex-1" />
              <VolumeIcon size={20} className="text-[var(--dim)]" />
            </div>

            {upNext.length > 0 && (
              <div className="mt-6">
                <div className="text-xs text-[var(--dim)] mb-2">Up next</div>
                {upNext.map((t) => (
                  <button key={t.id} onClick={() => setCur(t.id)} className="w-full flex items-center gap-3 py-2 text-left border-b border-[var(--bd0)]">
                    <span className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--s2)] shrink-0">{t.hasCover ? <img src={cover(t)} alt="" className="w-full h-full object-cover" /> : <Tile t={t} />}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm truncate">{t.title}</span><span className="block text-xs text-[var(--dim3)] truncate">{t.artist}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {detailId != null && byId.get(detailId) && <TrackDetail lang="en" dark t={byId.get(detailId)!} tq={tq} onClose={() => setDetailId(null)} onRate={(r) => void rate(byId.get(detailId)!, r)} live={detailId === cur ? { pos, dur, playing } : null} />}
    </div>
  );
}
