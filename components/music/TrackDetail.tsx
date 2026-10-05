"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

export type DetailTrack = {
  id: number; spotifyUrl?: string; title: string | null; artist: string | null; album: string | null; releaseDate?: string | null;
  durationS: number | null; hasCover: boolean; status: string; sizeBytes?: number | null; mime?: string | null;
  createdAt?: string; readyAt?: string | null; rating: number; playCount: number; skipCount: number;
  lastPlayedAt: string | null; listenSeconds: number;
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export function fmtListen(sec: number): string {
  if (sec < 60) return `${fa(Math.round(sec))} ثانیه`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${fa(m)} دقیقه`;
  return `${fa(Math.floor(m / 60))} ساعت و ${fa(m % 60)} دقیقه`;
}
const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fa-IR", { timeZone: "Asia/Tehran", hour12: false, dateStyle: "medium", timeStyle: "short" });
};
const format = (mime: string | null | undefined) => (/flac/i.test(mime ?? "") ? "FLAC" : /ogg/i.test(mime ?? "") ? "OGG" : /mp4/i.test(mime ?? "") ? "M4A" : mime ? "MP3" : "—");

export default function TrackDetail({ t, tq, onClose, dark }: { t: DetailTrack; tq: string; onClose: () => void; dark?: boolean }) {
  const kbps = t.sizeBytes && t.durationS ? Math.round((t.sizeBytes * 8) / t.durationS / 1000) : null;
  const avgPct = t.playCount + t.skipCount > 0 && t.durationS ? Math.min(100, Math.round((t.listenSeconds / (t.playCount + t.skipCount) / t.durationS) * 100)) : null;
  const rows: Array<[string, string]> = [
    ["خواننده", t.artist ?? "—"], ["آلبوم", t.album ?? "—"], ["تاریخ انتشار", t.releaseDate ?? "—"],
    ["مدت", t.durationS ? fmtDur(t.durationS) : "—"],
    ["فرمت و حجم", `${format(t.mime)}${t.sizeBytes ? ` · ${fa((t.sizeBytes / 1048576).toFixed(1))} MB` : ""}${kbps ? ` · ~${fa(kbps)} kbps` : ""}`],
    ["اضافه شد", when(t.createdAt)], ["آماده شد", when(t.readyAt)],
    ["تعداد پخش", `${fa(t.playCount)} بار`], ["ردشدن زودهنگام", `${fa(t.skipCount)} بار`],
    ["مجموع گوش‌دادن", fmtListen(t.listenSeconds)], ["میانگین شنیدن هر بار", avgPct == null ? "—" : `${fa(avgPct)}٪ از آهنگ`],
    ["آخرین پخش", when(t.lastPlayedAt)], ["امتیاز", t.rating > 0 ? "❤️ لایک" : t.rating < 0 ? "👎 دیسلایک" : "—"],
  ];
  const bg = dark ? "#18181b" : "var(--color-surface)";
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div dir="rtl" onClick={(e) => e.stopPropagation()} style={{ background: bg }} className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl border border-zinc-700/60 p-4 shadow-2xl">
        <div className="flex gap-3 items-center mb-3">
          {t.hasCover ? <img src={`/api/music/cover/${t.id}${tq ? `?${tq}` : ""}`} alt="" className="w-20 h-20 rounded-xl object-cover" /> : <div className="w-20 h-20 rounded-xl bg-zinc-800 grid place-items-center text-3xl">🎵</div>}
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{t.title ?? "—"}</div>
            <div className="text-xs text-zinc-400">{t.artist}</div>
          </div>
          <button onClick={onClose} className="text-xl px-2" aria-label="بستن">✕</button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-zinc-400">{k}</dt><dd>{v}</dd></div>))}
        </dl>
        {t.spotifyUrl && <a href={t.spotifyUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-xs text-emerald-400 underline">Open in Spotify</a>}
      </div>
    </div>
  );
}
