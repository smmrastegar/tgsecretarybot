"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import { PlayIcon } from "../Icons";

export type Track = {
  id: number; title: string | null; artist: string | null; album: string | null; durationS: number | null;
  spotifyUrl?: string; hasCover: boolean; status: string; rating: number; playCount: number; skipCount: number; lastPlayedAt: string | null;
  releaseDate: string | null; mime: string | null; readyAt: string | null; createdAt: string; listenSeconds: number; sizeBytes: number | null;
};
export type Playlist = { id: number; name: string; trackIds: number[] };

export const fmt = (s: number) => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

export const ts = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isFinite(t) ? t : 0;
};

export type Ctx = { tq: string };
export const coverUrl = (t: Pick<Track, "id">, tq: string) => `/api/music/cover/${t.id}?${tq}`;

/** Cover art, or a tinted letter tile when the track has none. */
export function Cover({ t, tq, size, radius = 10, className = "" }: { t: Pick<Track, "id" | "title" | "hasCover">; tq: string; size: number | string; radius?: number; className?: string }) {
  const hue = (t.id * 47) % 360;
  const box = { width: size, height: size, borderRadius: radius };
  return t.hasCover ? (
    <img src={coverUrl(t, tq)} alt="" loading="lazy" decoding="async" className={`object-cover bg-[var(--s2)] shrink-0 ${className}`} style={box} />
  ) : (
    <span className={`grid place-items-center shrink-0 font-bold text-white/85 ${className}`} style={{ ...box, background: `linear-gradient(135deg, hsl(${hue} 50% 36%), hsl(${(hue + 40) % 360} 55% 20%))`, fontSize: typeof size === "number" ? size * 0.4 : undefined }}>
      {(t.title ?? "♪").trim().charAt(0).toUpperCase() || "♪"}
    </span>
  );
}

/** 2×2 collage of a list's covers (playlist artwork). */
export function Mosaic({ tracks, tq, size, radius = 12 }: { tracks: Track[]; tq: string; size: number | string; radius?: number }) {
  const four = tracks.slice(0, 4);
  if (four.length < 4) {
    return four[0] ? <Cover t={four[0]} tq={tq} size={size} radius={radius} /> : <span className="shrink-0 bg-[var(--s2)]" style={{ width: size, height: size, borderRadius: radius }} />;
  }
  return (
    <span className="grid grid-cols-2 overflow-hidden shrink-0 bg-[var(--s2)]" style={{ width: size, height: size, borderRadius: radius }}>
      {four.map((t) => <Cover key={t.id} t={t} tq={tq} size="100%" radius={0} />)}
    </span>
  );
}

/** Animated "now playing" bars. */
export function Eq({ on }: { on: boolean }) {
  return (
    <span className="inline-flex items-end gap-[2px] h-3.5 w-3.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] rounded-sm bg-[var(--fg)]" style={{ height: on ? undefined : "30%", animation: on ? `eq .9s ${i * 0.18}s ease-in-out infinite` : undefined }} />
      ))}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mt-7 mb-3">
      <h2 className="text-xl font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/** Horizontal shelf of square cards (Home). */
export function Shelf({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3.5 overflow-x-auto -mx-4 px-4 pb-1 snap-x scroll-pl-4 [scrollbar-width:none]">{children}</div>;
}

export function Card({ cover, title, subtitle, onClick, round }: { cover: React.ReactNode; title: string; subtitle?: string; onClick: () => void; round?: boolean }) {
  return (
    <button onClick={onClick} className="w-36 shrink-0 text-left snap-start active:scale-[.97] transition">
      <div className={`overflow-hidden shadow-lg ${round ? "rounded-full" : "rounded-xl"}`} style={{ width: 144, height: 144 }}>{cover}</div>
      <div className="mt-2 text-[15px] font-semibold truncate">{title}</div>
      {subtitle && <div className="text-[13px] text-[var(--dim)] truncate">{subtitle}</div>}
    </button>
  );
}

export function PlayAllButton({ onClick, label = "Play" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--fg)] text-[var(--bg)] font-semibold text-[15px] active:scale-95 transition">
      <PlayIcon size={18} /> {label}
    </button>
  );
}

/**
 * Share what a track IS (title, artist, public Spotify link), never the
 * audio file or this private player's URL. Uses the native share sheet and
 * falls back to the clipboard. Returns a short status for a toast.
 */
export async function shareText(title: string, lines: string[]): Promise<string> {
  const text = lines.join("\n");
  try {
    if (navigator.share) { await navigator.share({ title, text }); return ""; }
  } catch (e) { if ((e as Error).name === "AbortError") return ""; }
  try { await navigator.clipboard.writeText(text); return "Copied to clipboard"; } catch { return "Could not share"; }
}
export const trackShareLines = (t: Pick<Track, "title" | "artist" | "spotifyUrl">) => [`${t.title ?? "—"} — ${t.artist ?? ""}`.trim(), ...(t.spotifyUrl ? [t.spotifyUrl] : [])];
