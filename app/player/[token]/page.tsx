"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartIcon, ChevronDownIcon, FadeIcon, ShareIcon, HeartIcon, LyricsIcon, HomeIcon, InfoIcon, LibraryIcon, MoonIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon, RepeatIcon, SearchIcon, ShuffleIcon, SunIcon, ThumbDownIcon, TimerIcon, VolumeIcon } from "@/components/music/Icons";
import StatsView from "@/components/music/app/StatsView";
import Spectrum from "@/components/music/Spectrum";
import TrackDetail from "@/components/music/TrackDetail";
import { useListenTracker } from "@/components/music/useListenTracker";
import { Cover, fmt, shareText, trackShareLines, type Playlist, type Track } from "@/components/music/app/shared";
import { artistsOf, DetailView, HomeView, LibraryView, SearchView, useCollections, type Api, type Page } from "@/components/music/app/Views";
import { LyricsSheet, OptionSheet, QueueSheet, TrackMenu } from "@/components/music/app/Sheets";

// Private personal player. The URL's 256-bit token is the credential.
type Tab = "home" | "search" | "library" | "stats";
const SLEEP = [{ v: 0, label: "Off" }, { v: 5, label: "5 minutes" }, { v: 15, label: "15 minutes" }, { v: 30, label: "30 minutes" }, { v: 60, label: "1 hour" }, { v: -1, label: "End of track" }];
const FADES = [{ v: 0, label: "Off" }, { v: 3, label: "3 seconds" }, { v: 6, label: "6 seconds" }, { v: 10, label: "10 seconds" }];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2].map((v) => ({ v, label: v === 1 ? "Normal (1×)" : `${v}×` }));

export default function PlayerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const tq = `t=${encodeURIComponent(token)}`;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Page[]>([]);
  const [queue, setQueue] = useState<number[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [vol, setVol] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [sleepMin, setSleepMin] = useState(0);
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState<null | "queue" | "sleep" | "speed" | "fade" | "lyrics">(null);
  const [menuT, setMenuT] = useState<Track | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState("");
  const [fade, setFade] = useState(0);
  const [offline, setOffline] = useState<Set<number>>(new Set());
  const blobUrl = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("player.theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
      else if (window.matchMedia("(prefers-color-scheme: light)").matches) setTheme("light");
    } catch { /* storage blocked: stay dark */ }
  }, []);
  useEffect(() => {
    try { const f = Number(localStorage.getItem("player.fade")); if ([3, 6, 10].includes(f)) setFade(f); } catch {}
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/player-sw.js", { scope: "/player/" }).catch(() => {});
    if ("caches" in window) void caches.open("player-audio").then((c) => c.keys()).then((ks) => setOffline(new Set(ks.map((k) => Number(new URL(k.url).pathname.split("/").pop())).filter(Number.isFinite)))).catch(() => {});
  }, []);
  const pickFade = (v: number) => { setFade(v); try { localStorage.setItem("player.fade", String(v)); } catch {} };
  const flipTheme = () => setTheme((t) => { const n = t === "dark" ? "light" : "dark"; try { localStorage.setItem("player.theme", n); } catch {} return n; });
  const accent = theme === "dark" ? "255,255,255" : "24,24,32";
  const vars: Record<string, string> = theme === "dark"
    ? { "--acfg": "#0b0b10", "--bg": "#07070b", "--bg2": "#0f0f16", "--fg": "#ececf1", "--s0": "rgba(255,255,255,.03)", "--s1": "rgba(255,255,255,.06)", "--s2": "rgba(255,255,255,.11)", "--bd": "rgba(255,255,255,.12)", "--bd0": "rgba(255,255,255,.06)", "--dim": "#a1a1aa", "--dim2": "#d4d4d8", "--dim3": "#71717a", "--glass": "rgba(24,24,32,.82)", "--amb": ".26" }
    : { "--acfg": "#ffffff", "--bg": "#f5f5f8", "--bg2": "#ffffff", "--fg": "#16161d", "--s0": "rgba(0,0,0,.025)", "--s1": "rgba(0,0,0,.05)", "--s2": "rgba(0,0,0,.09)", "--bd": "rgba(0,0,0,.12)", "--bd0": "rgba(0,0,0,.07)", "--dim": "#52525b", "--dim2": "#3f3f46", "--dim3": "#71717a", "--glass": "rgba(255,255,255,.86)", "--amb": ".14" };

  const audio = useRef<HTMLAudioElement>(null);
  const history = useRef<number[]>([]);
  const tracker = useListenTracker(tq);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const c = useCollections(tracks, playlists, byId);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/music?${tq}`, { cache: "no-store" });
      if (r.status === 404) { setDenied(true); return; }
      if (!r.ok) return;
      const j = (await r.json()) as { tracks: Track[]; playlists: Playlist[] };
      setTracks(j.tracks.filter((t) => t.status === "ready")); setPlaylists(j.playlists);
    } finally { setLoading(false); }
  }, [tq]);
  useEffect(() => { void load(); }, [load]);

  const play = useCallback((ids: number[], startId?: number, sh = false) => {
    if (ids.length === 0) return;
    const start = startId ?? (sh ? ids[Math.floor(Math.random() * ids.length)]! : ids[0]!);
    const doShuffle = sh || shuffle;
    setQueue(doShuffle ? [start, ...ids.filter((x) => x !== start).sort(() => Math.random() - 0.5)] : ids);
    history.current = []; setCur(start); setPlaying(true);
  }, [shuffle]);

  const smartMix = useCallback((ids: number[]) => {
    const now = Date.now();
    const pool = ids.map((id) => byIdRef.current.get(id)).filter((t): t is Track => !!t && t.rating >= 0).map((t) => {
      const recent = t.lastPlayedAt && now - Date.parse(t.lastPlayedAt.replace(" ", "T")) < 86400000 ? 0.3 : 1;
      const w = ((t.rating > 0 ? 3 : 1) * recent) / (1 + t.skipCount * 0.4);
      return { id: t.id, key: Math.pow(Math.random(), 1 / Math.max(w, 0.05)) };
    }).sort((a, b) => b.key - a.key).map((p) => p.id);
    if (pool.length === 0) return;
    setQueue(pool); history.current = []; setCur(pool[0]!); flash("Smart mix started");
  }, []);

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

  const rate = useCallback((t: Track, r: number) => {
    const next = t.rating === r ? 0 : r;
    setTracks((all) => all.map((x) => (x.id === t.id ? { ...x, rating: next } : x)));
    void fetch(`/api/music/${t.id}/rate?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: next }) });
    if (next < 0 && cur === t.id) step(1);
  }, [tq, cur, step]);

  // Queue editing
  const playNext = (id: number) => { setQueue((q) => { const base = q.filter((x) => x !== id); const i = cur != null ? base.indexOf(cur) : -1; base.splice(i + 1, 0, id); return base; }); flash("Playing next"); if (cur == null) { setCur(id); setPlaying(true); } };
  const addQueue = (id: number) => { setQueue((q) => (q.includes(id) ? q : [...q, id])); flash("Added to queue"); if (cur == null) { setQueue([id]); setCur(id); setPlaying(true); } };
  const moveQ = (id: number, d: -1 | 1) => setQueue((q) => { const i = q.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= q.length || q[j] === cur) return q; const n = [...q]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });

  // Load the audio element only when the current track changes. A saved
  // offline copy wins over the network.
  useEffect(() => {
    const a = audio.current; if (!a || cur == null) return;
    let dead = false;
    tracker.begin(cur);
    const start = (src: string) => { if (dead) return; a.src = src; a.playbackRate = speed; void a.play().catch(() => {}); };
    const net = `/api/music/stream/${cur}?${tq}`;
    if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = null; }
    if ("caches" in window) {
      void caches.open("player-audio").then((c) => c.match(`/api/music/stream/${cur}`)).then(async (hit) => {
        if (!hit) return start(net);
        const u = URL.createObjectURL(await hit.blob()); blobUrl.current = u; start(u);
      }).catch(() => start(net));
    } else start(net);
    const t = byIdRef.current.get(cur);
    if ("mediaSession" in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "", artwork: t.hasCover ? [{ src: `/api/music/cover/${t.id}?${tq}`, sizes: "640x640", type: "image/jpeg" }] : [] });
    }
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- speed is applied by its own effect
  }, [cur, tq, tracker]);

  // Warm the HTTP cache with the next track so the hand-over is instant.
  const preload = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (cur == null || offline.size && offline.has(cur)) return;
    const i = queue.indexOf(cur); const nid = queue[i + 1];
    if (nid == null || offline.has(nid)) return;
    const p = preload.current ?? (preload.current = new Audio());
    p.preload = "auto"; p.src = `/api/music/stream/${nid}?${tq}`;
  }, [cur, queue, tq, offline]);

  // Fade out the tail and fade in the head of tracks (volume dip crossfade).
  useEffect(() => {
    const a = audio.current; if (!a) return;
    if (fade <= 0 || !playing) { a.volume = vol; return; }
    const i = setInterval(() => {
      const d = a.duration; if (!Number.isFinite(d) || d < fade * 3) { a.volume = vol; return; }
      const k = Math.min(1, a.currentTime / fade, (d - a.currentTime) / fade);
      a.volume = vol * Math.max(0.02, k);
    }, 100);
    return () => clearInterval(i);
  }, [fade, playing, vol]);

  const share = async (t: Track) => { const m = await shareText(t.title ?? "Song", trackShareLines(t)); if (m) flash(m); };
  const toggleOffline = async (t: Track) => {
    const key = `/api/music/stream/${t.id}`;
    const c = await caches.open("player-audio");
    if (offline.has(t.id)) { await c.delete(key); setOffline((s) => { const n = new Set(s); n.delete(t.id); return n; }); flash("Offline copy removed"); return; }
    flash("Saving for offline…");
    try {
      const r = await fetch(`${key}?${tq}`);
      if (!r.ok || r.status !== 200) throw new Error("bad");
      await c.put(key, r);
      setOffline((s) => new Set(s).add(t.id)); flash("Saved for offline");
    } catch { flash("Could not save"); }
  };
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("nexttrack", () => step(1));
    ms.setActionHandler("previoustrack", () => step(-1));
    ms.setActionHandler("play", () => void audio.current?.play());
    ms.setActionHandler("pause", () => audio.current?.pause());
    ms.setActionHandler("seekto", (d) => { if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime; });
    ms.setActionHandler("seekbackward", () => { if (audio.current) audio.current.currentTime -= 10; });
    ms.setActionHandler("seekforward", () => { if (audio.current) audio.current.currentTime += 10; });
  }, [step]);

  // Sleep timer
  const sleepEnd = useRef(0);
  useEffect(() => {
    if (sleepMin > 0) sleepEnd.current = Date.now() + sleepMin * 60000;
    if (sleepMin <= 0) return;
    const i = setInterval(() => { if (Date.now() >= sleepEnd.current) { audio.current?.pause(); setSleepMin(0); flash("Sleep timer: paused"); } }, 5000);
    return () => clearInterval(i);
  }, [sleepMin]);

  const toggle = useCallback(() => { const a = audio.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); }, []);
  const seek = (v: number) => { if (audio.current) audio.current.currentTime = v; };

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") seek((audio.current?.currentTime ?? 0) + 10);
      else if (e.key === "ArrowLeft") seek((audio.current?.currentTime ?? 0) - 10);
      else if (e.key === "n") step(1);
      else if (e.key === "p") step(-1);
      else if (e.key === "l" && cur != null) { const t = byIdRef.current.get(cur); if (t) rate(t, 1); }
      else if (e.key === "Escape") { if (sheet) setSheet(null); else if (full) setFull(false); else setStack((s) => s.slice(0, -1)); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [toggle, step, rate, cur, sheet, full]);

  const now = cur != null ? byId.get(cur) ?? null : null;
  const api: Api = { tq, tracks, playlists, byId, cur, playing, loading, play, smartMix, menu: setMenuT, rate, open: (p) => setStack((s) => [...s, p]) };
  const cover = (t: Track) => `/api/music/cover/${t.id}?${tq}`;
  const page = stack[stack.length - 1];
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  // Swipe handling on the full-player sheet
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchEnd = (e: React.TouchEvent, target: "sheet" | "art") => {
    const s = touch.current; touch.current = null; if (!s) return;
    const dx = e.changedTouches[0]!.clientX - s.x, dy = e.changedTouches[0]!.clientY - s.y;
    if (target === "sheet" && dy > 110 && Math.abs(dx) < 70) setFull(false);
    if (target === "art" && Math.abs(dx) > 70 && Math.abs(dy) < 60) step(dx < 0 ? 1 : -1);
  };

  if (denied) return <div dir="ltr" style={{ background: "#07070b", color: "#71717a", minHeight: "100dvh" }} className="grid place-items-center text-sm">This link is not valid.</div>;

  const tabs: { k: Tab; label: string; icon: React.ReactNode }[] = [
    { k: "home", label: "Home", icon: <HomeIcon size={24} filled={tab === "home"} /> },
    { k: "search", label: "Search", icon: <SearchIcon size={24} /> },
    { k: "library", label: "Library", icon: <LibraryIcon size={24} /> },
    { k: "stats", label: "Stats", icon: <ChartIcon size={24} /> },
  ];
  const goTab = (k: Tab) => { setTab(k); setStack([]); window.scrollTo({ top: 0 }); };
  const upNextCount = cur != null ? Math.max(0, queue.length - queue.indexOf(cur) - 1) : 0;

  return (
    <div dir="ltr" lang="en" style={{ ["--ac" as string]: accent, ...vars, background: "var(--bg)", color: "var(--fg)", minHeight: "100dvh", fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', letterSpacing: "-0.01em" }} className="relative overflow-x-hidden">
      <style>{`
        @keyframes eq { 0%,100% { height: 25% } 50% { height: 100% } }
        @keyframes rise { from { transform: translateY(100%) } to { transform: none } }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        input[type=range] { accent-color: rgb(var(--ac)); }
        .glass { background: var(--glass); backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4); }
        button { -webkit-tap-highlight-color: transparent; }
        button:focus-visible, input:focus-visible { outline: 2px solid rgb(var(--ac)); outline-offset: 2px; }
      `}</style>

      <div className="relative max-w-2xl mx-auto px-4 pt-[max(14px,env(safe-area-inset-top))]" style={{ paddingBottom: now ? 168 : 96 }}>
        <header className="flex items-center justify-between h-12 mb-2">
          {page ? (
            <button onClick={() => setStack((s) => s.slice(0, -1))} className="flex items-center gap-1 -ml-2 px-2 py-2 text-[15px]"><ChevronDownIcon size={22} className="rotate-90" />Back</button>
          ) : (
            <h1 className="text-[28px] font-extrabold tracking-tight">{tab === "home" ? greeting() : tab === "search" ? "Search" : tab === "library" ? "Your Library" : "Stats"}</h1>
          )}
          <button onClick={flipTheme} className="w-10 h-10 rounded-full bg-[var(--s1)] grid place-items-center" aria-label="Toggle theme">{theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}</button>
        </header>

        {page ? <DetailView page={page} api={api} c={c} />
          : tab === "home" ? <HomeView api={api} c={c} />
          : tab === "search" ? <SearchView api={api} c={c} />
          : tab === "library" ? <LibraryView api={api} c={c} />
          : <StatsView api={api} />}
      </div>

      <audio ref={audio} onTimeUpdate={(e) => { setPos(e.currentTarget.currentTime); tracker.tick(e.currentTarget.currentTime, e.currentTarget.duration); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { tracker.flush(true); if (sleepMin === -1) { setSleepMin(0); setPlaying(false); flash("Sleep timer: paused"); return; } step(1, true); }} />

      {/* mini player */}
      {now && !full && (
        <div className="fixed inset-x-2 z-30 max-w-2xl mx-auto glass rounded-2xl border border-[var(--bd)] overflow-hidden" style={{ bottom: "calc(66px + env(safe-area-inset-bottom))", boxShadow: "0 12px 34px -14px rgba(0,0,0,.5)" }}>
          <div className="flex items-center gap-3 p-2">
            <button onClick={() => setFull(true)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label="Open player">
              <Cover t={now} tq={tq} size={44} radius={8} />
              <span className="min-w-0"><span className="block text-[14px] font-semibold truncate">{now.title}</span><span className="block text-xs text-[var(--dim)] truncate">{now.artist}</span></span>
            </button>
            <button onClick={() => rate(now, 1)} className={`p-2 ${now.rating > 0 ? "text-rose-500" : "text-[var(--dim)]"}`} aria-label="Like"><HeartIcon size={22} filled={now.rating > 0} /></button>
            <button onClick={toggle} className="w-10 h-10 grid place-items-center" aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon size={28} /> : <PlayIcon size={28} />}</button>
            <button onClick={() => step(1)} className="p-2 -mr-1" aria-label="Next"><NextIcon size={24} /></button>
          </div>
          <div className="h-[3px] bg-[var(--s2)]"><div className="h-full bg-[rgb(var(--ac))]" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {/* tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-20 glass border-t border-[var(--bd0)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {tabs.map((x) => (
            <button key={x.k} onClick={() => goTab(x.k)} className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] ${tab === x.k ? "text-[var(--fg)] font-semibold" : "text-[var(--dim3)]"}`} aria-current={tab === x.k}>{x.icon}{x.label}</button>
          ))}
        </div>
      </nav>

      {/* full screen player */}
      {now && full && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--bg)", animation: "rise .25s ease-out" }} onTouchStart={(e) => { touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }} onTouchEnd={(e) => onTouchEnd(e, "sheet")}>
          {now.hasCover && <img src={cover(now)} alt="" className="fixed inset-0 w-full h-full object-cover blur-3xl scale-125 pointer-events-none" style={{ opacity: "var(--amb)" }} />}
          <div className="relative max-w-md mx-auto px-6 pt-[max(14px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] h-full min-h-[520px] flex flex-col">
            <div className="flex items-center justify-between h-11 shrink-0">
              <button onClick={() => setFull(false)} className="p-2 -ml-2" aria-label="Minimise"><ChevronDownIcon size={28} /></button>
              <span className="text-xs uppercase tracking-widest text-[var(--dim)]">Now playing</span>
              <span className="flex items-center"><button onClick={() => void share(now)} className="p-2" aria-label="Share"><ShareIcon size={22} /></button><button onClick={() => setDetailId(now.id)} className="p-2 -mr-2" aria-label="Details"><InfoIcon size={24} /></button></span>
            </div>

            <div className="relative flex-1 min-h-0 my-2">
              <div data-art className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-full max-h-full max-w-full aspect-square rounded-2xl overflow-hidden shadow-2xl bg-[var(--s2)]" onTouchStart={(e) => { e.stopPropagation(); touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }} onTouchEnd={(e) => { e.stopPropagation(); onTouchEnd(e, "art"); }}>
              <Cover t={now} tq={tq} size="100%" radius={0} />
              <div className="absolute inset-x-0 bottom-0 px-3 pb-2 pt-10 pointer-events-none" style={{ background: "linear-gradient(transparent, rgba(0,0,0,.6))" }}>
                <Spectrum audio={audio} playing={playing} height={36} rgb="255,255,255" />
              </div>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-3 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="text-[20px] font-bold leading-tight truncate">{now.title}</div>
                <button onClick={() => { setFull(false); setStack((s) => [...s, { kind: "artist", key: artistsOf(now)[0]!, title: artistsOf(now)[0]! }]); setTab("library"); }} className="block text-[15px] text-[var(--dim)] truncate max-w-full text-left">{now.artist}</button>
              </div>
              <button onClick={() => rate(now, 1)} className={`p-2 ${now.rating > 0 ? "text-rose-500" : "text-[var(--dim)]"}`} aria-label="Like"><HeartIcon size={28} filled={now.rating > 0} /></button>
              <button onClick={() => rate(now, -1)} className={`p-2 ${now.rating < 0 ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`} aria-label="Dislike"><ThumbDownIcon size={24} filled={now.rating < 0} /></button>
            </div>

            <div className="mt-2 shrink-0">
              <input type="range" min={0} max={dur || 0} step={0.1} value={Math.min(pos, dur || 0)} onChange={(e) => seek(Number(e.target.value))} className="w-full" aria-label="Seek" />
              <div className="flex justify-between text-xs text-[var(--dim)] tabular-nums"><span>{fmt(pos)}</span><span>-{fmt(Math.max(0, dur - pos))}</span></div>
            </div>

            <div className="mt-1 flex items-center justify-between shrink-0">
              <button onClick={() => setShuffle((s) => !s)} className={`p-3 ${shuffle ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`} aria-label="Shuffle" aria-pressed={shuffle}><ShuffleIcon size={24} /></button>
              <button onClick={() => step(-1)} className="p-3" aria-label="Previous"><PrevIcon size={34} /></button>
              <button onClick={toggle} className="w-16 h-16 rounded-full grid place-items-center text-[var(--acfg)] active:scale-95 transition" style={{ background: "rgb(var(--ac))" }} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon size={34} /> : <PlayIcon size={34} className="translate-x-[2px]" />}</button>
              <button onClick={() => step(1)} className="p-3" aria-label="Next"><NextIcon size={34} /></button>
              <button onClick={() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))} className={`p-3 ${repeat !== "off" ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`} aria-label={`Repeat ${repeat}`}><RepeatIcon size={24} one={repeat === "one"} /></button>
            </div>

            <div className="mt-2 flex items-center gap-3 shrink-0 [@media(pointer:coarse)]:hidden">
              <VolumeIcon size={18} low className="text-[var(--dim)]" />
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audio.current) audio.current.volume = v; }} className="flex-1" aria-label="Volume" />
              <VolumeIcon size={18} className="text-[var(--dim)]" />
            </div>

            <div className="mt-3 shrink-0 grid grid-cols-5 gap-1.5 text-[11px]">
              <button onClick={() => setSheet("sleep")} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] ${sleepMin ? "text-[var(--fg)] font-semibold" : "text-[var(--dim)]"}`}><TimerIcon size={20} />{sleepMin === -1 ? "End of track" : sleepMin > 0 ? `${sleepMin} min` : "Sleep"}</button>
              <button onClick={() => setSheet("speed")} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] ${speed !== 1 ? "text-[var(--fg)] font-semibold" : "text-[var(--dim)]"}`}><span className="h-5 grid place-items-center text-[15px] font-bold">{speed}×</span>Speed</button>
              <button onClick={() => setSheet("fade")} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] ${fade ? "text-[var(--fg)] font-semibold" : "text-[var(--dim)]"}`}><FadeIcon size={20} />{fade ? `Fade ${fade}s` : "Fade"}</button>
              <button onClick={() => setSheet("lyrics")} className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] text-[var(--dim)]"><LyricsIcon size={20} />Lyrics</button>
              <button onClick={() => setSheet("queue")} className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] text-[var(--dim)]"><QueueIcon size={20} />Queue {upNextCount}</button>
            </div>
          </div>
        </div>
      )}

      {sheet === "queue" && <QueueSheet ids={queue} byId={byId} cur={cur} tq={tq} onClose={() => setSheet(null)} onPlay={(id) => { history.current.push(cur ?? id); setCur(id); }} onRemove={(id) => setQueue((q) => q.filter((x) => x !== id))} onMove={moveQ} onClear={() => setQueue((q) => (cur != null ? [cur] : q.slice(0, 0)))} />}
      {sheet === "sleep" && <OptionSheet title="Sleep timer" options={SLEEP} value={sleepMin} onPick={(v) => { setSleepMin(v); if (v === 0) sleepEnd.current = 0; }} onClose={() => setSheet(null)} />}
      {sheet === "speed" && <OptionSheet title="Playback speed" options={SPEEDS} value={speed} onPick={setSpeed} onClose={() => setSheet(null)} />}
      {sheet === "fade" && <OptionSheet title="Fade between tracks" options={FADES} value={fade} onPick={pickFade} onClose={() => setSheet(null)} />}
      {sheet === "lyrics" && now && <LyricsSheet t={now} tq={tq} pos={pos} onSeek={seek} onClose={() => setSheet(null)} />}
      {menuT && <TrackMenu onShare={() => void share(menuT)} offline={offline.has(menuT.id)} onOffline={() => void toggleOffline(menuT)} t={byId.get(menuT.id) ?? menuT} tq={tq} onClose={() => setMenuT(null)} onNext={() => playNext(menuT.id)} onAdd={() => addQueue(menuT.id)} onRate={(r) => rate(byId.get(menuT.id) ?? menuT, r)}
        onArtist={() => { const a = artistsOf(menuT)[0]!; setFull(false); setTab("library"); setStack([{ kind: "artist", key: a, title: a }]); }}
        onAlbum={() => { setFull(false); setTab("library"); setStack([{ kind: "album", key: `${menuT.album ?? "Single"}|${artistsOf(menuT)[0] ?? ""}`, title: menuT.album ?? "Singles" }]); }}
        onDetails={() => setDetailId(menuT.id)} />}
      {detailId != null && byId.get(detailId) && <TrackDetail lang="en" dark t={byId.get(detailId)!} tq={tq} onClose={() => setDetailId(null)} onRate={(r) => rate(byId.get(detailId)!, r)} live={detailId === cur ? { pos, dur, playing } : null} />}
      {toast && <div className="fixed left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full text-sm bg-[rgb(var(--ac))] text-[var(--acfg)] shadow-lg" style={{ bottom: "calc(150px + env(safe-area-inset-bottom))", animation: "fade .15s" }} role="status">{toast}</div>}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
