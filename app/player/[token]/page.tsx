"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import Marquee from "@/components/music/app/Marquee";
import FitText from "@/components/music/app/FitText";
import { AccountsCtx, SourceChips, SourceMarks } from "@/components/music/app/SourceMarks";
import dynamic from "next/dynamic";
import { loadLyrics, removeLyrics, saveLyrics } from "@/components/music/app/lyricsCache";
import BackLayer from "@/components/music/app/BackLayer";
import { memo, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartIcon, CloseIcon, MoreIcon, SettingsIcon, SparkIcon, ChevronDownIcon, ShareIcon, HeartIcon, LyricsIcon, HomeIcon, InfoIcon, LibraryIcon, MoonIcon, NextIcon, PauseIcon, PlayIcon, PlusIcon, PrevIcon, QueueIcon, RepeatIcon, SearchIcon, ShuffleIcon, SunIcon, ThumbDownIcon, TimerIcon, VolumeIcon } from "@/components/music/Icons";

import SeekBar from "@/components/music/app/SeekBar";
import Spectrum from "@/components/music/Spectrum";

import { useListenTracker } from "@/components/music/useListenTracker";
import { Cover, shareText, trackShareLines, type Playlist, type Track } from "@/components/music/app/shared";
import { SearchView } from "@/components/music/app/Search";
import SafeBoundary from "@/components/ui/SafeBoundary";
import { NetEpochCtx } from "@/components/music/app/shared";
import { artistsOf, DetailView, DownloadedBadge, type Desc, type Vibe, HomeView, LibraryView, useCollections, type Api, type Page } from "@/components/music/app/Views";
import { AccountPlaylistSheet, ArtistPickSheet, DownloadSheet, LyricsSheet, OptionSheet, QueueSheet, ReportSheet, SettingsSheet, SmartFromSongSheet, SpotifyLikeSheet, TrackMenu } from "@/components/music/app/Sheets";
import { matchesAccounts } from "@/lib/music-scope";

// Private personal player. The URL's 256-bit token is the credential.
type Tab = "home" | "search" | "library" | "stats";
const SLEEP = [{ v: 0, label: "Off" }, { v: 5, label: "5 minutes" }, { v: 15, label: "15 minutes" }, { v: 30, label: "30 minutes" }, { v: 60, label: "1 hour" }, { v: -1, label: "End of track" }];
const FADES = [{ v: 0, label: "Off" }, { v: 3, label: "3 seconds" }, { v: 6, label: "6 seconds" }, { v: 10, label: "10 seconds" }];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2].map((v) => ({ v, label: v === 1 ? "Normal (1×)" : `${v}×` }));

// Rarely-opened screens load on demand to keep the first paint small.
const StatsView = dynamic(() => import("@/components/music/app/StatsView"), { ssr: false });
const TrackDetail = dynamic(() => import("@/components/music/TrackDetail"), { ssr: false });

const MHome = memo(HomeView), MLibrary = memo(LibraryView), MSearch = SearchView, MDetail = memo(DetailView);

export default function PlayerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const tq = `t=${encodeURIComponent(token)}`;
  const [allTracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string }>>([]);
  // Settings → "Songs from": a standing account filter for the whole player (every list, search, mixes), remembered on this phone.
  const [scope, setScopeState] = useState<{ ids: number[]; mode: "any" | "all" }>({ ids: [], mode: "any" });
  useEffect(() => {
    try { const j = JSON.parse(localStorage.getItem("player.scope") || "null") as { ids?: unknown; mode?: unknown } | null; if (j && Array.isArray(j.ids)) setScopeState({ ids: j.ids.map(Number).filter(Number.isFinite), mode: j.mode === "all" ? "all" : "any" }); } catch { /* none */ }
  }, []);
  const setScope = useCallback((v: { ids: number[]; mode: "any" | "all" }) => { setScopeState(v); try { localStorage.setItem("player.scope", JSON.stringify(v)); } catch { /* private mode */ } }, []);
  const tracks = useMemo(() => {
    const want = scope.ids.filter((id) => accounts.some((a) => a.id === id)); // ignore accounts this link can't see any more
    if (!want.length) return allTracks;
    return allTracks.filter((t) => matchesAccounts(t.sources, want, scope.mode));
  }, [allTracks, scope, accounts]);
  const [canLike, setCanLike] = useState(false); // may add songs to a Spotify account's Liked Songs (owner switch)
  // A song with several artists asks which one to open; a single artist opens straight away.
  const [artistPick, setArtistPick] = useState<Track | null>(null);
  const openArtist = (name: string) => { setFull(false); setTab("library"); setStack([{ kind: "artist", key: name, title: name }]); };
  const goArtist = (t: Track) => { const list = artistsOf(t); if (list.length > 1) setArtistPick(t); else if (list[0]) openArtist(list[0]); };
  const [likeTs, setLikeTs] = useState<Track[] | null>(null);
  // multi-select: tick songs in any list, then act on all of them from the bar at the bottom
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const selPool = useRef<number[]>([]);
  const toggleSel = useCallback((id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const startSelect = useCallback((pool?: number[], first?: number) => { selPool.current = pool ?? []; setSel(first != null ? new Set([first]) : new Set()); setSelecting(true); }, []);
  const endSelect = useCallback(() => { setSelecting(false); setSel(new Set()); }, []);
  const [accPl, setAccPl] = useState<{ ids: number[]; mode: "any" | "all" } | null>(null);
  const saveAccountPlaylist = useCallback((ids: number[], mode: "any" | "all") => setAccPl({ ids, mode }), []);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  // The server cannot be reached (or we are looking at a cached copy of the library): only downloaded songs can play.
  const [netDown, setNetDown] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [netEpoch, setNetEpoch] = useState(0); // +1 each time the connection comes back: covers retry, a stalled song restarts
  const wasDown = useRef(false);
  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Page[]>([]);
  const [queue, setQueue] = useState<number[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeatState] = useState<"off" | "all" | "one">("off");
  const setRepeat = useCallback((v: "off" | "all" | "one") => { setRepeatState(v); try { localStorage.setItem("player.repeat", v); } catch {} }, []);
  const origQueue = useRef<number[] | null>(null); // the queue in its natural order, to go back to when shuffle is switched off
  const [vol, setVol] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [sleepMin, setSleepMin] = useState(0);
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState<null | "queue" | "sleep" | "speed" | "lyrics">(null);
  const [menuT, setMenuT] = useState<Track | null>(null);
  const [reportT, setReportT] = useState<Track | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState("");
  const [fade, setFade] = useState(0);
  const [buf, setBuf] = useState(0);
  const [vibeData, setVibeData] = useState<{ vibes: Vibe[]; tracks: Record<number, Desc>; progress: { analyzed: number; ready: number }; canCreate: boolean }>({ vibes: [], tracks: {}, progress: { analyzed: 0, ready: 0 }, canCreate: true });
  const [smartT, setSmartT] = useState<Track | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dlPlan, setDlPlan] = useState<{ ids: number[]; label: string; bytes: number } | null>(null);
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null);
  const dlCtl = useRef<AbortController | null>(null);
  const [viz, setViz] = useState(true);
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [isIosBrowser, setIsIosBrowser] = useState(false);
  const [bannerOn, setBannerOn] = useState(true);
  const [updateReady, setUpdateReady] = useState(false);
  const build = useRef<string | null>(null);
  const [lyr, setLyr] = useState<{ id: number; found: boolean } | null>(null);
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
    try {
      const r = localStorage.getItem("player.repeat"); if (r === "all" || r === "one") setRepeatState(r);
      if (localStorage.getItem("player.shuffle") === "1") setShuffleState(true);
    } catch {}
    try { const f = Number(localStorage.getItem("player.fade")); if ([3, 6, 10].includes(f)) setFade(f); } catch {}
    // The visualizer routes audio through Web Audio, which iOS can suspend in
    // the background — so it defaults to off there.
    try { const v = localStorage.getItem("player.viz"); setViz(v ? v === "1" : !/iphone|ipad|ipod/i.test(navigator.userAgent)); } catch {}
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/player-sw.js", { scope: "/player/", updateViaCache: "none" }).catch(() => {});
    if ("caches" in window) void caches.open("player-audio").then((c) => c.keys()).then((ks) => setOffline(new Set(ks.map((k) => Number(new URL(k.url).pathname.split("/").pop())).filter(Number.isFinite)))).catch(() => {});
  }, []);
  // Install (Android prompt / iOS hint) and self-update.
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const dismissed = (() => { try { return localStorage.getItem("player.installDismissed") === "1"; } catch { return false; } })();
    const native = !!(window as unknown as { AndroidMusic?: unknown }).AndroidMusic;
    if (native) { setBannerOn(false); return; }
    if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) setIsIosBrowser(true);
    if (dismissed) setBannerOn(false);
    if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) setIosHint(true);
    const onPrompt = (e: Event) => { e.preventDefault(); if (!standalone) setInstallEvt(e as unknown as { prompt: () => Promise<void> }); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const checkUpdate = useCallback(async () => {
    try {
      if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration("/player/").then((r) => r?.update()).catch(() => {});
      const r = await fetch(`/api/music/version?${tq}`, { cache: "no-store" });
      if (!r.ok) return;
      const { build: b } = (await r.json()) as { build: string };
      if (build.current == null) build.current = b; else if (b !== build.current) setUpdateReady(true);
    } catch { /* offline: try again later */ }
  }, [tq]);
  useEffect(() => {
    void checkUpdate();
    const i = setInterval(() => void checkUpdate(), 5 * 60 * 1000);
    const vis = () => { if (document.visibilityState === "visible") void checkUpdate(); };
    document.addEventListener("visibilitychange", vis); window.addEventListener("online", vis);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", vis); };
  }, [checkUpdate]);
  // The Android app: a newer APK than the installed one → a banner with an in-app Update (download + install).
  const [appUpdate, setAppUpdate] = useState<{ code: number; name: string; url: string } | null>(null);
  useEffect(() => {
    const nat = (window as unknown as { AndroidMusic?: { versionCode?: () => number } }).AndroidMusic;
    if (!nat?.versionCode) return;
    let live = true;
    const check = async () => {
      try {
        const have = Number(nat.versionCode!());
        const r = await fetch(`/downloads/app-version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { versionCode?: number; versionName?: string; apk?: string };
        if (!live || !j.versionCode || !(j.versionCode > have)) return;
        let skipped = 0; try { skipped = Number(localStorage.getItem("player.appUpdateSkipped") || 0); } catch { /* ignore */ }
        if (skipped >= j.versionCode) return;
        setAppUpdate({ code: j.versionCode, name: j.versionName ?? String(j.versionCode), url: new URL(j.apk ?? "/downloads/MyMusic.apk", location.origin).toString() });
      } catch { /* offline: try again later */ }
    };
    void check();
    const i = setInterval(() => void check(), 6 * 3600_000);
    const vis = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", vis);
    return () => { live = false; clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, []);
  // Reload into the new version as soon as nothing is playing.
  useEffect(() => { if (updateReady && !playing) window.location.reload(); }, [updateReady, playing]);
  const dismissInstall = () => { setBannerOn(false); try { localStorage.setItem("player.installDismissed", "1"); } catch {} };
  const doInstall = async () => { await installEvt?.prompt(); setInstallEvt(null); };
  // Only offer lyrics when the track has some (the server caches lookups).
  useEffect(() => {
    if (!full || cur == null) return;
    let live = true;
    loadLyrics(cur, tq).then((j) => { if (live) setLyr({ id: cur, found: !!j.found }); });
    return () => { live = false; };
  }, [full, cur, tq]);
  const hasLyrics = lyr?.id === cur && lyr.found;
  const flipViz = () => setViz((v) => { try { localStorage.setItem("player.viz", v ? "0" : "1"); } catch {} flash(v ? "Visualizer off" : "Visualizer on"); return !v; });
  const pickFade = (v: number) => { setFade(v); try { localStorage.setItem("player.fade", String(v)); } catch {} };
  const flipTheme = () => setTheme((t) => { const n = t === "dark" ? "light" : "dark"; try { localStorage.setItem("player.theme", n); } catch {} return n; });
  const accent = theme === "dark" ? "255,255,255" : "24,24,32";
  const vars: Record<string, string> = theme === "dark"
    ? { "--acfg": "#0b0b10", "--bg": "#07070b", "--bg2": "#0f0f16", "--fg": "#ececf1", "--s0": "rgba(255,255,255,.03)", "--s1": "rgba(255,255,255,.06)", "--s2": "rgba(255,255,255,.11)", "--bd": "rgba(255,255,255,.12)", "--bd0": "rgba(255,255,255,.06)", "--dim": "#a1a1aa", "--dim2": "#d4d4d8", "--dim3": "#71717a", "--glass": "rgba(20,20,28,.97)", "--amb": ".26" }
    : { "--acfg": "#ffffff", "--bg": "#f5f5f8", "--bg2": "#ffffff", "--fg": "#16161d", "--s0": "rgba(0,0,0,.025)", "--s1": "rgba(0,0,0,.05)", "--s2": "rgba(0,0,0,.09)", "--bd": "rgba(0,0,0,.12)", "--bd0": "rgba(0,0,0,.07)", "--dim": "#52525b", "--dim2": "#3f3f46", "--dim3": "#71717a", "--glass": "rgba(255,255,255,.97)", "--amb": ".14" };

  const audio = useRef<HTMLAudioElement>(null);
  const lastPos = useRef(0);
  const history = useRef<number[]>([]);
  const tracker = useListenTracker(tq);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const c = useCollections(tracks, playlists, byId);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  // Opened from the Telegram Mini App entry (/tg): fill the screen and match Telegram's chrome.
  useEffect(() => {
    let inMini = false;
    try { inMini = sessionStorage.getItem("tgMini") === "1"; } catch { /* ignore */ }
    if (!inMini) return;
    const go = () => {
      const wa = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void; disableVerticalSwipes?: () => void; setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void } } }).Telegram?.WebApp;
      if (!wa) return;
      for (const f of [() => wa.ready(), () => wa.expand(), () => wa.disableVerticalSwipes?.(), () => wa.setHeaderColor?.("#07070b"), () => wa.setBackgroundColor?.("#07070b")]) { try { f(); } catch { /* an older Telegram: skip what it does not know */ } }
    };
    if ((window as unknown as { Telegram?: unknown }).Telegram) { go(); return; }
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js"; s.onload = go; document.head.appendChild(s);
  }, []);
  // Remember this link on the device so the installed launcher (/listen) can reopen it.
  useEffect(() => {
    try { localStorage.setItem("listenLink", token); } catch { /* private mode */ }
    try { (window as unknown as { AndroidMusic?: { saveLink?: (t: string) => void } }).AndroidMusic?.saveLink?.(token); } catch { /* not the app */ }
  }, [token]);

  // Full refresh: drop the service worker and its cached app shell / list / covers, then reload from the server.
  // Downloaded songs and lyrics (Cache API "player-audio") are deliberately left alone.
  const refreshAll = useCallback(async () => {
    try { for (const r of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) await r.unregister(); } catch { /* none */ }
    try { for (const k of await caches.keys()) if (k.startsWith("player-shell")) await caches.delete(k); } catch { /* none */ }
    window.location.reload();
  }, []);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/music?${tq}`, { cache: "no-store" });
      if (r.status === 404) { setDenied(true); return; }
      if (!r.ok) { setNetDown(true); return; }
      setNetDown(r.headers.get("x-sw-cache") === "1"); // the service worker answered from its old copy
      const j = (await r.json()) as { tracks: Track[]; playlists: Playlist[]; accounts?: Array<{ id: number; name: string }>; canLike?: boolean };
      setTracks(j.tracks.filter((t) => t.status === "ready")); setPlaylists(j.playlists); setAccounts(j.accounts ?? []); setCanLike(j.canLike === true);
    } catch { setNetDown(true); } finally { setLoading(false); }
  }, [tq]);
  useEffect(() => { void load(); }, [load]);
  // Reconnect by itself: when the phone says it is online again, and every 15 s while the server is unreachable.
  useEffect(() => {
    const on = () => void load(), off = () => setNetDown(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    if (!navigator.onLine) setNetDown(true);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [load]);
  useEffect(() => { if (!netDown) return; const i = setInterval(() => void load(), 15000); return () => clearInterval(i); }, [netDown, load]);
  useEffect(() => {
    if (netDown) { wasDown.current = true; return; }
    if (!wasDown.current) return;
    wasDown.current = false;
    setNetEpoch((n) => n + 1);
    const a = audio.current; // a song that stalled when the connection dropped: reload it and carry on from where it was
    if (a && a.src && (a.error || a.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)) { const at = a.currentTime; const was = playing; a.load(); a.currentTime = at; if (was) void a.play().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the connection coming back
  }, [netDown]);
  const retryNow = useCallback(async () => { setRetrying(true); await load(); setRetrying(false); }, [load]);
  useEffect(() => {
    let tries = 0;
    const go = () => void fetch(`/api/music/vibes?${tq}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      // A failed first load (cold analysis cache, flaky network) is retried soon, not after 10 minutes.
      if (!(j && Array.isArray(j.vibes)) && tries++ < 4) setTimeout(go, 8000 * tries);
      if (j && Array.isArray(j.vibes)) setVibeData({ vibes: j.vibes, tracks: j.tracks ?? {}, progress: { analyzed: j.progress?.analyzed ?? 0, ready: j.progress?.ready ?? 0 }, canCreate: j.canCreate === true }); }).catch(() => {});
    go();
    const i = setInterval(go, 10 * 60 * 1000);
    return () => clearInterval(i);
  }, [tq]);

  const play = useCallback((ids: number[], startId?: number, sh = false) => {
    if (netDown) {
      const ok = ids.filter((x) => offline.has(x));
      if (ok.length === 0) { flash("No connection — download songs to play them offline"); return; }
      if (startId != null && !offline.has(startId)) { flash("Not downloaded — needs a connection"); return; }
      ids = ok;
    }
    if (ids.length === 0) return;
    const start = startId ?? (sh ? ids[Math.floor(Math.random() * ids.length)]! : ids[0]!);
    const doShuffle = sh || shuffle;
    origQueue.current = ids;
    if (sh && !shuffle) { setShuffleState(true); try { localStorage.setItem("player.shuffle", "1"); } catch {} } // the Shuffle button on a page turns shuffle on, so the toggle never disagrees with the queue
    setQueue(doShuffle ? [start, ...ids.filter((x) => x !== start).sort(() => Math.random() - 0.5)] : ids);
    history.current = []; setCur(start); setPlaying(true);
  }, [shuffle, netDown, offline]);

  const toggleShuffle = useCallback(() => {
    const next = !shuffle;
    setShuffleState(next); try { localStorage.setItem("player.shuffle", next ? "1" : "0"); } catch {}
    setQueue((q) => {
      const i = cur != null ? q.indexOf(cur) : -1;
      if (next) return [...q.slice(0, i + 1), ...q.slice(i + 1).sort(() => Math.random() - 0.5)]; // what plays next is shuffled; the current song keeps playing
      const orig = origQueue.current; if (!orig) return q;
      const have = new Set(q), back = orig.filter((x) => have.has(x));
      return [...back, ...q.filter((x) => !back.includes(x))];
    });
  }, [shuffle, cur]);

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
    if (auto && repeat === "one") { if (a) { a.currentTime = 0; void a.play().catch(() => {}); } return; }
    const i = queue.indexOf(cur); let n = i + dir;
    if (n >= queue.length) { if (repeat === "all" || !auto) n = 0; else { setPlaying(false); return; } }
    if (n < 0) n = queue.length - 1;
    if (netDown) { // offline: skip what is not saved on this phone
      let guard = queue.length;
      while (guard-- > 0 && !offline.has(queue[n]!)) { n += dir; if (n >= queue.length) n = 0; if (n < 0) n = queue.length - 1; }
      if (!offline.has(queue[n]!)) { setPlaying(false); flash("No connection — the rest is not downloaded"); return; }
    }
    if (dir === 1) history.current.push(cur);
    setCur(queue[n]!);
  }, [cur, queue, repeat, netDown, offline]);

  // A song that cannot load (no connection, file gone): say so and move on, instead of sitting silent. Gives up after 3 in a row.
  const audioFails = useRef(0);
  const onAudioError = useCallback(() => {
    const a = audio.current; if (!a || !a.src || cur == null) return;
    audioFails.current += 1;
    if (audioFails.current > 3) { setPlaying(false); flash("Can't play right now — check your connection"); return; }
    flash(offline.has(cur) ? "This song's saved copy could not be read" : "Can't load this song right now");
    setTimeout(() => step(1, true), 700);
  }, [cur, offline, step]);

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
    tracker.begin(cur); lastPos.current = 0;
    const start = (src: string) => { if (dead) return; a.src = src; a.playbackRate = speed; void a.play().catch(() => {}); };
    // &v=<size> changes when a file is replaced, so a stale copy in the HTTP cache is never reused
    const net = `/api/music/stream/${cur}?${tq}&v=${byIdRef.current.get(cur)?.sizeBytes ?? 0}`;
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
    p.preload = "auto"; p.src = `/api/music/stream/${nid}?${tq}&v=${byIdRef.current.get(nid)?.sizeBytes ?? 0}`;
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

  // Open a shared song link (?track=ID): load it into the player, then tidy the URL.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || tracks.length === 0) return;
    deepLinked.current = true;
    const id = Number(new URLSearchParams(window.location.search).get("track"));
    if (!Number.isFinite(id) || !byIdRef.current.has(id)) return;
    play(tracks.map((t) => t.id), id);
    try { window.history.replaceState(window.history.state, "", window.location.pathname); } catch { /* ignore */ }
  }, [tracks, play]);
  const share = async (t: Track) => { const m = await shareText(t.title ?? "Song", trackShareLines(t, tq)); if (m) flash(m); };
  // Attached to every problem report so a bug can be reproduced.
  const reportContext = () => {
    const a = audio.current;
    return {
      position: a ? Math.round(a.currentTime) : null, duration: a && Number.isFinite(a.duration) ? Math.round(a.duration) : null,
      playing, speed, fade, repeat, shuffle, offlineCopy: reportT ? offline.has(reportT.id) : false,
      audioError: a?.error ? a.error.code : null, readyState: a?.readyState ?? null, online: navigator.onLine,
      connection: (navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null,
      build: build.current, standalone: window.matchMedia("(display-mode: standalone)").matches,
      ua: navigator.userAgent.slice(0, 160), viewport: `${innerWidth}x${innerHeight}`, theme,
    };
  };
  const chipsFor = (id: number): string[] => {
    const d = vibeData.tracks[id]; if (!d) return [];
    const vibe = vibeData.vibes.find((v) => v.key === d.vibe)?.name;
    return [`${d.bpm} BPM`, `${d.key} ${d.mode}`, d.energy < 0.35 ? "Low energy" : d.energy > 0.6 ? "High energy" : "Medium energy", d.brightness > 0.4 ? "Bright" : d.brightness < 0.2 ? "Warm" : "Balanced", ...(vibe ? [vibe] : []), ...moodChips(d.moods), ...d.genres.slice(0, 3).map((g) => g.split(" / ").map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase())).join(" / "))];
  };
  const requestDownload = (ids: number[], label: string) => {
    const todo = ids.filter((id) => !offline.has(id));
    if (todo.length === 0) { flash("Already downloaded"); return; }
    if (!("caches" in window)) { flash("Offline storage isn't available in this browser"); return; }
    setDlPlan({ ids: todo, label, bytes: todo.reduce((a, id) => a + (byIdRef.current.get(id)?.sizeBytes ?? 8_000_000), 0) });
  };
  const startDownload = async (ids: number[]) => {
    try { await navigator.storage?.persist?.(); } catch { /* best effort: asks the browser not to evict our songs */ }
    const c = await caches.open("player-audio");
    const ctl = new AbortController(); dlCtl.current = ctl;
    let done = 0, failed = 0, next = 0, noSpace = false;
    setDl({ done: 0, total: ids.length });
    const worker = async () => {
      while (!ctl.signal.aborted) {
        const id = ids[next++]; if (id == null) return;
        try {
          const r = await fetch(`/api/music/stream/${id}?${tq}`, { signal: ctl.signal });
          if (r.status !== 200) throw new Error(`http ${r.status}`);
          await c.put(`/api/music/stream/${id}`, r);
          await saveLyrics(id, tq);
          setOffline((s) => new Set(s).add(id));
        } catch (e) {
          if (ctl.signal.aborted) return;
          failed++;
          if ((e as Error).name === "QuotaExceededError") { noSpace = true; ctl.abort(); return; }
        }
        done++; setDl({ done, total: ids.length });
      }
    };
    await Promise.all([worker(), worker()]);
    setDl(null); dlCtl.current = null;
    flash(noSpace ? "Not enough free space — download stopped" : ctl.signal.aborted ? "Download stopped" : failed ? `Downloaded, ${failed} failed` : "Downloaded for offline");
  };
  const removeDownloads = async () => { try { await caches.delete("player-audio"); } catch { /* ignore */ } setOffline(new Set()); flash("Downloads removed"); };
  const signOut = async (wipe: boolean) => {
    dlCtl.current?.abort();
    try { localStorage.removeItem("listenLink"); } catch { /* ignore */ }
    try { if (wipe) await caches.delete("player-audio"); await caches.delete("player-shell-v2"); await caches.delete("player-shell-v1"); } catch { /* ignore */ }
    window.location.replace("/listen?signedout=1");
  };
  const toggleOffline = async (t: Track) => {
    const key = `/api/music/stream/${t.id}`;
    const c = await caches.open("player-audio");
    if (offline.has(t.id)) { await c.delete(key); await removeLyrics(t.id); setOffline((s) => { const n = new Set(s); n.delete(t.id); return n; }); flash("Offline copy removed"); return; }
    flash("Saving for offline…");
    try {
      const r = await fetch(`${key}?${tq}`);
      if (!r.ok || r.status !== 200) throw new Error("bad");
      await c.put(key, r);
      await saveLyrics(t.id, tq);
      setOffline((s) => new Set(s).add(t.id)); flash("Saved for offline");
    } catch { flash("Could not save"); }
  };
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("nexttrack", () => step(1));
    ms.setActionHandler("previoustrack", () => step(-1));
    ms.setActionHandler("play", () => void audio.current?.play().catch(() => {}));
    ms.setActionHandler("pause", () => audio.current?.pause());
    ms.setActionHandler("seekto", (d) => { if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime; });
    ms.setActionHandler("seekbackward", () => { if (audio.current) audio.current.currentTime -= 10; });
    ms.setActionHandler("seekforward", () => { if (audio.current) audio.current.currentTime += 10; });
  }, [step]);

  // Native Android app: mirror the playback state into the app's notification / lock-screen
  // controls, and let those buttons drive the player (window.AndroidMusic is injected by the app).
  useEffect(() => {
    const n = (window as unknown as { AndroidMusic?: { state: (p: boolean, t: string, a: string, c: string) => void } }).AndroidMusic;
    if (!n) return;
    const t = cur != null ? byIdRef.current.get(cur) : null;
    n.state(playing, t?.title ?? "", t?.artist ?? "", t?.hasCover ? `${location.origin}/api/music/cover/${t.id}?${tq}&w=320` : "");
  }, [playing, cur, tq]);
  useEffect(() => {
    (window as unknown as { __nativeCmd?: (c: string) => void }).__nativeCmd = (c: string) => {
      if (c === "next") step(1); else if (c === "prev") step(-1);
      else if (c === "play") void audio.current?.play().catch(() => {}); else if (c === "pause") audio.current?.pause();
      else if (c === "toggle") { const a = audio.current; if (a) { if (a.paused) void a.play().catch(() => {}); else a.pause(); } }
    };
  }, [step]);

  // Sleep timer
  const sleepEnd = useRef(0);
  useEffect(() => {
    if (sleepMin > 0) sleepEnd.current = Date.now() + sleepMin * 60000;
    if (sleepMin <= 0) return;
    const i = setInterval(() => { if (Date.now() >= sleepEnd.current) { audio.current?.pause(); setSleepMin(0); flash("Sleep timer: paused"); } }, 5000);
    return () => clearInterval(i);
  }, [sleepMin]);

  const toggle = useCallback(() => { const a = audio.current; if (!a) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); }, []);
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
  // Stable function identities (via a ref) + a memoised api object: the
  // progress tick (4×/s) re-renders only the player chrome, not the lists.
  const startRadio = async (t: Track) => {
    flash("Finding songs that sound like this…");
    try {
      const r = await fetch(`/api/music/similar/${t.id}?mode=radio&n=40&${tq}`, { cache: "no-store" });
      const j = (await r.json()) as { ids?: number[]; analysed?: boolean };
      if (!r.ok || !j.ids?.length || !j.analysed) { flash("This song hasn't been analysed yet"); return; }
      play(j.ids, t.id);
      flash(`Radio: ${j.ids.length} songs in the same lane`);
    } catch { flash("Couldn't start radio"); }
  };
  const fns = useRef({ play, smartMix, rate, radio: startRadio, download: requestDownload });
  fns.current = { play, smartMix, rate, radio: startRadio, download: requestDownload };
  const stable = useMemo(() => ({
    play: (ids: number[], startId?: number, sh?: boolean) => fns.current.play(ids, startId, sh),
    smartMix: (ids: number[]) => fns.current.smartMix(ids),
    rate: (t: Track, r: number) => fns.current.rate(t, r),
    menu: setMenuT,
    open: (p: Page) => setStack((s) => [...s, p]),
    details: (t: Track) => setDetailId(t.id),
    download: (ids: number[], label: string) => fns.current.download(ids, label),
    radio: (t: Track) => void fns.current.radio(t),
  }), []);
  const api: Api = useMemo(() => ({ tq, canCreate: vibeData.canCreate, saveAccountPlaylist, offlineMode: netDown, selecting, sel, toggleSel, startSelect, tracks, playlists, byId, cur, playing, loading, vibes: vibeData.vibes, desc: vibeData.tracks, analysis: vibeData.progress, offline, dl, ...stable }), [tq, saveAccountPlaylist, netDown, selecting, sel, toggleSel, startSelect, tracks, playlists, byId, cur, playing, loading, vibeData, offline, dl, stable]);
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
    <AccountsCtx.Provider value={accounts}>
      <NetEpochCtx.Provider value={netEpoch}>
    <div dir="ltr" lang="en" style={{ ["--ac" as string]: accent, ...vars, background: "var(--bg)", color: "var(--fg)", minHeight: "100dvh", fontFamily: 'var(--font-inter), var(--font-vazir), -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', letterSpacing: "-0.011em", fontOpticalSizing: "auto", WebkitFontSmoothing: "antialiased" }} className="relative overflow-x-hidden">
      <style>{`
        html, body { overscroll-behavior: none; }
        svg[aria-hidden] { display: block; }
        @keyframes eq { 0%,100% { height: 25% } 50% { height: 100% } }
        @keyframes rise { from { transform: translateY(100%) } to { transform: none } }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        input[type=range] { accent-color: rgb(var(--ac)); }
        /* No live blur behind the bars: re-blurring the list under them on every scroll frame is what made touch feel laggy on mid-range phones. */
        .glass { background: var(--glass); }
        /* Instant taps: no double-tap-zoom wait, no grey flash. */
        button, [role=button], a, select, summary, input[type=range] { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
        /* Bigger touch targets without changing the layout: every icon-only button reaches 8px past its drawing; text pills are at least 38px tall. */
        button:has(> svg:only-child) { position: relative; min-width: 40px; min-height: 40px; display: inline-grid; place-items: center; }
        button:has(> svg:only-child)::after { content: ""; position: absolute; inset: -8px; }
        button.rounded-full:not(:has(> svg:only-child)) { min-height: 38px; }
        button:focus-visible, input:focus-visible { outline: 2px solid rgb(var(--ac)); outline-offset: 2px; }
      `}</style>

      <div className="relative max-w-2xl mx-auto px-4 pt-[max(14px,env(safe-area-inset-top))]" style={{ paddingBottom: now ? 168 : 96 }}>
        {bannerOn && (installEvt || iosHint) && !page && tab === "home" && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-[var(--s1)] border border-[var(--bd)] p-3">
            <img src="/icons/player-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <div className="font-semibold text-[14px]">Install My Music</div>
              {installEvt ? <div className="text-[var(--dim)]">Open it like a normal app, full screen.</div> : <div className="text-[var(--dim)]">Tap Share, then &ldquo;Add to Home Screen&rdquo;.</div>}
            </div>
            {installEvt && <button onClick={() => void doInstall()} className="px-4 py-2 rounded-full bg-[rgb(var(--ac))] text-[var(--acfg)] text-[13px] font-semibold">Install</button>}
            <button onClick={dismissInstall} className="p-1.5 text-[var(--dim)]" aria-label="Dismiss"><CloseIcon size={16} /></button>
          </div>
        )}
        {netDown && (
          <div role="status" className="mb-3 flex items-center gap-3 rounded-2xl bg-amber-500/12 border border-amber-500/30 px-3.5 py-2.5 text-[13px] leading-5">
            <span className="flex-1 min-w-0">{loading ? "Connecting…" : "No connection to the server. Only downloaded songs can play."}</span>
            <button onClick={() => void retryNow()} disabled={retrying} className="shrink-0 rounded-full bg-[var(--fg)] text-[var(--bg)] px-3.5 py-1.5 font-semibold disabled:opacity-60">{retrying ? "Trying…" : "Try again"}</button>
          </div>
        )}
        {appUpdate && (
          <div role="status" className="mb-3 flex items-center gap-3 rounded-2xl bg-[var(--s2)] border border-[var(--bd)] px-3.5 py-2.5 text-[13px] leading-5">
            <span className="flex-1 min-w-0">New app version <b>{appUpdate.name}</b> is ready.</span>
            <button onClick={() => { try { (window as unknown as { AndroidMusic?: { installUpdate?: (u: string) => void } }).AndroidMusic?.installUpdate?.(appUpdate.url); } catch { window.open(appUpdate.url, "_blank"); } }} className="shrink-0 rounded-full bg-[var(--fg)] text-[var(--bg)] px-3.5 py-1.5 font-semibold">Update</button>
            <button onClick={() => { try { localStorage.setItem("player.appUpdateSkipped", String(appUpdate.code)); } catch { /* ignore */ } setAppUpdate(null); }} className="shrink-0 px-1.5 py-1.5 text-[var(--dim)]" aria-label="Not now"><CloseIcon size={16} /></button>
          </div>
        )}
        {updateReady && playing && <button onClick={() => window.location.reload()} className="mb-3 w-full rounded-2xl bg-[var(--s2)] py-2.5 text-[13px] font-semibold">New version ready — tap to reload</button>}
        <header className="flex items-center justify-between h-12 mb-2">
          {page ? (
            <button onClick={() => setStack((s) => s.slice(0, -1))} className="flex items-center gap-1 -ml-2 px-2 py-2 text-[15px]"><ChevronDownIcon size={22} className="rotate-90" />Back</button>
          ) : (
            <h1 className="text-[28px] font-extrabold tracking-tight">{tab === "home" ? greeting() : tab === "search" ? "Search" : tab === "library" ? "Your Library" : "Stats"}</h1>
          )}
          <span className="flex items-center gap-2">
            <button onClick={() => setSettingsOpen(true)} className="w-10 h-10 rounded-full bg-[var(--s1)] grid place-items-center" aria-label="Settings"><SettingsIcon size={20} /></button>
            <button onClick={flipTheme} className="w-10 h-10 rounded-full bg-[var(--s1)] grid place-items-center" aria-label="Toggle theme">{theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}</button>
          </span>
        </header>

        <SafeBoundary name="view" resetKey={`${tab}:${stack.length}:${page?.key ?? ""}`}>
          {page ? <MDetail page={page} api={api} c={c} />
            : tab === "home" ? <MHome api={api} c={c} />
            : tab === "search" ? <MSearch api={api} c={c} />
            : tab === "library" ? <MLibrary api={api} c={c} />
            : <StatsView api={api} />}
        </SafeBoundary>
      </div>

      {/* Repeat-one uses the browser's own gapless loop: seeking an ended element back to 0 by hand produced a pop and sometimes stopped. */}
      <audio ref={audio} loop={repeat === "one"} onError={onAudioError} onTimeUpdate={(e) => {
          const el = e.currentTarget, t = el.currentTime;
          // looped back to the start: count the finished pass as a completed listen and start a fresh one
          if (el.loop && lastPos.current - t > 1 && lastPos.current > (el.duration || 0) - 2) tracker.flush(true);
          lastPos.current = t;
          setPos(t); tracker.tick(t, el.duration);
        }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onProgress={(e) => { const a = e.currentTarget; let end = 0; for (let i = 0; i < a.buffered.length; i++) if (a.buffered.start(i) <= a.currentTime + 0.5) end = Math.max(end, a.buffered.end(i)); setBuf(end); }} onPlay={() => { audioFails.current = 0; setPlaying(true); }} onPause={() => setPlaying(false)}
        onEnded={() => { tracker.flush(true); if (sleepMin === -1) { setSleepMin(0); setPlaying(false); flash("Sleep timer: paused"); return; } step(1, true); }} />

      {/* mini player */}
      {now && !full && !selecting && (
        <div className="fixed inset-x-2 z-30 max-w-2xl mx-auto glass rounded-2xl border border-[var(--bd)] overflow-hidden" style={{ bottom: "calc(66px + env(safe-area-inset-bottom))", boxShadow: "0 12px 34px -14px rgba(0,0,0,.5)" }}>
          <div className="flex items-center gap-1 py-1 pl-2 pr-1">
            <button onClick={() => setFull(true)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label="Open player">
              <Cover t={now} tq={tq} size={44} radius={8} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 min-w-0"><Marquee className="text-[14px] font-semibold min-w-0 flex-1">{now.title}</Marquee><SourceMarks ids={now.sources} /></span>
                <Marquee className="text-xs text-[var(--dim)]">{now.artist}</Marquee>
              </span>
            </button>
            <div className="flex items-center shrink-0 -mr-0.5">
              <button onClick={() => rate(now, 1)} className={`w-11 h-11 grid place-items-center ${now.rating > 0 ? "text-rose-500" : "text-[var(--dim)]"}`} aria-label="Like"><HeartIcon size={18} filled={now.rating > 0} /></button>
              <button onClick={toggle} className="w-11 h-11 grid place-items-center" aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}</button>
              <button onClick={() => step(1)} className="w-11 h-11 grid place-items-center text-[var(--dim2)]" aria-label="Next"><NextIcon size={18} /></button>
            </div>
          </div>
          <div className="h-[3px] bg-[var(--s2)]"><div className="h-full bg-[rgb(var(--ac))]" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {/* multi-select bar */}
      {selecting && !full && (
        <div className="fixed inset-x-2 z-30 max-w-2xl mx-auto glass rounded-2xl border border-[var(--bd)] px-3 py-2 flex items-center gap-2" style={{ bottom: "calc(66px + env(safe-area-inset-bottom))", boxShadow: "0 12px 34px -14px rgba(0,0,0,.5)" }} role="toolbar" aria-label="Selected songs">
          <span className="text-[13px] font-semibold tabular-nums whitespace-nowrap">{sel.size} selected</span>
          {selPool.current.length > 0 && <button onClick={() => setSel(sel.size >= selPool.current.length ? new Set() : new Set(selPool.current))} className="text-[13px] font-semibold text-[var(--dim2)] px-1 py-1 whitespace-nowrap">{sel.size >= selPool.current.length ? "None" : "All"}</button>}
          <span className="flex-1" />
          <button disabled={sel.size === 0} onClick={() => { const ids = [...sel]; setQueue((q) => [...q, ...ids.filter((id) => !q.includes(id))]); flash(`${ids.length} added to queue`); endSelect(); }} className="px-3 py-1.5 rounded-full bg-[var(--s2)] text-[13px] font-semibold whitespace-nowrap disabled:opacity-40">＋ Queue</button>
          {canLike && accounts.some((a) => a.id > 0) && <button disabled={![...sel].some((id) => byId.get(id)?.source !== "manual")} onClick={() => setLikeTs([...sel].map((id) => byId.get(id)).filter((t): t is Track => !!t && t.source !== "manual"))} className="px-3 py-1.5 rounded-full bg-[rgb(var(--ac))] text-[var(--acfg)] text-[13px] font-semibold whitespace-nowrap disabled:opacity-40">＋ Spotify</button>}
          <button onClick={endSelect} className="p-1.5 text-[var(--dim2)]" aria-label="Done selecting"><CloseIcon size={20} /></button>
        </div>
      )}

      {/* tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-20 glass border-t border-[var(--bd0)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {tabs.map((x) => (
            <button key={x.k} onClick={() => goTab(x.k)} className={`flex flex-col items-center gap-0.5 pt-2.5 pb-2.5 text-[11px] ${tab === x.k ? "text-[var(--fg)] font-semibold" : "text-[var(--dim3)]"}`} aria-current={tab === x.k}>{x.icon}{x.label}</button>
          ))}
        </div>
      </nav>

      {/* full screen player */}
      <SafeBoundary name="now-playing" resetKey={`${now?.id}:${full}`} onClose={() => setFull(false)}>
      {now && full && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--bg)", animation: "rise .25s ease-out" }} onTouchStart={(e) => { touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }} onTouchEnd={(e) => onTouchEnd(e, "sheet")}>
          {now.hasCover && <img src={cover(now)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} className="fixed inset-0 w-full h-full object-cover blur-3xl scale-125 pointer-events-none" style={{ opacity: "var(--amb)" }} />}
          <div className="relative max-w-md mx-auto px-6 pt-[max(14px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] h-full min-h-[520px] flex flex-col">
            <div className="flex items-center justify-between h-11 shrink-0">
              <button onClick={() => setFull(false)} className="p-2 -ml-2" aria-label="Minimise"><ChevronDownIcon size={28} /></button>
              <span className="flex items-center"><button onClick={() => setSmartT(now)} className="p-2" aria-label="Smart playlist from this song"><SparkIcon size={20} /></button><button onClick={() => void share(now)} className="p-2" aria-label="Share"><ShareIcon size={22} /></button><button onClick={() => setDetailId(now.id)} className="p-2" aria-label="Details"><InfoIcon size={24} /></button><button onClick={() => setMenuT(now)} className="p-2 -mr-2" aria-label="More options"><MoreIcon size={24} /></button></span>
            </div>

            <div className="relative flex-1 min-h-0 my-2" style={{ containerType: "size" }}>
              <div data-art className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl overflow-hidden shadow-2xl bg-[var(--s2)]" style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }} onTouchStart={(e) => { e.stopPropagation(); touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }} onTouchEnd={(e) => { e.stopPropagation(); onTouchEnd(e, "art"); }}>
              <Cover t={now} tq={tq} size="100%" radius={0} />
              <div className="absolute inset-x-0 bottom-0 px-3 pb-2 pt-10 pointer-events-none" style={{ background: "linear-gradient(transparent, rgba(0,0,0,.6))" }}>
                <Spectrum audio={audio} playing={playing} enabled={viz} height={40} rgb="255,255,255" />
              </div>
              <button onClick={flipViz} className="absolute inset-x-0 bottom-0 h-14" aria-label="Toggle visualizer" />
              </div>
            </div>

            <div className="mt-2 shrink-0">
              <FitText max={22} min={14} lines={2} className="font-bold">{now.title}</FitText>
              <button onClick={() => goArtist(now)} className="block max-w-full text-left text-[var(--dim)] mt-0.5">
                <FitText max={15} min={12} lines={2}>{offline.has(now.id) && <><DownloadedBadge size={16} />{" "}</>}{now.artist}</FitText>
              </button>
              <div className="mt-1.5 flex items-start gap-2">
                <div className="min-w-0 flex-1"><SourceChips ids={now.sources} /></div>
                <div className="flex items-center shrink-0 -mr-1.5">
                  <button onClick={() => rate(now, 1)} className={`p-2 ${now.rating > 0 ? "text-rose-500" : "text-[var(--dim)]"}`} aria-label="Like"><HeartIcon size={26} filled={now.rating > 0} /></button>
                  {canLike && now.source !== "manual" && accounts.some((a) => a.id > 0) && <button onClick={() => setLikeTs([now])} className="p-2 text-[var(--dim)]" aria-label="Add to a Spotify account's likes"><PlusIcon size={22} /></button>}
                  <button onClick={() => rate(now, -1)} className={`p-2 ${now.rating < 0 ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`} aria-label="Dislike"><ThumbDownIcon size={22} filled={now.rating < 0} /></button>
                </div>
              </div>
            </div>

            <div className="mt-2 shrink-0">
              <SeekBar pos={pos} dur={dur} buffered={buf} onSeek={seek} />
            </div>

            <div className="mt-1 grid grid-cols-5 place-items-center shrink-0">
              <button onClick={toggleShuffle} className={`p-3 ${shuffle ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`} aria-label="Shuffle" aria-pressed={shuffle}><ShuffleIcon size={24} /></button>
              <button onClick={() => step(-1)} className="p-3" aria-label="Previous"><PrevIcon size={34} /></button>
              <button onClick={toggle} className="w-16 h-16 rounded-full grid place-items-center text-[var(--acfg)] active:scale-95 transition" style={{ background: "rgb(var(--ac))" }} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseIcon size={34} /> : <PlayIcon size={34} />}</button>
              <button onClick={() => step(1)} className="p-3" aria-label="Next"><NextIcon size={34} /></button>
              <button onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")} className={`p-3 ${repeat !== "off" ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`} aria-label={`Repeat ${repeat}`}><RepeatIcon size={24} one={repeat === "one"} /></button>
            </div>

            <div className="mt-2 flex items-center gap-3 shrink-0 [@media(pointer:coarse)]:hidden">
              <VolumeIcon size={18} low className="text-[var(--dim)]" />
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audio.current) audio.current.volume = v; }} className="flex-1" aria-label="Volume" />
              <VolumeIcon size={18} className="text-[var(--dim)]" />
            </div>

            <div className="mt-3 shrink-0 grid grid-cols-4 gap-1.5 text-[11px]">
              <button onClick={() => setSheet("sleep")} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] ${sleepMin ? "text-[var(--fg)] font-semibold" : "text-[var(--dim)]"}`}><TimerIcon size={20} />{sleepMin === -1 ? "End of track" : sleepMin > 0 ? `${sleepMin} min` : "Sleep"}</button>
              <button onClick={() => setSheet("speed")} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] ${speed !== 1 ? "text-[var(--fg)] font-semibold" : "text-[var(--dim)]"}`}><span className="h-5 grid place-items-center text-[15px] font-bold">{speed}×</span>Speed</button>
              <button onClick={() => hasLyrics && setSheet("lyrics")} disabled={!hasLyrics} aria-label={hasLyrics ? "Lyrics" : "No lyrics for this song"} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] ${hasLyrics ? "text-[var(--dim)]" : "text-[var(--dim3)] opacity-35"}`}><LyricsIcon size={20} />Lyrics</button>
              <button onClick={() => setSheet("queue")} className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-[var(--s1)] text-[var(--dim)]"><QueueIcon size={20} />Queue {upNextCount}</button>
            </div>
          </div>
        </div>
      )}
      </SafeBoundary>

      {full && <BackLayer onClose={() => setFull(false)} />}
      {stack.map((_, i) => <BackLayer key={i} onClose={() => setStack((s) => s.slice(0, i))} />)}
      {sheet && <BackLayer onClose={() => setSheet(null)} />}
      {menuT && <BackLayer onClose={() => setMenuT(null)} />}
      {reportT && <BackLayer onClose={() => setReportT(null)} />}
      {detailId != null && <BackLayer onClose={() => setDetailId(null)} />}
      <SafeBoundary name="sheet" resetKey={`${sheet}:${menuT?.id}:${detailId}:${likeTs?.length}`} onClose={() => { setSheet(null); setMenuT(null); setDetailId(null); setLikeTs(null); }}>
      {sheet === "queue" && <QueueSheet ids={queue} byId={byId} cur={cur} tq={tq} onClose={() => setSheet(null)} onPlay={(id) => { history.current.push(cur ?? id); setCur(id); }} onRemove={(id) => setQueue((q) => q.filter((x) => x !== id))} onMove={moveQ} onClear={() => setQueue((q) => (cur != null ? [cur] : q.slice(0, 0)))} />}
      {sheet === "sleep" && <OptionSheet title="Sleep timer" options={SLEEP} value={sleepMin} onPick={(v) => { setSleepMin(v); if (v === 0) sleepEnd.current = 0; }} onClose={() => setSheet(null)} />}
      {sheet === "speed" && <OptionSheet title="Playback speed" options={SPEEDS} value={speed} onPick={setSpeed} onClose={() => setSheet(null)} />}
      {reportT && <ReportSheet t={reportT} tq={tq} context={reportContext} onClose={() => setReportT(null)} onDone={flash} />}
      {accPl && <AccountPlaylistSheet ids={accPl.ids} mode={accPl.mode} tq={tq} accounts={accounts} blocked={!vibeData.canCreate} onClose={() => setAccPl(null)} onMessage={flash}
        onCreated={(id, name) => { flash("Playlist saved"); void load().then(() => setStack((st) => [...st, { kind: "playlist", key: String(id), title: name }])); }} />}
      {smartT && <SmartFromSongSheet blocked={!vibeData.canCreate} t={smartT} d={vibeData.tracks[smartT.id]} tq={tq} onClose={() => setSmartT(null)} onMessage={flash}
        onCreated={(id, name) => { flash("Smart playlist created"); void load().then(() => setStack((s) => [...s, { kind: "playlist", key: String(id), title: name }])); }} />}
      {smartT && <BackLayer onClose={() => setSmartT(null)} />}
      {dlPlan && <DownloadSheet label={dlPlan.label} count={dlPlan.ids.length} bytes={dlPlan.bytes} onAllow={() => void startDownload(dlPlan.ids)} onClose={() => setDlPlan(null)} />}
      {dlPlan && <BackLayer onClose={() => setDlPlan(null)} />}
      {artistPick && <ArtistPickSheet artists={artistsOf(artistPick)} counts={new Map([...c.artists.entries()].map(([k, v]) => [k, v.length]))} onPick={openArtist} onClose={() => setArtistPick(null)} />}
      {likeTs && <SpotifyLikeSheet ts={likeTs.map((t) => byId.get(t.id) ?? t)} accounts={accounts} tq={tq} onClose={() => setLikeTs(null)} onMessage={flash}
        onDone={(accId) => { const ids = new Set(likeTs.map((t) => t.id)); setTracks((all) => all.map((x) => (ids.has(x.id) ? { ...x, sources: [...new Set([...(x.sources ?? []), accId])] } : x))); if (selecting) endSelect(); }} />}
      {settingsOpen && <SettingsSheet fade={fade} fades={FADES} onFade={pickFade} accounts={accounts} scope={scope} onScope={setScope} shown={tracks.length} total={allTracks.length} downloaded={offline.size} viz={viz} onViz={flipViz} installable={!!installEvt} iosHint={isIosBrowser} onInstall={() => { void doInstall(); setSettingsOpen(false); }} onRemoveDownloads={removeDownloads} onRefresh={refreshAll} onSignOut={(w) => void signOut(w)} onClose={() => setSettingsOpen(false)} />}
      {settingsOpen && <BackLayer onClose={() => setSettingsOpen(false)} />}
      {dl && <div className="fixed left-3 right-3 z-[60] max-w-2xl mx-auto rounded-2xl glass border border-[var(--bd)] px-4 py-3 flex items-center gap-3" style={{ bottom: "calc(150px + env(safe-area-inset-bottom))" }} role="status">
        <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">Downloading {dl.done} of {dl.total}</div><div className="mt-1.5 h-1 rounded-full bg-[var(--s2)] overflow-hidden"><div className="h-full bg-[rgb(var(--ac))] transition-[width]" style={{ width: `${(dl.done / dl.total) * 100}%` }} /></div></div>
        <button onClick={() => dlCtl.current?.abort()} className="px-3 py-1.5 rounded-full bg-[var(--s2)] text-[12px] font-semibold">Stop</button>
      </div>}
      {sheet === "lyrics" && now && <LyricsSheet t={now} tq={tq} pos={pos} onSeek={seek} onClose={() => setSheet(null)} />}
      {menuT && <TrackMenu onSelect={() => startSelect(undefined, menuT.id)} onSpotify={canLike && (byId.get(menuT.id) ?? menuT).source !== "manual" && accounts.some((a) => a.id > 0) ? () => setLikeTs([menuT]) : undefined} onSmart={() => setSmartT(menuT)} onRadio={() => void startRadio(menuT)} onReport={() => setReportT(menuT)} onShare={() => void share(menuT)} offline={offline.has(menuT.id)} onOffline={() => void toggleOffline(menuT)} t={byId.get(menuT.id) ?? menuT} tq={tq} onClose={() => setMenuT(null)} onNext={() => playNext(menuT.id)} onAdd={() => addQueue(menuT.id)} onRate={(r) => rate(byId.get(menuT.id) ?? menuT, r)}
        onArtist={() => goArtist(menuT)}
        onAlbum={() => { setFull(false); setTab("library"); setStack([{ kind: "album", key: `${menuT.album ?? "Single"}|${artistsOf(menuT)[0] ?? ""}`, title: menuT.album ?? "Singles" }]); }}
        onDetails={() => setDetailId(menuT.id)} />}
      {detailId != null && byId.get(detailId) && <TrackDetail lang="en" dark chips={chipsFor(detailId)} t={byId.get(detailId)!} tq={tq} onClose={() => setDetailId(null)} onRate={(r) => rate(byId.get(detailId)!, r)} live={detailId === cur ? { pos, dur, playing } : null} />}
      </SafeBoundary>
      {toast && <div className="fixed left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full text-sm bg-[rgb(var(--ac))] text-[var(--acfg)] shadow-lg" style={{ bottom: "calc(150px + env(safe-area-inset-bottom))", animation: "fade .15s" }} role="status">{toast}</div>}
    </div>
      </NetEpochCtx.Provider>
    </AccountsCtx.Provider>
  );
}

function moodChips(m?: Record<string, number>): string[] {
  if (!m) return [];
  const out: string[] = [];
  if ((m.sad ?? 0) > 0.5) out.push("Sad"); else if ((m.happy ?? 0) > 0.5) out.push("Happy");
  if ((m.relaxed ?? 0) > 0.55) out.push("Relaxed");
  if ((m.aggressive ?? 0) > 0.4) out.push("Aggressive");
  if ((m.danceable ?? 0) > 0.6) out.push("Danceable");
  if (m.instrumental != null) out.push(m.instrumental > 0.6 ? "Instrumental" : "Vocal");
  return out;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
