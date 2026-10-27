"use client";

import { TitleLine } from "./SourceMarks";
import { useRef, useState, type ReactNode } from "react";
import { CheckIcon, SparkIcon, DownloadIcon, FlagIcon, ShareIcon, HeartIcon, InfoIcon, PlayNextIcon, QueueIcon, ThumbDownIcon, ChevronRightIcon, PlusIcon, SkipOffIcon } from "../Icons";
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

export const Item = ({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-4 px-5 py-3.5 text-left text-[15px] active:bg-[var(--s1)] ${active ? "text-rose-500" : ""}`}>
    <span className="w-6 grid place-items-center text-[var(--dim2)]">{icon}</span>{label}
  </button>
);

export function TrackMenu({ onSelect, onSpotify, t, tq, onClose, onNext, onAdd, onRate, onArtist, onUploader, onSkip, skipped, onAlbum, onDetails, offline, onOffline, onShare, onReport, onRadio, onSmart }: {
  onShare: () => void; onReport: () => void; onRadio: () => void; onSmart?: () => void; onSpotify?: () => void; onSelect?: () => void;
  offline: boolean; onOffline: () => void;
  t: Track; tq: string; onClose: () => void; onNext: () => void; onAdd: () => void; onRate: (r: number) => void;
  onArtist: () => void; onUploader?: () => void; onSkip: () => void; skipped: boolean; onAlbum: () => void; onDetails: () => void;
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
      <Item icon={<SkipOffIcon size={22} />} label={skipped ? "Take off skip (play it again)" : "Skip mode (keep in list, don't play)"} active={skipped} onClick={go(onSkip)} />
      <Item icon={<ThumbDownIcon size={22} filled={t.rating < 0} />} label={t.rating < 0 ? "Remove dislike" : "Dislike (skip in mixes)"} onClick={go(() => onRate(-1))} />
      <Item icon={<ChevronRightIcon size={22} />} label="Go to artist" onClick={go(onArtist)} />
      {onUploader && t.uploadedBy && <Item icon={<ChevronRightIcon size={22} />} label={`More from uploader ${t.uploadedBy}`} onClick={go(onUploader)} />}
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
