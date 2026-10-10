"use client";

/* eslint-disable @next/next/no-img-element -- covers are private, session-gated JPEGs served by our own API; next/image cannot proxy them */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import LinksCard from "@/components/music/dashboard/LinksCard";
import Section, { Pill } from "@/components/music/dashboard/Section";
import SpotifySection, { type SpCfg, type SpLib } from "@/components/music/dashboard/SpotifySection";
import PinCard from "@/components/music/dashboard/PinCard";
import SmartPlaylistCard from "@/components/music/dashboard/SmartPlaylistCard";
import MusicStats from "@/components/music/Stats";
import TrackDetail from "@/components/music/TrackDetail";
import { useListenTracker } from "@/components/music/useListenTracker";

// Personal player: the owner's library on this server. One page — add
// Spotify links, watch downloads progress, play with queue / shuffle /
// repeat / seek, playlists, lock-screen controls (Media Session).

type Track = {
  id: number; spotifyUrl: string; title: string | null; artist: string | null; album: string | null;
  durationS: number | null; hasCover: boolean; status: "queued" | "downloading" | "ready" | "failed";
  error: string | null; sizeBytes: number | null;
  rating: number; playCount: number; skipCount: number; lastPlayedAt: string | null;
  releaseDate: string | null; mime: string | null; readyAt: string | null; createdAt: string; listenSeconds: number;
};
type Playlist = { id: number; name: string; trackIds: number[]; smart?: boolean };


const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

type Removed = { spotifyId: string; title: string | null; artist: string | null; removedAt: string };

// Songs deleted from the library stay blocked everywhere (list sync, import, pasted links) until restored here.
function RemovedSection({ onRestored }: { onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Removed[] | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/music/removed", { cache: "no-store" });
    if (r.ok) setRows(((await r.json()) as { removed: Removed[] }).removed);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!rows || rows.length === 0) return null;
  return (
    <Section icon="🗑" title="حذف‌شده‌ها" summary="این آهنگ‌ها از هیچ راهی دوباره اضافه نمی‌شوند" badge={<Pill>{fa(rows.length)}</Pill>} open={open} onOpenChange={setOpen}>
      <ul className="divide-y divide-[var(--color-border)] max-h-[50vh] overflow-y-auto">
        {rows.map((r) => (
          <li key={r.spotifyId} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm truncate" dir="auto">{r.title ?? r.spotifyId}</span>
              <span className="block text-[11px] text-[var(--color-text-dim)] truncate" dir="auto">{r.artist ?? ""}</span>
            </span>
            <button onClick={async () => { await fetch("/api/music/removed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spotifyId: r.spotifyId }) }); await load(); onRestored(); }}
              className="shrink-0 min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs active:bg-[var(--color-surface-2)]">بازگردانی</button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button role="menuitem" onClick={onClick} className={`block w-full min-h-11 px-3 py-2.5 rounded-xl text-start hover:bg-[var(--color-surface-2)] active:bg-[var(--color-surface-2)] ${danger ? "text-rose-300" : ""}`}>{children}</button>;
}

function FocusShell({ children }: { children: React.ReactNode }) {
  async function out() { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); window.location.href = "/login"; }
  return (
    <div className="min-h-screen max-w-2xl mx-auto px-4 py-5">
      <div className="flex justify-end mb-2"><button onClick={() => void out()} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-dim)]">خروج</button></div>
      {children}
    </div>
  );
}

export default function MusicPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [view, setView] = useState<"all" | "liked" | number>("all");
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [linksKey, setLinksKey] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  type Rep = { id: number; trackId: number; trackTitle: string | null; reasons: string[]; note: string | null; context: Record<string, unknown> | null; status: string; createdAt: string };
  const [reports, setReports] = useState<Rep[]>([]);
  const [reasonLabels, setReasonLabels] = useState<Record<string, string>>({});
  type Sus = { trackId: number; status: string; score: number | null; fixes: number; title: string | null; artist: string | null };
  const [verify, setVerify] = useState<{ counts: Record<string, number>; suspicious: Sus[] } | null>(null);
  const loadVerify = useCallback(async () => {
    const r = await fetch("/api/music/verify", { cache: "no-store" });
    if (r.ok) setVerify((await r.json()) as { counts: Record<string, number>; suspicious: Sus[] });
  }, []);
  useEffect(() => { void loadVerify(); const i = window.setInterval(() => void loadVerify(), 60_000); return () => window.clearInterval(i); }, [loadVerify]);
  const loadReports = useCallback(async () => {
    const r = await fetch("/api/music/reports?status=open", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { reports: Rep[]; reasons: Record<string, string> };
    setReports(j.reports); setReasonLabels(j.reasons);
  }, []);
  useEffect(() => { void loadReports(); }, [loadReports]);
  async function resolveReport(id: number) {
    await fetch(`/api/music/reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "resolved" }) });
    void loadReports();
  }
  async function redownload(trackId: number, reportId: number, via?: "spotsaver") {
    if (!confirm(via ? "یک نسخه‌ی تازه از SpotSaver گرفته شود و جای فایل فعلی بیاید؟ (تا یکی دو دقیقه طول می‌کشد)" : "فایل این آهنگ دوباره دانلود شود؟")) return;
    await fetch(`/api/music/${trackId}${via ? "?via=spotsaver" : ""}`, { method: "POST" });
    await resolveReport(reportId);
    void load();
  }
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const tracker = useListenTracker("");
  const [queue, setQueue] = useState<number[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [vol, setVol] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
  const history = useRef<number[]>([]);
  const [mixOn, setMixOn] = useState(false);
  // playlist.bz / numeric-password sign-in: just the Spotify connection card, lists folded until tapped.
  const [focus, setFocus] = useState(false);
  const [spNote, setSpNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { // back from Spotify's sign-in
    const q = new URLSearchParams(window.location.search).get("spotify");
    if (!q) return;
    const t: Record<string, string> = { connected: "حساب اسپاتیفای وصل شد ✓", denied: "اجازه داده نشد؛ حساب وصل نشد", state: "درخواست ورود منقضی شد؛ دوباره امتحان کن", failed: "وصل شدن ناموفق بود؛ دوباره امتحان کن", notallowed: "این حساب در لیست کاربران مجازِ اپ اسپاتیفای نیست؛ ایمیلش را در developer.spotify.com ← اپ ← User Management اضافه کن", nocreds: "اول Client ID / Secret در داشبورد اصلی تنظیم شود" };
    setSpNote({ ok: q === "connected", text: t[q] ?? q });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => {
    if (/(^|\.)playlist\.bz$/.test(window.location.hostname)) { setFocus(true); return; }
    void fetch("/api/auth/pin", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: { canManage?: boolean } | null) => { if (d && d.canManage === false) setFocus(true); }).catch(() => {});
  }, []);
  const [sp, setSp] = useState<SpCfg | null>(null);
  const [spLib, setSpLib] = useState<SpLib | null>(null);
  const [spErr, setSpErr] = useState<string | null>(null);
  const [spBusy, setSpBusy] = useState<string | null>(null);
  const [acct, setAcct] = useState<number | null>(null);
  const [cid, setCid] = useState("");
  const [csec, setCsec] = useState("");
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/music", { cache: "no-store" });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        setLoadErr(`بارگذاری فهرست ناموفق (${r.status}) ${e.error ?? ""}`);
        return;
      }
      const j = (await r.json()) as { tracks: Track[]; playlists: Playlist[] };
      setTracks(j.tracks); setPlaylists(j.playlists); setLoadErr(null);
    } catch (e) {
      setLoadErr(`بارگذاری فهرست ناموفق: ${String(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadSp = useCallback(async () => {
    const r = await fetch("/api/music/spotify/config", { cache: "no-store" });
    if (!r.ok) return;
    const c = (await r.json()) as SpCfg;
    setSp(c); setCid(c.clientId);
    setAcct((cur) => (cur != null && c.accounts.some((a) => a.id === cur) ? cur : c.accounts[0]?.id ?? null));
  }, []);
  useEffect(() => { void loadSp(); }, [loadSp]);
  useEffect(() => {
    if (acct == null) { setSpLib(null); return; }
    setSpLib(null); setSpErr(null);
    void fetch(`/api/music/spotify/library?account=${acct}`, { cache: "no-store" }).then(async (l) => {
      const j = (await l.json()) as SpLib & { error?: string };
      if (l.ok) setSpLib(j); else setSpErr(j.error ?? "خطا");
    });
  }, [acct]);
  async function saveCreds() {
    await fetch("/api/music/spotify/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: cid, clientSecret: csec }) });
    setCsec(""); void loadSp();
  }
  async function disconnectSp(id: number) { if (!confirm("این حساب قطع شود؟ آهنگ‌های دانلودشده می‌مانند.")) return; await fetch("/api/music/spotify/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disconnect: true, accountId: id }) }); void loadSp(); }
  const [spMsg, setSpMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  async function syncNow() {
    setSyncBusy(true); setSyncMsg("");
    const r = await fetch("/api/music/spotify/sync", { method: "POST" });
    const j = (await r.json()) as { sources?: number; added?: number; errors?: string[]; error?: string };
    setSyncBusy(false);
    setSyncMsg(r.ok ? `${j.sources} لیست بررسی شد — ${j.added} آهنگ جدید${j.errors?.length ? `، خطا: ${j.errors[0]}` : ""}` : `خطا: ${j.error}`);
    void load();
  }
  async function importSp(id: string, name: string) {
    setSpBusy(id); setMsg(null); setSpMsg(null);
    const r = await fetch("/api/music/spotify/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name, accountId: acct }) });
    const j = (await r.json()) as { total?: number; added?: number; already?: number; skipped?: number; error?: string };
    setSpBusy(null);
    const done = r.ok ? `«${name}»: ${j.total} آهنگ — ${j.added} جدید به صف دانلود، ${j.already} قبلاً بود${j.skipped ? `، ${fa(j.skipped)} حذف‌شده نادیده گرفته شد` : ""}` : `خطا: ${j.error}`;
    setMsg(done); setSpMsg(done);
    void load();
  }
  // Poll while anything is still downloading.
  useEffect(() => {
    if (!tracks.some((t) => t.status === "queued" || t.status === "downloading")) return;
    const i = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(i);
  }, [tracks, load]);

  const visible = useMemo(() => {
    let list = tracks;
    if (view === "liked") list = tracks.filter((t) => t.rating > 0);
    else if (view !== "all") {
      const ids = playlists.find((p) => p.id === view)?.trackIds ?? [];
      list = ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
    }
    const s = q.trim().toLowerCase();
    return s ? list.filter((t) => `${t.title ?? ""} ${t.artist ?? ""} ${t.album ?? ""}`.toLowerCase().includes(s)) : list;
  }, [tracks, playlists, view, q, byId]);
  const readyVisible = useMemo(() => visible.filter((t) => t.status === "ready"), [visible]);

  const playTrack = useCallback((id: number, list?: number[]) => {
    const ids = list ?? readyVisible.map((t) => t.id);
    setQueue(shuffle ? [id, ...ids.filter((x) => x !== id).sort(() => Math.random() - 0.5)] : ids);
    setMixOn(false);
    history.current = [];
    setCur(id);
  }, [readyVisible, shuffle]);

  // Smart mix: weighted random order. Likes are 3x as likely to come up
  // early, dislikes never, tracks heard in the last day are damped, and
  // frequently skipped tracks sink.
  const smartMix = useCallback(() => {
    const now = Date.now();
    const pool = readyVisible.filter((t) => t.rating >= 0).map((t) => {
      const heardRecently = t.lastPlayedAt && now - Date.parse(t.lastPlayedAt.replace(" ", "T")) < 86400000 ? 0.3 : 1;
      const w = (t.rating > 0 ? 3 : 1) * heardRecently / (1 + t.skipCount * 0.4);
      return { id: t.id, key: Math.pow(Math.random(), 1 / Math.max(w, 0.05)) };
    });
    pool.sort((a, b) => b.key - a.key);
    const ids = pool.map((p) => p.id);
    if (ids.length === 0) { setMsg("آهنگ آماده‌ی بدون دیسلایک نیست"); return; }
    setQueue(ids); setMixOn(true); history.current = []; setCur(ids[0]!);
  }, [readyVisible]);

  async function rate(t: Track, r: number) {
    const next = t.rating === r ? 0 : r;
    setTracks((all) => all.map((x) => (x.id === t.id ? { ...x, rating: next } : x)));
    await fetch(`/api/music/${t.id}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: next }) });
    if (next < 0 && cur === t.id) step(1);
  }

  useEffect(() => {
    const a = audio.current; if (!a || cur == null) return;
    tracker.begin(cur);
    a.src = `/api/music/stream/${cur}`; void a.play().catch(() => {});
    const t = byId.get(cur);
    if ("mediaSession" in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "",
        artwork: t.hasCover ? [{ src: `/api/music/cover/${t.id}`, sizes: "640x640", type: "image/jpeg" }] : [],
      });
    }
  }, [cur, byId, tracker]);

  const step = useCallback((dir: 1 | -1, auto = false) => {
    if (cur == null || queue.length === 0) return;
    const a = audio.current;
    if (dir === -1 && !auto) {
      // "Previous": restart the track if it is already underway, else go back.
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

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
    navigator.mediaSession.setActionHandler("play", () => void audio.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.current?.pause());
  }, [step]);

  async function add() {
    if (!paste.trim()) return;
    const r = await fetch("/api/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: paste }) });
    const j = (await r.json()) as { added: number; existing: number; unsupported: number; removed?: number };
    setMsg(`${j.added} آهنگ به صف دانلود اضافه شد${j.existing ? ` · ${j.existing} قبلاً بود` : ""}${j.unsupported ? ` · ${j.unsupported} لینک غیرآهنگ (فقط لینک track پشتیبانی می‌شود)` : ""}${j.removed ? ` · ${j.removed} آهنگ قبلاً حذف شده بود و اضافه نشد (از «حذف‌شده‌ها» بازگردانی کن)` : ""}`);
    setPaste(""); void load();
  }
  async function del(t: Track) { if (confirm(`«${t.title ?? "آهنگ"}» حذف شود؟\nدیگر از هیچ پلی‌لیست، همگام‌سازی یا لینکی برنمی‌گردد (از بخش «حذف‌شده‌ها» می‌شود بازگرداند).`)) { await fetch(`/api/music/${t.id}`, { method: "DELETE" }); if (cur === t.id) { audio.current?.pause(); setCur(null); } void load(); } }
  async function retry(t: Track) { await fetch(`/api/music/${t.id}`, { method: "POST" }); void load(); }
  async function repair() {
    if (!confirm("همه‌ی آهنگ‌ها از اسپاتیفای اصلاح می‌شوند (نام، خواننده، کاور) و فایل‌هایی که مال آهنگ دیگری هستند دوباره دانلود می‌شوند. ادامه؟")) return;
    setMsg("در حال اصلاح کتابخانه… (ممکن است چند دقیقه طول بکشد)");
    const r = await fetch("/api/music/repair", { method: "POST" });
    const j = (await r.json()) as { checked?: number; coversSaved?: number; wrongAudio?: number; requeued?: number; error?: string };
    setMsg(r.ok ? `${j.checked} آهنگ بررسی شد · ${j.coversSaved} کاور · ${j.wrongAudio} فایل اشتباه به صف دانلود برگشت` : `خطا: ${j.error}`);
    void load();
  }
  async function retryAll() {
    const r = await fetch("/api/music/retry-failed", { method: "POST" });
    const j = (await r.json()) as { requeued: number };
    setMsg(`${j.requeued} آهنگ ناموفق دوباره به صف رفت`); void load();
  }
  // Playlists are managed here and show up in the private player.
  async function createPlaylistWith(ids: number[], suggested: string) {
    const name = prompt("اسم پلی‌لیست جدید:", suggested);
    if (!name?.trim()) return;
    const r = await fetch("/api/music/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const { id } = (await r.json()) as { id: number };
    if (ids.length) await fetch(`/api/music/playlists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackIds: ids, present: true }) });
    setMsg(`پلی‌لیست «${name}» با ${ids.length} آهنگ ساخته شد`); setSelecting(false); setSel(new Set()); await load(); setView(id);
  }
  async function addSelectedTo(plId: number) {
    const ids = [...sel];
    await fetch(`/api/music/playlists/${plId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackIds: ids, present: true }) });
    setMsg(`${ids.length} آهنگ اضافه شد`); setSelecting(false); setSel(new Set()); void load();
  }
  async function renamePlaylist(pl: Playlist) {
    const name = prompt("اسم جدید:", pl.name);
    if (name?.trim()) { await fetch(`/api/music/playlists/${pl.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); void load(); }
  }
  async function newPlaylist() { const name = prompt("اسم پلی‌لیست:"); if (name) { await fetch("/api/music/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); void load(); } }
  async function toggleIn(pl: Playlist, t: Track) { await fetch(`/api/music/playlists/${pl.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId: t.id, present: !pl.trackIds.includes(t.id) }) }); void load(); }
  async function delPlaylist(pl: Playlist) { if (confirm(`پلی‌لیست «${pl.name}» حذف شود؟`)) { await fetch(`/api/music/playlists/${pl.id}`, { method: "DELETE" }); setView("all"); void load(); } }

  const now = cur != null ? byId.get(cur) : null;
  const upNext = useMemo(() => {
    if (cur == null) return [];
    const i = queue.indexOf(cur);
    return queue.slice(i + 1, i + 4).map((id) => byId.get(id)).filter((t): t is Track => !!t);
  }, [cur, queue, byId]);
  const btn = "px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-lg";

  const Wrap = focus ? FocusShell : Shell;
  return (
    <Wrap>
      <PageTitle title="🎧 پلیر موسیقی" subtitle="کتابخانهٔ شخصی روی سرور خودت" />
      <SpotifySection sp={sp} spLib={spLib} acct={acct} canManage={!focus} note={spNote} error={spErr} busy={spBusy} syncBusy={syncBusy} syncMsg={syncMsg} importMsg={spMsg}
        cid={cid} csec={csec} setCid={setCid} setCsec={setCsec} onSaveCreds={() => void saveCreds()} onSelect={setAcct} onDisconnect={(id) => void disconnectSp(id)}
        onSync={() => void syncNow()} onImport={(id, name) => void importSp(id, name)} onConnect={() => { window.location.href = "/api/music/spotify/login"; }} />
      {!focus && (<>

      <section className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label htmlFor="paste" className="block text-sm font-semibold mb-2">➕ افزودن آهنگ به کتابخانه</label>
        <textarea id="paste" value={paste} onChange={(e) => setPaste(e.target.value)} dir="ltr" rows={2}
          placeholder="https://open.spotify.com/track/…  (چند لینک، هر کدام در یک خط)"
          className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2.5" />
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <button onClick={add} className="min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium w-full sm:w-auto">افزودن</button>
          {msg && <span className="text-xs text-[var(--color-text-dim)] leading-6" role="status">{msg}</span>}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 mb-1">
        <button onClick={() => readyVisible[0] && playTrack(readyVisible[0].id)} disabled={readyVisible.length === 0} className="min-h-11 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50">▶ پخش همه ({readyVisible.length})</button>
        <button onClick={smartMix} disabled={readyVisible.length === 0} className={`min-h-11 rounded-xl border text-sm disabled:opacity-50 ${mixOn ? "border-amber-400 text-amber-200" : "border-[var(--color-border)]"}`}>🎲 ترکیب هوشمند</button>
      </div>
      <p className="text-[11px] text-[var(--color-text-dim)] mb-4 px-1 leading-6">لایک = بیشتر پخش می‌شود · دیسلایک = هرگز · ردشدن زود = کمتر</p>
      <SmartPlaylistCard tracks={tracks} onMessage={setMsg} onCreated={() => { void load(); setLinksKey((k) => k + 1); }} />
      <LinksCard onMessage={setMsg} refreshKey={linksKey + playlists.length} />
      <PinCard onMessage={setMsg} />
      {verify && Object.keys(verify.counts).length > 0 && (
        <Section icon="🔍" title="درستیِ فایل آهنگ‌ها" summary={`${fa(verify.counts.ok ?? 0)} تأییدشده · ${fa(verify.counts.nopreview ?? 0)} بدون پیش‌نمایش`}
          badge={(verify.counts.mismatch ?? 0) + (verify.counts.unsure ?? 0) > 0 ? <Pill tone="warn">{fa((verify.counts.mismatch ?? 0) + (verify.counts.unsure ?? 0))} مشکوک</Pill> : <Pill tone="ok">سالم</Pill>}>
          <div className="text-[11px] text-[var(--color-text-dim)]">مقایسهٔ صدای هر فایل با پیش‌نمایش ۳۰ ثانیه‌ای اسپاتیفای.</div>
          <div className="mt-2 text-xs text-[var(--color-text-dim)] leading-6">
            تأییدشده: {verify.counts.ok ?? 0} · بدون پیش‌نمایش (قابل بررسی نیست): {verify.counts.nopreview ?? 0} · مشکوک: {(verify.counts.mismatch ?? 0) + (verify.counts.unsure ?? 0)} · خطا: {verify.counts.error ?? 0}
            <span className="block">فایل نادرست یک بار خودکار از SpotSaver جایگزین می‌شود؛ اگر باز هم نخواند، اینجا می‌ماند.</span>
          </div>
          {verify.suspicious.length > 0 && (
            <div className="mt-3 space-y-2">
              {verify.suspicious.map((s) => (
                <div key={s.trackId} className="rounded-lg border border-[var(--color-border)] p-3 text-xs flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm" dir="ltr">{s.title} — {s.artist}</span>
                  <span className={`px-2 py-0.5 rounded-full ${s.status === "mismatch" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-200"}`}>{s.status === "mismatch" ? "فایل اشتباه" : "نامطمئن"} · {s.score != null ? s.score.toFixed(2) : "—"}{s.fixes > 0 ? " · یک بار اصلاح شده" : ""}</span>
                  <button onClick={async () => { await fetch(`/api/music/${s.trackId}?via=spotsaver`, { method: "POST" }); setMsg("در صف SpotSaver؛ تا یکی دو دقیقه دیگر"); void loadVerify(); }} className="px-3 py-1 rounded-md border border-[var(--color-border)]">↻ از SpotSaver</button>
                  <button onClick={async () => { if (!confirm("از ربات تلگرام دوباره دانلود شود؟")) return; await fetch(`/api/music/${s.trackId}`, { method: "POST" }); void load(); void loadVerify(); }} className="px-3 py-1 rounded-md border border-[var(--color-border)]">↻ از ربات</button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {reports.length > 0 && (
        <Section icon="🚩" title="گزارش مشکل از پلیر" summary="مشکلاتی که از پلیر گزارش شده" badge={<Pill tone="warn">{fa(reports.length)}</Pill>}>
          {(
            <div className="space-y-2">
              {reports.map((r) => (
                <div key={r.id} className="rounded-lg border border-[var(--color-border)] p-3 text-xs space-y-1.5">
                  <div className="font-medium text-sm" dir="ltr">{r.trackTitle ?? `#${r.trackId}`}</div>
                  <div className="flex flex-wrap gap-1.5" dir="ltr">{r.reasons.map((k) => <span key={k} className="px-2 py-0.5 rounded-full bg-[var(--color-surface-2)]">{reasonLabels[k] ?? k}</span>)}</div>
                  {r.note && <div className="text-[var(--color-text-dim)]" dir="auto">{r.note}</div>}
                  {r.context && <div className="text-[var(--color-text-dim)] opacity-70" dir="ltr">{["position", "duration", "connection", "online", "audioError", "build"].filter((k) => r.context![k] != null).map((k) => `${k}=${String(r.context![k])}`).join(" · ")}</div>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => void redownload(r.trackId, r.id)} className="px-3 py-1 rounded-md border border-[var(--color-border)]">↻ دانلود مجدد و بستن</button>
                    <button onClick={() => void redownload(r.trackId, r.id, "spotsaver")} className="px-3 py-1 rounded-md border border-[var(--color-border)]">↻ از SpotSaver</button>
                    <button onClick={() => void resolveReport(r.id)} className="px-3 py-1 rounded-md border border-[var(--color-border)]">✓ حل شد</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <RemovedSection key={tracks.length} onRestored={() => { setMsg("بازگردانده شد و در صف دانلود است"); void load(); }} />
      <Section icon="📊" title="آمار شنیدن" summary="چه چیزی، چقدر و کی شنیده‌ای" open={showStats} onOpenChange={setShowStats}><MusicStats tq="" /></Section>
      {loadErr && <Card className="mb-3"><p className="text-sm text-rose-300">{loadErr}</p></Card>}
      <div className="mb-3 space-y-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در کتابخانه…" aria-label="جستجو" className="w-full min-h-11 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4" />
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <button onClick={() => setView("all")} className={`text-xs min-h-9 px-3.5 rounded-full border ${view === "all" ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>همه ({tracks.length})</button>
        <button onClick={() => setView("liked")} className={`text-xs min-h-9 px-3.5 rounded-full border ${view === "liked" ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>❤️ لایک‌شده‌ها ({tracks.filter((t) => t.rating > 0).length})</button>
        {playlists.map((p) => (
          <button key={p.id} onClick={() => setView(p.id)} className={`text-xs min-h-9 px-3.5 rounded-full border ${view === p.id ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{p.smart ? "✨ " : ""}{p.name} ({p.trackIds.length})</button>
        ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center [&>button]:min-h-9">
        <button onClick={newPlaylist} className="text-xs px-3 py-1.5 rounded-md border border-dashed border-[var(--color-border)]">+ پلی‌لیست خالی</button>
        <button onClick={() => void createPlaylistWith(readyVisible.map((t) => t.id), view === "all" ? "همه" : view === "liked" ? "لایک‌های من" : playlists.find((p) => p.id === view)?.name ?? "")} disabled={readyVisible.length === 0} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] disabled:opacity-40">+ پلی‌لیست از همین نما ({readyVisible.length})</button>
        <button onClick={() => { setSelecting((v) => !v); setSel(new Set()); }} className={`text-xs px-3 py-1.5 rounded-md border ${selecting ? "border-amber-400 text-amber-200" : "border-[var(--color-border)]"}`}>☑ انتخاب چندتایی</button>
        <button onClick={repair} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">🛠 تعمیر کتابخانه</button>
        {tracks.some((t) => t.status === "failed") && (
          <button onClick={retryAll} className="text-xs px-3 py-1.5 rounded-md border border-amber-500/50 text-amber-200">↻ همه‌ی ناموفق‌ها ({tracks.filter((t) => t.status === "failed").length})</button>
        )}
        {typeof view === "number" && <button onClick={() => { const p = playlists.find((x) => x.id === view); if (p) void renamePlaylist(p); }} className="text-xs">✎ تغییر نام</button>}
        {typeof view === "number" && <button onClick={() => { const p = playlists.find((x) => x.id === view); if (p) void delPlaylist(p); }} className="text-xs text-rose-300">حذف این پلی‌لیست</button>}
        </div>
      </div>

      {selecting && (
        <Card className="mb-3 sticky top-0 z-20 !p-3">
          <div className="flex gap-2 items-center flex-wrap text-xs">
            <span>{sel.size} انتخاب‌شده</span>
            <button onClick={() => setSel(new Set(readyVisible.map((t) => t.id)))} className="px-2 py-1 rounded-md border border-[var(--color-border)]">همه‌ی این نما</button>
            <button onClick={() => setSel(new Set())} className="px-2 py-1 rounded-md border border-[var(--color-border)]">هیچ‌کدام</button>
            <select value="" disabled={sel.size === 0} onChange={(e) => { const v = e.target.value; if (v === "new") void createPlaylistWith([...sel], ""); else if (v) void addSelectedTo(Number(v)); }} className="px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-40">
              <option value="">افزودن به پلی‌لیست…</option>
              {playlists.filter((p) => !p.smart).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="new">+ پلی‌لیست جدید</option>
            </select>
          </div>
        </Card>
      )}
      <div className="flex flex-col gap-1.5 pb-44">
        {visible.length === 0 && <Card><p className="text-sm text-[var(--color-text-dim)]">هنوز آهنگی نیست. یک لینک track اسپاتیفای بالا بچسبان.</p></Card>}
        {visible.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 p-2 rounded-xl border ${t.rating < 0 ? "opacity-50" : ""} ${cur === t.id ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
            {selecting && t.status === "ready" && <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((cur0) => { const n = new Set(cur0); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="w-5 h-5 shrink-0" />}
            <button disabled={t.status !== "ready"} onClick={() => playTrack(t.id)} className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--color-surface-2)] shrink-0 grid place-items-center disabled:opacity-60">
              {t.hasCover ? <img src={`/api/music/cover/${t.id}`} alt="" className="w-full h-full object-cover" /> : <span>🎵</span>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate" dir="auto">{t.title ?? t.spotifyUrl.split("/").pop()}</div>
              <div className="text-[11px] text-[var(--color-text-dim)] truncate" dir="auto">
                {t.status === "ready" && `${t.artist ?? ""}${t.album ? ` · ${t.album}` : ""}${t.durationS ? ` · ${fmt(t.durationS)}` : ""}${t.playCount ? ` · ▶ ${t.playCount}` : ""}${t.skipCount ? ` · ⏭ ${t.skipCount}` : ""}`}
                {t.status === "queued" && "⏳ در صف دانلود"}
                {t.status === "downloading" && "⬇️ در حال دانلود از بات…"}
                {t.status === "failed" && <span className="text-rose-300">❌ {t.error ?? "ناموفق"}</span>}
              </div>
            </div>
            {t.status === "ready" && (
              <button onClick={() => rate(t, 1)} aria-label="لایک" aria-pressed={t.rating > 0} className={`shrink-0 w-10 h-10 grid place-items-center rounded-xl text-lg ${t.rating > 0 ? "" : "opacity-30 hover:opacity-70"}`}>❤️</button>
            )}
            {t.status === "failed" && <button onClick={() => retry(t)} aria-label="تلاش دوباره" className="shrink-0 w-10 h-10 grid place-items-center rounded-xl border border-[var(--color-border)]">↻</button>}
            <div className="relative shrink-0">
              <button onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} aria-label="بیشتر" aria-expanded={menuFor === t.id} className="w-10 h-10 grid place-items-center rounded-xl border border-[var(--color-border)] text-lg leading-none active:bg-[var(--color-surface-2)]">⋯</button>
              {menuFor === t.id && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                  <div role="menu" className="absolute end-0 top-full mt-1 z-40 w-60 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-1.5 text-sm">
                    <MenuItem onClick={() => { setMenuFor(null); setDetailId(t.id); }}>ℹ️ جزئیات</MenuItem>
                    {t.status === "ready" && <MenuItem onClick={() => { setMenuFor(null); rate(t, -1); }}>{t.rating < 0 ? "↩ برداشتن دیسلایک" : "👎 دیسلایک (هرگز پخش نشود)"}</MenuItem>}
                    {t.status === "ready" && <MenuItem onClick={async () => { setMenuFor(null); if (!confirm(`«${t.title ?? "آهنگ"}» دوباره از SpotSaver گرفته شود؟`)) return; await fetch(`/api/music/${t.id}?via=spotsaver`, { method: "POST" }); setMsg("در صف SpotSaver؛ تا یکی دو دقیقه دیگر جایگزین می‌شود"); void load(); }}>↻ فایل اشتباه است؟ از SpotSaver بگیر</MenuItem>}
                    {t.status === "failed" && (
                      <label className="block w-full min-h-11 px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-2)] cursor-pointer">
                        ⬆ آپلود فایل صوتی
                        <input type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav" className="hidden" onChange={async (e) => {
                          const f = e.target.files?.[0]; e.target.value = ""; setMenuFor(null); if (!f) return;
                          setMsg(`در حال آپلود «${f.name}»…`);
                          const fd = new FormData(); fd.append("file", f);
                          const r = await fetch(`/api/music/${t.id}/upload`, { method: "POST", body: fd });
                          const j = (await r.json().catch(() => ({}))) as { error?: string };
                          setMsg(r.ok ? `«${t.title ?? "آهنگ"}» آماده شد` : `آپلود ناموفق: ${j.error ?? r.status}`); void load();
                        }} />
                      </label>
                    )}
                    {t.status === "ready" && playlists.some((pl) => !pl.smart) && (
                      <div className="mt-1 pt-1 border-t border-[var(--color-border)]">
                        <div className="px-3 py-1 text-[11px] text-[var(--color-text-dim)]">پلی‌لیست‌ها</div>
                        <div className="max-h-40 overflow-y-auto">
                          {playlists.filter((pl) => !pl.smart).map((pl) => <MenuItem key={pl.id} onClick={() => void toggleIn(pl, t)}>{pl.trackIds.includes(t.id) ? "✓ " : "＋ "}{pl.name}</MenuItem>)}
                        </div>
                      </div>
                    )}
                    <div className="mt-1 pt-1 border-t border-[var(--color-border)]"><MenuItem danger onClick={() => { setMenuFor(null); del(t); }}>🗑 حذف از کتابخانه</MenuItem></div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <audio ref={audio} onTimeUpdate={(e) => { setPos(e.currentTarget.currentTime); tracker.tick(e.currentTarget.currentTime, e.currentTarget.duration); }} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { tracker.flush(true); step(1, true); }} />
      {now && (
        <div className="fixed bottom-16 md:bottom-0 inset-x-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur px-4 py-2">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3">
              {now.hasCover ? <img src={`/api/music/cover/${now.id}`} alt="" className="w-11 h-11 rounded-md" /> : <span className="text-2xl">🎵</span>}
              <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{now.title}</div><div className="text-[11px] text-[var(--color-text-dim)] truncate">{now.artist}</div></div>
              <button className={btn} onClick={() => setDetailId(now.id)} title="جزئیات">ℹ️</button>
              <button className={`${btn} ${now.rating > 0 ? "" : "opacity-40"}`} onClick={() => void rate(now, 1)} title="لایک">❤️</button>
              <button className={`${btn} ${now.rating < 0 ? "" : "opacity-40"}`} onClick={() => void rate(now, -1)} title="دیسلایک (بعدی)">👎</button>
              <button className={btn} onClick={() => step(-1)}>⏮</button>
              <button className={btn} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}>{playing ? "⏸" : "▶️"}</button>
              <button className={btn} onClick={() => step(1)}>⏭</button>
            </div>
            {upNext.length > 0 && <div className="text-[11px] text-[var(--color-text-dim)] truncate mt-0.5">بعدی: {upNext.map((t) => t.title ?? "—").join(" · ")}</div>}
            <div className="flex items-center gap-2 mt-1" dir="ltr">
              <span className="text-[11px] w-9 text-right">{fmt(pos)}</span>
              <input type="range" min={0} max={dur || 1} step={1} value={pos} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} className="flex-1" />
              <span className="text-[11px] w-9">{fmt(dur)}</span>
              <button className={`text-sm ${shuffle ? "text-amber-300" : "text-[var(--color-text-dim)]"}`} onClick={() => setShuffle((s) => !s)} title="شافل">🔀</button>
              <button className={`text-sm ${repeat !== "off" ? "text-amber-300" : "text-[var(--color-text-dim)]"}`} onClick={() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))} title="تکرار">{repeat === "one" ? "🔂" : "🔁"}</button>
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audio.current) audio.current.volume = v; }} className="w-20" />
            </div>
          </div>
        </div>
      )}
      {detailId != null && byId.get(detailId) && <TrackDetail t={byId.get(detailId)!} tq="" onClose={() => setDetailId(null)} onRate={(r) => void rate(byId.get(detailId)!, r)} live={detailId === cur ? { pos, dur, playing } : null} />}
    </>)}
    </Wrap>
  );
}
