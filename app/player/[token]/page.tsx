"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

// Private personal player. No dashboard, no login: the URL's 256-bit
// token is the credential. Play, queue, smart mix, like / dislike,
// previous / next, seek, shuffle, repeat, volume, lock-screen controls.

type Track = {
  id: number; title: string | null; artist: string | null; album: string | null; durationS: number | null;
  hasCover: boolean; status: string; rating: number; playCount: number; skipCount: number; lastPlayedAt: string | null;
};
type Playlist = { id: number; name: string; trackIds: number[] };

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

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
  const audio = useRef<HTMLAudioElement>(null);
  const history = useRef<number[]>([]);
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

  const event = useCallback((id: number, e: "play" | "complete" | "skip") => {
    void fetch(`/api/music/${id}/event?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: e }) });
  }, [tq]);

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
    if (!auto && dir === 1 && a && a.duration > 0 && a.currentTime / a.duration < 0.3) event(cur, "skip");
    const i = queue.indexOf(cur); let n = i + dir;
    if (n >= queue.length) { if (repeat === "all" || !auto) n = 0; else { setPlaying(false); return; } }
    if (n < 0) n = queue.length - 1;
    if (dir === 1) history.current.push(cur);
    setCur(queue[n]!);
  }, [cur, queue, repeat, event]);

  async function rate(t: Track, r: number) {
    const next = t.rating === r ? 0 : r;
    setTracks((all) => all.map((x) => (x.id === t.id ? { ...x, rating: next } : x)));
    await fetch(`/api/music/${t.id}/rate?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: next }) });
    if (next < 0 && cur === t.id) step(1);
  }

  useEffect(() => {
    const a = audio.current; if (!a || cur == null) return;
    a.src = `/api/music/stream/${cur}?${tq}`; void a.play().catch(() => {});
    const t = byId.get(cur);
    if ("mediaSession" in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title ?? "—", artist: t.artist ?? "", album: t.album ?? "",
        artwork: t.hasCover ? [{ src: `/api/music/cover/${t.id}?${tq}`, sizes: "640x640", type: "image/jpeg" }] : [],
      });
    }
  }, [cur, byId, tq]);
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
    return queue.slice(i + 1, i + 4).map((id) => byId.get(id)).filter((t): t is Track => !!t);
  }, [cur, queue, byId]);
  const chip = (on: boolean) => `text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${on ? "border-emerald-400 text-emerald-300 bg-emerald-400/10" : "border-zinc-700 text-zinc-300"}`;
  const btn = "px-3 py-2 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-lg";

  if (denied) return <div dir="rtl" style={{ background: "#0b0b0f", color: "#71717a", minHeight: "100dvh" }} className="grid place-items-center text-sm">این لینک معتبر نیست.</div>;

  return (
    <div dir="rtl" style={{ background: "#0b0b0f", color: "#e4e4e7", minHeight: "100dvh", fontFamily: "Vazirmatn, -apple-system, system-ui, sans-serif" }}>
      <div className="max-w-3xl mx-auto px-4 pt-5 pb-48">
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <button onClick={() => setView("all")} className={chip(view === "all")}>همه ({tracks.length})</button>
          <button onClick={() => setView("liked")} className={chip(view === "liked")}>❤️ لایک‌ها ({tracks.filter((t) => t.rating > 0).length})</button>
          {playlists.map((p) => <button key={p.id} onClick={() => setView(p.id)} className={chip(view === p.id)}>{p.name}</button>)}
        </div>
        <div className="flex gap-2 mb-3 flex-wrap">
          <button onClick={() => visible[0] && playTrack(visible[0].id)} disabled={!visible.length} className="px-4 py-2 rounded-xl bg-emerald-500 text-black font-medium text-sm disabled:opacity-40">▶ پخش همه</button>
          <button onClick={smartMix} disabled={!visible.length} className={`px-4 py-2 rounded-xl border text-sm disabled:opacity-40 ${mixOn ? "border-amber-400 text-amber-200" : "border-zinc-700"}`}>🎲 ترکیب هوشمند</button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو…" className="mr-auto text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          {visible.length === 0 && <div className="text-sm text-zinc-500 py-10 text-center">آهنگی نیست.</div>}
          {visible.map((t) => (
            <div key={t.id} className={`flex items-center gap-3 p-2 rounded-2xl border ${t.rating < 0 ? "opacity-40" : ""} ${cur === t.id ? "border-emerald-400 bg-emerald-400/10" : "border-zinc-800 bg-zinc-900/60"}`}>
              <button onClick={() => playTrack(t.id)} className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-800 shrink-0 grid place-items-center">
                {t.hasCover ? <img src={`/api/music/cover/${t.id}?${tq}`} alt="" className="w-full h-full object-cover" /> : <span>🎵</span>}
              </button>
              <button onClick={() => playTrack(t.id)} className="min-w-0 flex-1 text-right">
                <div className="text-sm font-medium truncate">{t.title ?? "—"}</div>
                <div className="text-[11px] text-zinc-400 truncate">{t.artist}{t.durationS ? ` · ${fmt(t.durationS)}` : ""}</div>
              </button>
              <button onClick={() => void rate(t, 1)} className={`text-base px-1 ${t.rating > 0 ? "" : "opacity-30 hover:opacity-70"}`}>❤️</button>
              <button onClick={() => void rate(t, -1)} className={`text-base px-1 ${t.rating < 0 ? "" : "opacity-30 hover:opacity-70"}`}>👎</button>
            </div>
          ))}
        </div>
      </div>

      <audio ref={audio} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { if (cur != null) event(cur, "complete"); step(1, true); }} />
      {now && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 py-2">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3">
              {now.hasCover ? <img src={`/api/music/cover/${now.id}?${tq}`} alt="" className="w-11 h-11 rounded-lg" /> : <span className="text-2xl">🎵</span>}
              <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{now.title}</div><div className="text-[11px] text-zinc-400 truncate">{now.artist}</div></div>
              <button className={`${btn} ${now.rating > 0 ? "" : "opacity-40"}`} onClick={() => void rate(now, 1)}>❤️</button>
              <button className={`${btn} ${now.rating < 0 ? "" : "opacity-40"}`} onClick={() => void rate(now, -1)}>👎</button>
              <button className={btn} onClick={() => step(-1)}>⏮</button>
              <button className={btn} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}>{playing ? "⏸" : "▶️"}</button>
              <button className={btn} onClick={() => step(1)}>⏭</button>
            </div>
            {upNext.length > 0 && <div className="text-[11px] text-zinc-500 truncate mt-0.5">بعدی: {upNext.map((t) => t.title ?? "—").join(" · ")}</div>}
            <div className="flex items-center gap-2 mt-1" dir="ltr">
              <span className="text-[11px] w-9 text-right">{fmt(pos)}</span>
              <input type="range" min={0} max={dur || 1} step={1} value={pos} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} className="flex-1" />
              <span className="text-[11px] w-9">{fmt(dur)}</span>
              <button className={`text-sm ${shuffle ? "text-amber-300" : "text-zinc-500"}`} onClick={() => setShuffle((s) => !s)}>🔀</button>
              <button className={`text-sm ${repeat !== "off" ? "text-amber-300" : "text-zinc-500"}`} onClick={() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))}>{repeat === "one" ? "🔂" : "🔁"}</button>
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audio.current) audio.current.volume = v; }} className="w-20" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
