"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownIcon, CheckIcon, SparkIcon, DownloadIcon, FlagIcon, ShareIcon, ArrowUpIcon, CloseIcon, HeartIcon, InfoIcon, PlayNextIcon, QueueIcon, ThumbDownIcon, ChevronRightIcon } from "../Icons";
import { Cover, type Track } from "./shared";

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

export function TrackMenu({ t, tq, onClose, onNext, onAdd, onRate, onArtist, onAlbum, onDetails, offline, onOffline, onShare, onReport, onRadio }: {
  onShare: () => void; onReport: () => void; onRadio: () => void;
  offline: boolean; onOffline: () => void;
  t: Track; tq: string; onClose: () => void; onNext: () => void; onAdd: () => void; onRate: (r: number) => void;
  onArtist: () => void; onAlbum: () => void; onDetails: () => void;
}) {
  const go = (f: () => void) => () => { f(); onClose(); };
  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center gap-3 px-5 pb-3 border-b border-[var(--bd0)]">
        <Cover t={t} tq={tq} size={52} radius={8} />
        <div className="min-w-0"><div className="font-semibold truncate">{t.title}</div><div className="text-sm text-[var(--dim)] truncate">{t.artist}</div></div>
      </div>
      <Item icon={<SparkIcon size={22} />} label="Start radio (similar songs)" onClick={go(onRadio)} />
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
          <div className="flex items-center gap-3"><Cover t={now} tq={tq} size={44} radius={8} /><div className="min-w-0"><div className="truncate font-medium">{now.title}</div><div className="text-xs text-[var(--dim)] truncate">{now.artist}</div></div></div></div>
      )}
      <div className="px-5 pt-2 pb-1 flex items-center justify-between"><span className="text-xs uppercase tracking-wide text-[var(--dim3)]">Up next · {upcoming.length}</span>
        {upcoming.length > 0 && <button onClick={() => { onClear(); }} className="text-xs text-[var(--dim)] underline">Clear</button>}</div>
      {upcoming.length === 0 && <div className="px-5 py-8 text-center text-sm text-[var(--dim)]">Nothing queued after this track.</div>}
      {upcoming.map((id, k) => {
        const t = byId.get(id); if (!t) return null;
        return (
          <div key={`${id}-${k}`} className="flex items-center gap-2 px-5 py-2 border-b border-[var(--bd0)]">
            <button onClick={() => onPlay(id)} className="flex items-center gap-3 min-w-0 flex-1 text-left"><Cover t={t} tq={tq} size={44} radius={8} /><span className="min-w-0"><span className="block truncate text-[15px]">{t.title}</span><span className="block truncate text-xs text-[var(--dim)]">{t.artist}</span></span></button>
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
    fetch(`/api/music/${t.id}/lyrics?${tq}`).then((r) => r.json()).then((j) => { if (live) setData(j); }).catch(() => { if (live) setData({ synced: null, plain: null, found: false }); });
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
