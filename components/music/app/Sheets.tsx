"use client";

import { TitleLine } from "./SourceMarks";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownIcon, CheckIcon, SparkIcon, DownloadIcon, FlagIcon, ShareIcon, ArrowUpIcon, CloseIcon, HeartIcon, InfoIcon, PlayNextIcon, QueueIcon, ThumbDownIcon, ChevronRightIcon, PlusIcon } from "../Icons";
import { Cover, type Track } from "./shared";
import type { Desc } from "./Views";
import { loadLyrics } from "./lyricsCache";

export function Sheet({ onClose, title, children }: { onClose: () => void; title?: string; children: ReactNode }) {
  // Drag the handle / title down to dismiss. The panel follows the finger
  // (pointer events + touch-action:none so the browser never turns the drag
  // into pull-to-refresh or a page scroll).
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);
  const down = (e: React.PointerEvent) => { start.current = { y: e.clientY, t: Date.now() }; setDragging(true); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (start.current) setDy(Math.max(0, e.clientY - start.current.y)); };
  const up = (e: React.PointerEvent) => {
    const s = start.current; start.current = null; setDragging(false);
    if (!s) return;
    const d = Math.max(0, e.clientY - s.y), v = d / Math.max(1, Date.now() - s.t);
    if (d > 110 || (d > 40 && v > 0.6)) onClose(); else setDy(0);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true" style={{ overscrollBehavior: "contain" }}>
      <button className="absolute inset-0 bg-black/55" style={{ opacity: Math.max(0.2, 1 - dy / 500) }} onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-xl max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-[var(--bd)] bg-[var(--bg2)] pb-[max(16px,env(safe-area-inset-bottom))]"
        style={{ animation: dy === 0 && !dragging ? "rise .22s ease-out" : undefined, transform: dy ? `translateY(${dy}px)` : undefined, transition: dragging ? "none" : "transform .2s ease-out", overscrollBehavior: "contain" }}>
        <div className="sticky top-0 bg-[var(--bg2)] z-10 pt-2.5 pb-1 cursor-grab" style={{ touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="mx-auto h-1 w-10 rounded-full bg-[var(--s2)]" />
          {title && <div className="px-5 pt-3 pb-1 text-sm font-semibold text-[var(--dim2)]">{title}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

const Item = ({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-4 px-5 py-3.5 text-left text-[15px] active:bg-[var(--s1)] ${active ? "text-rose-500" : ""}`}>
    <span className="w-6 grid place-items-center text-[var(--dim2)]">{icon}</span>{label}
  </button>
);

export function TrackMenu({ onSelect, onSpotify, t, tq, onClose, onNext, onAdd, onRate, onArtist, onAlbum, onDetails, offline, onOffline, onShare, onReport, onRadio, onSmart }: {
  onShare: () => void; onReport: () => void; onRadio: () => void; onSmart?: () => void; onSpotify?: () => void; onSelect?: () => void;
  offline: boolean; onOffline: () => void;
  t: Track; tq: string; onClose: () => void; onNext: () => void; onAdd: () => void; onRate: (r: number) => void;
  onArtist: () => void; onAlbum: () => void; onDetails: () => void;
}) {
  const go = (f: () => void) => () => { f(); onClose(); };
  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center gap-3 px-5 pb-3 border-b border-[var(--bd0)]">
        <Cover t={t} tq={tq} size={52} radius={8} />
        <div className="min-w-0"><div className="font-semibold"><TitleLine title={t.title} ids={t.sources} size="md" /></div><div className="text-sm text-[var(--dim)] truncate">{t.artist}</div></div>
      </div>
      <Item icon={<SparkIcon size={22} />} label="Start radio (similar songs)" onClick={go(onRadio)} />
      {onSmart && <Item icon={<SparkIcon size={22} />} label="Smart playlist from this song…" onClick={go(onSmart)} />}
      {onSelect && <Item icon={<CheckIcon size={22} />} label="Select several songs…" onClick={go(onSelect)} />}
      {onSpotify && <Item icon={<PlusIcon size={22} />} label="Add to a Spotify account's likes…" onClick={go(onSpotify)} />}
      <Item icon={<PlayNextIcon size={22} />} label="Play next" onClick={go(onNext)} />
      <Item icon={<QueueIcon size={22} />} label="Add to queue" onClick={go(onAdd)} />
      <Item icon={<HeartIcon size={22} filled={t.rating > 0} />} label={t.rating > 0 ? "Remove from liked" : "Like"} active={t.rating > 0} onClick={go(() => onRate(1))} />
      <Item icon={<ThumbDownIcon size={22} filled={t.rating < 0} />} label={t.rating < 0 ? "Remove dislike" : "Dislike (skip in mixes)"} onClick={go(() => onRate(-1))} />
      <Item icon={<ChevronRightIcon size={22} />} label="Go to artist" onClick={go(onArtist)} />
      {t.album && <Item icon={<ChevronRightIcon size={22} />} label="Go to album" onClick={go(onAlbum)} />}
      <Item icon={<ShareIcon size={22} />} label="Share" onClick={go(onShare)} />
      <Item icon={<DownloadIcon size={22} />} label={offline ? "Remove offline copy" : "Save for offline"} onClick={go(onOffline)} />
      <Item icon={<FlagIcon size={22} />} label="Report a problem" onClick={go(onReport)} />
      <Item icon={<InfoIcon size={22} />} label="Details & stats" onClick={go(onDetails)} />
    </Sheet>
  );
}

/** A song with several artists: pick which one to open. */
export function ArtistPickSheet({ artists, counts, onPick, onClose }: { artists: string[]; counts: Map<string, number>; onPick: (artist: string) => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title="Go to artist">
      {artists.map((a) => (
        <button key={a} onClick={() => { onPick(a); onClose(); }} className="w-full flex items-center gap-3 px-5 py-3.5 text-left active:bg-[var(--s1)]">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--s2)] text-[15px] font-bold shrink-0">{(a.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium truncate">{a}</span><span className="block text-[12px] text-[var(--dim)]">{counts.get(a) ?? 0} {(counts.get(a) ?? 0) === 1 ? "song" : "songs"} in your library</span></span>
          <ChevronRightIcon size={18} className="text-[var(--dim3)]" />
        </button>
      ))}
    </Sheet>
  );
}

export function QueueSheet({ ids, byId, cur, tq, onClose, onPlay, onRemove, onMove, onClear }: {
  ids: number[]; byId: Map<number, Track>; cur: number | null; tq: string; onClose: () => void;
  onPlay: (id: number) => void; onRemove: (id: number) => void; onMove: (id: number, d: -1 | 1) => void; onClear: () => void;
}) {
  const i = cur != null ? ids.indexOf(cur) : -1;
  const upcoming = ids.slice(i + 1);
  const now = cur != null ? byId.get(cur) : null;
  return (
    <Sheet onClose={onClose} title="Queue">
      {now && (
        <div className="px-5 py-2"><div className="text-xs uppercase tracking-wide text-[var(--dim3)] mb-1">Now playing</div>
          <div className="flex items-center gap-3"><Cover t={now} tq={tq} size={44} radius={8} /><div className="min-w-0"><div className="font-medium"><TitleLine title={now.title} ids={now.sources} /></div><div className="text-xs text-[var(--dim)] truncate">{now.artist}</div></div></div></div>
      )}
      <div className="px-5 pt-2 pb-1 flex items-center justify-between"><span className="text-xs uppercase tracking-wide text-[var(--dim3)]">Up next · {upcoming.length}</span>
        {upcoming.length > 0 && <button onClick={() => { onClear(); }} className="text-xs text-[var(--dim)] underline">Clear</button>}</div>
      {upcoming.length === 0 && <div className="px-5 py-8 text-center text-sm text-[var(--dim)]">Nothing queued after this track.</div>}
      {upcoming.map((id, k) => {
        const t = byId.get(id); if (!t) return null;
        return (
          <div key={`${id}-${k}`} className="flex items-center gap-2 px-5 py-2 border-b border-[var(--bd0)]">
            <button onClick={() => onPlay(id)} className="flex items-center gap-3 min-w-0 flex-1 text-left"><Cover t={t} tq={tq} size={44} radius={8} /><span className="min-w-0"><span className="block text-[15px]"><TitleLine title={t.title} ids={t.sources} /></span><span className="block truncate text-xs text-[var(--dim)]">{t.artist}</span></span></button>
            <button onClick={() => onMove(id, -1)} disabled={k === 0} className="p-2 text-[var(--dim)] disabled:opacity-25" aria-label="Move up"><ArrowUpIcon size={18} /></button>
            <button onClick={() => onMove(id, 1)} disabled={k === upcoming.length - 1} className="p-2 text-[var(--dim)] disabled:opacity-25" aria-label="Move down"><ArrowDownIcon size={18} /></button>
            <button onClick={() => onRemove(id)} className="p-2 text-[var(--dim)]" aria-label="Remove"><CloseIcon size={18} /></button>
          </div>
        );
      })}
    </Sheet>
  );
}

export function OptionSheet<T extends string | number>({ title, options, value, onPick, onClose }: { title: string; options: { v: T; label: string }[]; value: T | null; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title={title}>
      {options.map((o) => (
        <button key={String(o.v)} onClick={() => { onPick(o.v); onClose(); }} className={`w-full flex items-center justify-between px-5 py-3.5 text-left text-[15px] active:bg-[var(--s1)] ${value === o.v ? "font-semibold" : ""}`}>
          {o.label}{value === o.v && <span className="text-xs text-[var(--dim)]">Selected</span>}
        </button>
      ))}
    </Sheet>
  );
}

type Line = { t: number; text: string };
const parseLrc = (lrc: string): Line[] => {
  const out: Line[] = [];
  for (const raw of lrc.split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
};

export function LyricsSheet({ t, tq, pos, onSeek, onClose }: { t: Track; tq: string; pos: number; onSeek: (s: number) => void; onClose: () => void }) {
  const [data, setData] = useState<{ synced: string | null; plain: string | null; found: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    loadLyrics(t.id, tq).then((j) => { if (live) setData(j); });
    return () => { live = false; };
  }, [t.id, tq]);
  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data]);
  let active = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i]!.t <= pos + 0.25) active = i; else break; }
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector<HTMLElement>("[data-active='1']")?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [active]);
  return (
    <Sheet onClose={onClose} title={`${t.title ?? ""} — Lyrics`}>
      <div ref={box} className="px-6 py-4 min-h-[50dvh] text-center">
        {data === null && <div className="py-16 text-sm text-[var(--dim)]">Loading…</div>}
        {data && !data.found && <div className="py-16 text-sm text-[var(--dim)]">No lyrics found for this track.</div>}
        {lines.length > 0 && lines.map((l, i) => (
          <button key={i} data-active={i === active ? "1" : "0"} onClick={() => onSeek(l.t)} className={`block w-full py-1.5 text-[20px] font-bold leading-snug transition-colors ${i === active ? "text-[var(--fg)]" : "text-[var(--dim3)]"}`}>{l.text || "♪"}</button>
        ))}
        {data?.found && lines.length === 0 && <pre className="whitespace-pre-wrap font-[inherit] text-[17px] leading-relaxed text-[var(--dim2)]">{data.plain}</pre>}
      </div>
    </Sheet>
  );
}

export const REPORT_REASONS: Array<[string, string]> = [
  ["wrong_song", "Wrong song / different audio"],
  ["wrong_cover", "Wrong or missing cover"],
  ["wrong_info", "Wrong title or artist"],
  ["bad_quality", "Bad sound quality"],
  ["cut_off", "Cuts off, too short or too long"],
  ["wont_play", "Won't play / keeps stalling"],
  ["glitches", "Skips, clicks or glitches"],
  ["wrong_lyrics", "Wrong lyrics"],
  ["other", "Something else"],
];

export function ReportSheet({ t, tq, context, onClose, onDone }: { t: Track; tq: string; context: () => Record<string, unknown>; onClose: () => void; onDone: (msg: string) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const ok = picked.size > 0 || note.trim().length > 0;
  async function send() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/music/${t.id}/report?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reasons: [...picked], note, context: context() }) });
      onDone(r.ok ? "Thanks — problem reported" : "Could not send the report");
      if (r.ok) onClose();
    } catch { onDone("Could not send the report"); }
    setBusy(false);
  }
  return (
    <Sheet onClose={onClose} title="Report a problem">
      <div className="px-5 pb-1 text-[13px] text-[var(--dim)] truncate">{t.title} · {t.artist}</div>
      <div className="px-2 pt-1">
        {REPORT_REASONS.map(([k, label]) => {
          const on = picked.has(k);
          return (
            <button key={k} onClick={() => toggle(k)} role="checkbox" aria-checked={on} className="w-full flex items-center gap-3 px-3 py-3 text-left text-[15px] rounded-xl active:bg-[var(--s1)]">
              <span className={`w-[22px] h-[22px] rounded-md grid place-items-center border ${on ? "bg-[rgb(var(--ac))] border-transparent text-[var(--acfg)]" : "border-[var(--bd)]"}`}>{on && <CheckIcon size={14} />}</span>
              {label}
            </button>
          );
        })}
      </div>
      <div className="px-5 pt-2">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder="Describe what's wrong (optional)…" className="w-full rounded-xl bg-[var(--s1)] border border-[var(--bd)] px-3 py-2.5 text-[15px] outline-none focus:border-[rgb(var(--ac))] resize-none" />
        <button onClick={() => void send()} disabled={!ok || busy} className="mt-3 w-full py-3 rounded-full font-semibold text-[15px] bg-[rgb(var(--ac))] text-[var(--acfg)] disabled:opacity-35 active:scale-[.98] transition">{busy ? "Sending…" : "Send report"}</button>
        <div className="mt-2 text-center text-[11px] text-[var(--dim3)]">Playback details (position, connection, app version) are attached automatically.</div>
      </div>
    </Sheet>
  );
}

/**
 * "More like this song": shows what the analysis found out about the song and
 * lets the user pick which of those parameters the new smart playlist must
 * match, with a live count. The playlist is created for THIS link only.
 */
/** "＋": put one or many songs into the Spotify Liked Songs of one connected account. */
export function SpotifyLikeSheet({ ts, accounts, tq, onClose, onDone, onMessage }: { ts: Track[]; accounts: Array<{ id: number; name: string }>; tq: string; onClose: () => void; onDone: (accountId: number) => void; onMessage: (m: string) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const real = accounts.filter((a) => a.id > 0);
  const one = ts.length === 1 ? ts[0]! : null;
  async function add(a: { id: number; name: string }) {
    setBusy(a.id); setErr(null);
    try {
      const r = await fetch(`/api/music/spotify-like?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: a.id, trackIds: ts.map((t) => t.id) }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; added?: number };
      if (r.ok) { onDone(a.id); onMessage(`${j.added ?? ts.length} ${(j.added ?? ts.length) === 1 ? "song" : "songs"} added to ${a.name}'s Liked Songs`); onClose(); } else setErr(j.error ?? "Could not add");
    } catch { setErr("Could not add"); }
    setBusy(null);
  }
  return (
    <Sheet onClose={onClose} title="Add to Spotify likes">
      <div className="px-5 pb-5">
        <div className="flex items-center gap-3 pb-3">
          {one ? <><Cover t={one} tq={tq} size={48} radius={8} /><div className="min-w-0"><div className="font-semibold truncate">{one.title}</div><div className="text-sm text-[var(--dim)] truncate">{one.artist}</div></div></>
            : <div className="font-semibold">{ts.length} songs</div>}
        </div>
        {real.length === 0 && <div className="text-[14px] text-[var(--dim)]">No Spotify account is connected.</div>}
        <div className="space-y-2">
          {real.map((a) => {
            const have = ts.filter((t) => (t.sources ?? []).includes(a.id)).length;
            const letter = (a.name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase();
            return (
              <button key={a.id} disabled={busy != null} onClick={() => void add(a)} className="w-full flex items-center gap-3 rounded-xl bg-[var(--s1)] px-3 py-3 text-left active:scale-[.99] transition disabled:opacity-60">
                <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--s2)] text-[13px] font-bold">{letter}</span>
                <span className="flex-1 min-w-0 truncate text-[15px] font-semibold">{a.name}</span>
                <span className="text-[13px] text-[var(--dim)] shrink-0">{busy === a.id ? "Adding…" : have === 0 ? "＋ Add" : have === ts.length ? "Already has it · add again" : `${have} already there · add`}</span>
              </button>
            );
          })}
        </div>
        {err && <div className="mt-3 rounded-xl bg-rose-500/10 text-rose-300 text-[13px] leading-5 px-3 py-2">{err}</div>}
        <p className="mt-3 text-[12px] text-[var(--dim3)] leading-5">Songs are saved in that account on Spotify itself, and from now on count as its songs here.</p>
      </div>
    </Sheet>
  );
}

/** Save "songs from these Spotify accounts (any / all)" as a live playlist — it keeps following the accounts. */
export function AccountPlaylistSheet({ ids, mode, tq, blocked, accounts, onClose, onCreated, onMessage }: { ids: number[]; mode: "any" | "all"; tq: string; blocked?: boolean; accounts: Array<{ id: number; name: string }>; onClose: () => void; onCreated: (id: number, name: string) => void; onMessage: (m: string) => void }) {
  const names = ids.map((i) => accounts.find((a) => a.id === i)?.name).filter((n): n is string => !!n);
  const [name, setName] = useState(`From ${names.join(mode === "all" ? " + " : " / ")}`.slice(0, 80));
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const rules = { accounts: ids, accountsMode: mode };
  useEffect(() => {
    let live = true;
    void fetch(`/api/music/smart/preview?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setPreview(j as { count: number; sample: string[] }); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rules derives from ids + mode
  }, [tq, ids.join(","), mode]);
  async function create() {
    setBusy(true);
    try {
      const r = await fetch(`/api/music/smart/create?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rules }) });
      const j = (await r.json().catch(() => ({}))) as { id?: number; error?: string };
      if (r.ok && j.id != null) { onCreated(j.id, name); onClose(); } else onMessage(j.error ?? "Could not create the playlist");
    } catch { onMessage("Could not create the playlist"); }
    setBusy(false);
  }
  return (
    <Sheet onClose={onClose} title="Save as playlist">
      <div className="px-5 pb-6">
        <p className="text-[14px] text-[var(--dim2)] leading-6">
          {mode === "all" ? "Songs that are in all of" : "Songs from any of"} <b className="text-[var(--fg)]">{names.join(", ") || "the selected accounts"}</b>. The playlist updates itself as those accounts change.
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Playlist name" className="mt-4 w-full rounded-xl bg-[var(--s2)] px-4 py-3 text-[16px] outline-none" />
        <div className="mt-3 rounded-xl bg-[var(--s1)] px-4 py-3 text-[14px] text-[var(--dim2)]">
          {preview ? <>Right now <b className="text-[var(--fg)]">{preview.count}</b> {preview.count === 1 ? "song" : "songs"}{preview.sample.length ? <div className="mt-1 text-[12px] text-[var(--dim3)] truncate">{preview.sample.slice(0, 3).join(" · ")}</div> : null}</> : "Counting…"}
        </div>
        {blocked && <p className="mt-3 text-[13px] text-rose-400">This link can&apos;t create playlists.</p>}
        <button disabled={busy || blocked || !name.trim() || preview?.count === 0} onClick={() => void create()} className="mt-5 w-full rounded-full bg-[var(--fg)] py-3.5 text-[16px] font-semibold text-[var(--bg)] disabled:opacity-40">{busy ? "Saving…" : "Save playlist"}</button>
      </div>
    </Sheet>
  );
}

export function SmartFromSongSheet({ t, d, tq, blocked, onClose, onCreated, onMessage }: { t: Track; d: Desc | undefined; tq: string; blocked?: boolean; onClose: () => void; onCreated: (id: number, name: string) => void; onMessage: (m: string) => void }) {
  const moods = (["sad", "happy", "relaxed", "aggressive", "danceable"] as const).filter((k) => (d?.moods?.[k] ?? 0) > (k === "relaxed" ? 0.55 : k === "aggressive" ? 0.4 : k === "danceable" ? 0.6 : 0.5));
  const energyWord = d ? (d.energy < 0.35 ? "low energy" : d.energy > 0.6 ? "high energy" : "medium energy") : "";
  const tag = d?.genres?.[0];
  const sub = tag ? (tag.split(" / ").pop() ?? tag) : null;
  const instr = d?.moods?.instrumental;
  const [on, setOn] = useState<Set<string>>(new Set(["tempo", "energy", ...(moods[0] ? [`mood:${moods[0]}`] : [])]));
  const [n, setN] = useState(40);
  const [name, setName] = useState(`More like ${t.title ?? "this song"}`.slice(0, 80));
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const flip = (k: string) => setOn((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });

  const rules = () => {
    const r: Record<string, unknown> = { seed: { trackId: t.id, n } };
    if (d && on.has("tempo")) r.bpm = [Math.round(d.bpm * 0.88), Math.round(d.bpm * 1.12)];
    if (d && on.has("energy")) r.energy = [Math.max(0, d.energy - 0.2), Math.min(1, d.energy + 0.2)];
    const m: Record<string, number> = {};
    for (const k of moods) if (on.has(`mood:${k}`)) m[k] = 0.5;
    if (Object.keys(m).length) r.moods = m;
    if (on.has("voice") && instr != null) r.vocal = instr > 0.5 ? "instrumental" : "vocal";
    if (on.has("genre") && sub) r.genres = [sub.toLowerCase()];
    if (on.has("mode") && d) r.mode = d.mode;
    return r;
  };
  const key = JSON.stringify([...on].sort()) + n;
  useEffect(() => {
    let live = true;
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/music/smart/preview?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: rules() }) });
        if (live && r.ok) setPreview(await r.json());
      } catch { /* offline */ }
    }, 350);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every input of rules()
  }, [key, tq]);

  async function create() {
    setBusy(true);
    try {
      const r = await fetch(`/api/music/smart/create?${tq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rules: rules() }) });
      const j = (await r.json().catch(() => ({}))) as { id?: number; error?: string };
      if (r.ok && j.id != null) { onCreated(j.id, name); onClose(); } else onMessage(j.error ?? "Could not create the playlist");
    } catch { onMessage("Could not create the playlist"); }
    setBusy(false);
  }

  const Chip = ({ k, label }: { k: string; label: string }) => (
    <button onClick={() => flip(k)} role="checkbox" aria-checked={on.has(k)} className={`px-3 py-2 rounded-full text-[13px] font-medium border transition ${on.has(k) ? "bg-[rgb(var(--ac))] text-[var(--acfg)] border-transparent" : "border-[var(--bd)] text-[var(--dim2)]"}`}>{label}</button>
  );
  return (
    <Sheet onClose={onClose} title="Smart playlist from this song">
      <div className="px-5 pb-2 flex items-center gap-3"><Cover t={t} tq={tq} size={48} radius={8} /><div className="min-w-0"><div className="font-semibold"><TitleLine title={t.title} ids={t.sources} /></div><div className="text-xs text-[var(--dim)] truncate">{t.artist}</div></div></div>
      {blocked ? (
        <div className="px-5 py-6 text-sm text-[var(--dim)] leading-6">This link isn&apos;t allowed to create playlists. Ask the owner to turn on “Create playlists in the player” for this link.</div>
      ) : !d ? (
        <div className="px-5 py-6 text-sm text-[var(--dim)]">This song hasn&apos;t been analysed yet — try again in a few minutes.</div>
      ) : (
        <div className="px-5">
          <p className="text-[13px] text-[var(--dim)] leading-5">Finds songs that sound like this one, then keeps only those that also match the parameters you leave switched on.</p>
          <div className="mt-3 text-[11px] uppercase tracking-wide text-[var(--dim3)]">Parameters of this song</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip k="tempo" label={`Tempo ~${d.bpm} BPM`} />
            <Chip k="energy" label={`Energy: ${energyWord}`} />
            {moods.map((k) => <Chip key={k} k={`mood:${k}`} label={k[0]!.toUpperCase() + k.slice(1)} />)}
            {instr != null && <Chip k="voice" label={instr > 0.5 ? "Instrumental" : "With vocals"} />}
            {sub && <Chip k="genre" label={`Genre: ${sub.replace(/\b\w/g, (c) => c.toUpperCase())}`} />}
            <Chip k="mode" label={d.mode === "minor" ? "Minor key" : "Major key"} />
          </div>
          <div className="mt-4 text-[11px] uppercase tracking-wide text-[var(--dim3)]">How many songs</div>
          <div className="mt-2 flex gap-2">{[20, 40, 60].map((v) => <button key={v} onClick={() => setN(v)} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${n === v ? "bg-[var(--s2)]" : "bg-[var(--s1)] text-[var(--dim)]"}`}>{v}</button>)}</div>
          <div className="mt-4 rounded-xl bg-[var(--s1)] px-4 py-3 text-sm min-h-[64px]">
            {preview ? (<><b>{preview.count}</b> {preview.count === 1 ? "song matches" : "songs match"} right now{preview.sample.length ? <div className="mt-1 text-xs text-[var(--dim)] truncate">{preview.sample.join(" · ")}</div> : null}</>) : <span className="text-[var(--dim)]">Counting…</span>}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-4 w-full rounded-xl bg-[var(--s1)] border border-[var(--bd)] px-3 py-2.5 text-[15px] outline-none focus:border-[rgb(var(--ac))]" aria-label="Playlist name" />
          <button onClick={() => void create()} disabled={busy || !preview || preview.count < 2} className="mt-3 w-full py-3 rounded-full font-semibold text-[15px] bg-[rgb(var(--ac))] text-[var(--acfg)] disabled:opacity-35 active:scale-[.98] transition">{busy ? "Creating…" : "Create smart playlist"}</button>
          <div className="mt-2 text-center text-[11px] text-[var(--dim3)]">It stays up to date as the library grows. Only this link gets it.</div>
        </div>
      )}
    </Sheet>
  );
}

const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);

/** Ask before storing songs on this phone (explicit permission), with the size. */
export function DownloadSheet({ label, count, bytes, onAllow, onClose }: { label: string; count: number; bytes: number; onAllow: () => void; onClose: () => void }) {
  const [free, setFree] = useState<string | null>(null);
  useEffect(() => { void navigator.storage?.estimate?.().then((e) => { if (e.quota != null && e.usage != null) setFree(mb(Math.max(0, e.quota - e.usage))); }).catch(() => {}); }, []);
  return (
    <Sheet onClose={onClose} title="Download for offline listening">
      <div className="px-5 pb-1 text-[15px] leading-6">
        Save <b>{count}</b> {count === 1 ? "song" : "songs"} from <b>{label}</b> on this phone (about <b>{mb(bytes)}</b>) so they play without internet?
        <div className="mt-2 text-[13px] text-[var(--dim)]">{free ? `Free space available to this app: ${free}. ` : ""}Downloads stay until you remove them in Settings. They are only readable by this app.</div>
      </div>
      <div className="px-5 pt-4 flex gap-3">
        <button onClick={onClose} className="flex-1 py-3 rounded-full bg-[var(--s1)] font-semibold">Not now</button>
        <button onClick={() => { onAllow(); onClose(); }} className="flex-1 py-3 rounded-full bg-[rgb(var(--ac))] text-[var(--acfg)] font-semibold">Allow & download</button>
      </div>
    </Sheet>
  );
}

/** App settings: storage, visualizer, install, and "sign out" so a different link can be used. */
export function SettingsSheet({ fade, fades, onFade, accounts, scope, onScope, shown, total, downloaded, viz, onViz, installable, iosHint, onInstall, onRemoveDownloads, onRefresh, onSignOut, onClose }: {
  fade: number; fades: Array<{ v: number; label: string }>; onFade: (v: number) => void;
  accounts: Array<{ id: number; name: string }>; scope: { ids: number[]; mode: "any" | "all" }; onScope: (v: { ids: number[]; mode: "any" | "all" }) => void; shown: number; total: number;
  downloaded: number; viz: boolean; onViz: () => void; installable: boolean; iosHint: boolean; onInstall: () => void;
  onRemoveDownloads: () => Promise<void>; onRefresh: () => Promise<void>; onSignOut: (removeDownloads: boolean) => void; onClose: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [wipe, setWipe] = useState(false);
  const refresh = () => { void navigator.storage?.estimate?.().then((e) => { if (e.usage != null) setUsage(mb(e.usage)); }).catch(() => {}); };
  useEffect(refresh, []);
  const Row = ({ label, sub, right }: { label: string; sub?: string; right: ReactNode }) => (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--bd0)]"><div className="min-w-0 flex-1"><div className="text-[15px]">{label}</div>{sub && <div className="text-[12px] text-[var(--dim)] mt-0.5">{sub}</div>}</div>{right}</div>
  );
  const btn = "px-4 py-2 rounded-full text-[13px] font-semibold bg-[var(--s2)] active:scale-95 transition";
  return (
    <Sheet onClose={onClose} title="Settings">
      <Row label="Refresh player" sub="Reload the app and your whole library. Downloaded songs stay."
        right={<button disabled={refreshing} onClick={() => { setRefreshing(true); void onRefresh(); }} className={`${btn} disabled:opacity-60`}>{refreshing ? "Refreshing…" : "Refresh"}</button>} />
      {accounts.length > 0 && (() => {
        const ids = scope.ids.filter((id) => accounts.some((a) => a.id === id));
        return (
          <div className="px-5 py-3.5 border-b border-[var(--bd0)]">
            <div className="text-[15px]">Songs from</div>
            <div className="text-[12px] text-[var(--dim)] mt-0.5">{ids.length ? `Showing ${shown} of ${total} songs everywhere in the player.` : "Everything. Pick Spotify accounts to only see their songs in every list, search and mix."}</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {accounts.map((a) => {
                const on = ids.includes(a.id);
                const letter = (a.name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase();
                return (
                  <button key={a.id} role="checkbox" aria-checked={on} onClick={() => onScope({ ...scope, ids: on ? ids.filter((x) => x !== a.id) : [...ids, a.id] })}
                    className={`inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full text-[13px] font-semibold transition ${on ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--s1)] text-[var(--dim2)]"}`}>
                    <span className={`grid place-items-center w-5 h-5 rounded-full text-[10px] font-bold ${on ? "bg-[var(--bg)] text-[var(--fg)]" : "bg-[var(--s2)]"}`}>{letter}</span>
                    <span className="max-w-[10rem] truncate">{a.name}</span>
                  </button>
                );
              })}
            </div>
            {ids.length > 0 && (
              <div className="mt-2.5 flex items-center gap-3 text-[13px]">
                {ids.length > 1 && <button onClick={() => onScope({ ...scope, mode: scope.mode === "any" ? "all" : "any" })} className="px-2.5 py-1 rounded-full text-[12px] font-semibold border border-[var(--bd)] text-[var(--dim2)]">{scope.mode === "any" ? "In any of them" : "In all of them"} ⇄</button>}
                <button onClick={() => onScope({ ids: [], mode: "any" })} className="font-semibold text-[var(--dim2)]">Show everything</button>
              </div>
            )}
          </div>
        );
      })()}
      <div className="px-5 py-3.5 border-b border-[var(--bd0)]">
        <div className="text-[15px]">Fade between songs</div>
        <div className="text-[12px] text-[var(--dim)] mt-0.5">Softly lowers the end of a song and brings the next one in.</div>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Fade between songs">
          {fades.map((f) => (
            <button key={f.v} role="radio" aria-checked={fade === f.v} onClick={() => onFade(f.v)}
              className={`py-2 rounded-full text-[13px] font-semibold transition ${fade === f.v ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--s1)] text-[var(--dim2)]"}`}>{f.v === 0 ? "Off" : `${f.v}s`}</button>
          ))}
        </div>
      </div>
      <Row label="Offline downloads" sub={`${downloaded} ${downloaded === 1 ? "song" : "songs"} on this phone${usage ? ` · app storage ${usage}` : ""}`}
        right={<button disabled={downloaded === 0} onClick={async () => { if (confirm("Remove every downloaded song from this phone?")) { await onRemoveDownloads(); refresh(); } }} className={`${btn} disabled:opacity-35`}>Remove all</button>} />
      <Row label="Spectrum on the cover" sub="Turn off to save battery" right={<button role="switch" aria-checked={viz} onClick={onViz} className={`shrink-0 w-[52px] h-8 rounded-full relative transition-colors ${viz ? "bg-[rgb(var(--ac))]" : "bg-[var(--s2)]"}`}><span className={`absolute top-1/2 -translate-y-1/2 left-1 w-6 h-6 rounded-full shadow transition-transform duration-200 ${viz ? "translate-x-5 bg-[var(--acfg)]" : "translate-x-0 bg-[var(--dim)]"}`} /></button>} />
      {(installable || iosHint) && <Row label="Install as an app" sub={installable ? "Full screen with its own icon" : "In Safari: Share → Add to Home Screen"} right={installable ? <button onClick={onInstall} className={btn}>Install</button> : <span />} />}
      {!confirmOut ? (
        <Row label="Sign out of this link" sub="Forget the link on this phone and enter a different one" right={<button onClick={() => setConfirmOut(true)} className={`${btn} text-rose-400`}>Sign out</button>} />
      ) : (
        <div className="px-5 py-4 border-b border-[var(--bd0)] text-[14px] leading-6">
          Sign out and go back to the link screen?
          <label className="mt-2 flex items-center gap-2 text-[13px] text-[var(--dim2)]"><input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} /> Also remove downloaded songs ({downloaded})</label>
          <div className="mt-3 flex gap-3"><button onClick={() => setConfirmOut(false)} className="flex-1 py-2.5 rounded-full bg-[var(--s1)] font-semibold">Cancel</button><button onClick={() => onSignOut(wipe)} className="flex-1 py-2.5 rounded-full bg-rose-500 text-white font-semibold">Sign out</button></div>
        </div>
      )}
      <div className="px-5 pt-4 text-[12px] text-[var(--dim3)] leading-5">The link is stored only on this phone. Signing out lets you paste a new link whenever you want.</div>
    </Sheet>
  );
}
