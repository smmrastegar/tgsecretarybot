"use client";

import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, HeartIcon, InfoIcon, PlayNextIcon, QueueIcon, ThumbDownIcon, ChevronRightIcon } from "../Icons";
import { Cover, type Track } from "./shared";

export function Sheet({ onClose, title, children }: { onClose: () => void; title?: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-xl max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-[var(--bd)] bg-[var(--bg2)] pb-[max(16px,env(safe-area-inset-bottom))]" style={{ animation: "rise .22s ease-out" }}>
        <div className="sticky top-0 bg-[var(--bg2)] z-10 pt-2.5 pb-1">
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

export function TrackMenu({ t, tq, onClose, onNext, onAdd, onRate, onArtist, onAlbum, onDetails }: {
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
      <Item icon={<PlayNextIcon size={22} />} label="Play next" onClick={go(onNext)} />
      <Item icon={<QueueIcon size={22} />} label="Add to queue" onClick={go(onAdd)} />
      <Item icon={<HeartIcon size={22} filled={t.rating > 0} />} label={t.rating > 0 ? "Remove from liked" : "Like"} active={t.rating > 0} onClick={go(() => onRate(1))} />
      <Item icon={<ThumbDownIcon size={22} filled={t.rating < 0} />} label={t.rating < 0 ? "Remove dislike" : "Dislike (skip in mixes)"} onClick={go(() => onRate(-1))} />
      <Item icon={<ChevronRightIcon size={22} />} label="Go to artist" onClick={go(onArtist)} />
      {t.album && <Item icon={<ChevronRightIcon size={22} />} label="Go to album" onClick={go(onAlbum)} />}
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
