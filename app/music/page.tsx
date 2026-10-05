"use client";

/* eslint-disable @next/next/no-img-element -- covers are private, session-gated JPEGs served by our own API; next/image cannot proxy them */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

// Personal player: the owner's library on this server. One page — add
// Spotify links, watch downloads progress, play with queue / shuffle /
// repeat / seek, playlists, lock-screen controls (Media Session).

type Track = {
  id: number; spotifyUrl: string; title: string | null; artist: string | null; album: string | null;
  durationS: number | null; hasCover: boolean; status: "queued" | "downloading" | "ready" | "failed";
  error: string | null; sizeBytes: number | null;
};
type Playlist = { id: number; name: string; trackIds: number[] };

type SpCfg = { hasCredentials: boolean; clientId: string; accounts: Array<{ id: number; displayName: string | null; spotifyUserId: string }>; redirectUri: string };
type SpLib = { playlists: Array<{ id: string; name: string; tracks: number; owner: string }>; likedCount: number; me: string };

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

export default function MusicPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [view, setView] = useState<"all" | number>("all");
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [vol, setVol] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
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
  async function importSp(id: string, name: string) {
    setSpBusy(id); setMsg(null);
    const r = await fetch("/api/music/spotify/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name, accountId: acct }) });
    const j = (await r.json()) as { total?: number; added?: number; already?: number; error?: string };
    setSpBusy(null);
    setMsg(r.ok ? `«${name}»: ${j.total} آهنگ — ${j.added} جدید به صف دانلود، ${j.already} قبلاً بود` : `خطا: ${j.error}`);
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
    if (view !== "all") {
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
    setCur(id);
  }, [readyVisible, shuffle]);

  useEffect(() => {
    const a = audio.current; if (!a || cur == null) return;
    a.src = `/api/music/stream/${cur}`; void a.play().catch(() => {});
    const t = byId.get(cur);
    if ("mediaSession" in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "",
        artwork: t.hasCover ? [{ src: `/api/music/cover/${t.id}`, sizes: "640x640", type: "image/jpeg" }] : [],
      });
    }
  }, [cur, byId]);

  const step = useCallback((dir: 1 | -1, auto = false) => {
    if (cur == null || queue.length === 0) return;
    if (auto && repeat === "one") { const a = audio.current; if (a) { a.currentTime = 0; void a.play(); } return; }
    const i = queue.indexOf(cur); let n = i + dir;
    if (n >= queue.length) { if (repeat === "all" || !auto) n = 0; else { setPlaying(false); return; } }
    if (n < 0) n = queue.length - 1;
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
    const j = (await r.json()) as { added: number; existing: number; unsupported: number };
    setMsg(`${j.added} آهنگ به صف دانلود اضافه شد${j.existing ? ` · ${j.existing} قبلاً بود` : ""}${j.unsupported ? ` · ${j.unsupported} لینک غیرآهنگ (فقط لینک track پشتیبانی می‌شود)` : ""}`);
    setPaste(""); void load();
  }
  async function del(t: Track) { if (confirm(`«${t.title ?? "آهنگ"}» حذف شود؟`)) { await fetch(`/api/music/${t.id}`, { method: "DELETE" }); if (cur === t.id) { audio.current?.pause(); setCur(null); } void load(); } }
  async function retry(t: Track) { await fetch(`/api/music/${t.id}`, { method: "POST" }); void load(); }
  async function retryAll() {
    const r = await fetch("/api/music/retry-failed", { method: "POST" });
    const j = (await r.json()) as { requeued: number };
    setMsg(`${j.requeued} آهنگ ناموفق دوباره به صف رفت`); void load();
  }
  async function newPlaylist() { const name = prompt("اسم پلی‌لیست:"); if (name) { await fetch("/api/music/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); void load(); } }
  async function toggleIn(pl: Playlist, t: Track) { await fetch(`/api/music/playlists/${pl.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId: t.id, present: !pl.trackIds.includes(t.id) }) }); void load(); }
  async function delPlaylist(pl: Playlist) { if (confirm(`پلی‌لیست «${pl.name}» حذف شود؟`)) { await fetch(`/api/music/playlists/${pl.id}`, { method: "DELETE" }); setView("all"); void load(); } }

  const now = cur != null ? byId.get(cur) : null;
  const btn = "px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-lg";

  return (
    <Shell>
      <PageTitle title="🎧 پلیر موسیقی" subtitle="کتابخانه‌ی شخصی روی سرور خودت. لینک آهنگ اسپاتیفای بده؛ از بات دانلودر گرفته و ذخیره می‌شود." />
      <Card className="mb-4">
        <div className="text-sm font-medium mb-2">🟢 اتصال به اسپاتیفای (لایک‌ها و پلی‌لیست‌ها)</div>
        {sp && (sp.accounts.length === 0 || !sp.hasCredentials) && (
          <div className="text-xs text-[var(--color-text-dim)] space-y-2">
            <p>یک‌بار: در developer.spotify.com/dashboard یک App بساز، این آدرس را به‌عنوان Redirect URI ثبت کن، و Client ID / Secret را اینجا بده.</p>
            <div dir="ltr" className="font-mono bg-[var(--color-surface-2)] rounded px-2 py-1 select-all break-all">{sp.redirectUri}</div>
            <div className="flex gap-2 flex-wrap" dir="ltr">
              <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="Client ID" className="flex-1 min-w-40 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5" />
              <input value={csec} onChange={(e) => setCsec(e.target.value)} type="password" placeholder={sp.hasCredentials ? "Client Secret (ذخیره شده)" : "Client Secret"} className="flex-1 min-w-40 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5" />
              <button onClick={saveCreds} className="px-3 py-1.5 rounded-md border border-[var(--color-border)] text-sm">ذخیره</button>
            </div>
          </div>
        )}
        {sp?.hasCredentials && (
          <div className="text-xs space-y-2 mt-2">
            <div className="flex flex-wrap gap-2 items-center">
              {sp.accounts.map((a) => (
                <span key={a.id} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${acct === a.id ? "border-[#1db954] text-[#1db954]" : "border-[var(--color-border)]"}`}>
                  <button onClick={() => setAcct(a.id)}>{a.displayName ?? a.spotifyUserId}</button>
                  <button onClick={() => disconnectSp(a.id)} title="قطع" className="text-rose-300">×</button>
                </span>
              ))}
              <button onClick={() => { window.location.href = "/api/music/spotify/login"; }} className="px-3 py-1 rounded-full bg-[#1db954] text-black font-medium">{sp.accounts.length ? "+ حساب دیگر" : "ورود با اسپاتیفای"}</button>
            </div>
            {spErr && <div className="text-rose-300">{spErr}</div>}
            {spLib && <div className="text-[var(--color-text-dim)]">روی هر لیست بزن تا آهنگ‌هایش وارد صف دانلود شود (حساب فعلی: «{spLib.me}»):</div>}
            <div className="flex flex-wrap gap-2">
              {spLib && <button disabled={!!spBusy} onClick={() => importSp("liked", `لایک‌ها (${spLib.me})`)} className="px-3 py-1.5 rounded-md border border-[#1db954] text-[#1db954] disabled:opacity-50">{spBusy === "liked" ? "…" : `♥ لایک‌ها (${spLib.likedCount})`}</button>}
              {spLib?.playlists.map((p) => (
                <button key={p.id} disabled={!!spBusy} onClick={() => importSp(p.id, p.name)} className="px-3 py-1.5 rounded-md border border-[var(--color-border)] disabled:opacity-50">{spBusy === p.id ? "…" : `${p.name} (${p.tracks})`}</button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} dir="ltr" rows={2}
          placeholder="https://open.spotify.com/track/…  (چند لینک، هر کدام در یک خط)"
          className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2" />
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <button onClick={add} className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm">افزودن به کتابخانه</button>
          {msg && <span className="text-xs text-[var(--color-text-dim)]">{msg}</span>}
        </div>
      </Card>

      {loadErr && <Card className="mb-3"><p className="text-sm text-rose-300">{loadErr}</p></Card>}
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <button onClick={() => setView("all")} className={`text-xs px-3 py-1.5 rounded-md border ${view === "all" ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>همه ({tracks.length})</button>
        {playlists.map((p) => (
          <button key={p.id} onClick={() => setView(p.id)} className={`text-xs px-3 py-1.5 rounded-md border ${view === p.id ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{p.name} ({p.trackIds.length})</button>
        ))}
        <button onClick={newPlaylist} className="text-xs px-3 py-1.5 rounded-md border border-dashed border-[var(--color-border)]">+ پلی‌لیست</button>
        {tracks.some((t) => t.status === "failed") && (
          <button onClick={retryAll} className="text-xs px-3 py-1.5 rounded-md border border-amber-500/50 text-amber-200">↻ همه‌ی ناموفق‌ها ({tracks.filter((t) => t.status === "failed").length})</button>
        )}
        {view !== "all" && <button onClick={() => { const p = playlists.find((x) => x.id === view); if (p) void delPlaylist(p); }} className="text-xs text-rose-300">حذف این پلی‌لیست</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو…" className="mr-auto text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5" />
      </div>

      <div className="flex flex-col gap-1.5 pb-44">
        {visible.length === 0 && <Card><p className="text-sm text-[var(--color-text-dim)]">هنوز آهنگی نیست. یک لینک track اسپاتیفای بالا بچسبان.</p></Card>}
        {visible.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 p-2 rounded-xl border ${cur === t.id ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
            <button disabled={t.status !== "ready"} onClick={() => playTrack(t.id)} className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--color-surface-2)] shrink-0 grid place-items-center disabled:opacity-60">
              {t.hasCover ? <img src={`/api/music/cover/${t.id}`} alt="" className="w-full h-full object-cover" /> : <span>🎵</span>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{t.title ?? t.spotifyUrl.split("/").pop()}</div>
              <div className="text-[11px] text-[var(--color-text-dim)] truncate">
                {t.status === "ready" && `${t.artist ?? ""}${t.album ? ` · ${t.album}` : ""}${t.durationS ? ` · ${fmt(t.durationS)}` : ""}`}
                {t.status === "queued" && "⏳ در صف دانلود"}
                {t.status === "downloading" && "⬇️ در حال دانلود از بات…"}
                {t.status === "failed" && <span className="text-rose-300">❌ {t.error ?? "ناموفق"}</span>}
              </div>
            </div>
            {t.status === "ready" && playlists.length > 0 && (
              <select value="" onChange={(e) => { const pl = playlists.find((p) => p.id === Number(e.target.value)); if (pl) void toggleIn(pl, t); }} className="text-[11px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1 py-1 w-20">
                <option value="">+ لیست</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.trackIds.includes(t.id) ? "✓ " : ""}{p.name}</option>)}
              </select>
            )}
            {t.status === "failed" && <button onClick={() => retry(t)} className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)]">↻</button>}
            <button onClick={() => del(t)} className="text-xs px-2 py-1 rounded-md border border-rose-500/40 text-rose-200">🗑</button>
          </div>
        ))}
      </div>

      <audio ref={audio} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => step(1, true)} />
      {now && (
        <div className="fixed bottom-16 md:bottom-0 inset-x-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur px-4 py-2">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3">
              {now.hasCover ? <img src={`/api/music/cover/${now.id}`} alt="" className="w-11 h-11 rounded-md" /> : <span className="text-2xl">🎵</span>}
              <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{now.title}</div><div className="text-[11px] text-[var(--color-text-dim)] truncate">{now.artist}</div></div>
              <button className={btn} onClick={() => step(-1)}>⏮</button>
              <button className={btn} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}>{playing ? "⏸" : "▶️"}</button>
              <button className={btn} onClick={() => step(1)}>⏭</button>
            </div>
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
    </Shell>
  );
}
