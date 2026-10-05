"use client";

/* eslint-disable @next/next/no-img-element -- private covers from our own API */

import { useEffect, useState } from "react";
import { HeartIcon, ThumbDownIcon } from "./Icons";

export type DetailTrack = {
  id: number; spotifyUrl?: string; title: string | null; artist: string | null; album: string | null; releaseDate?: string | null;
  durationS: number | null; hasCover: boolean; status: string; sizeBytes?: number | null; mime?: string | null;
  createdAt?: string; readyAt?: string | null; rating: number; playCount: number; skipCount: number;
  lastPlayedAt: string | null; listenSeconds: number;
};
type History = {
  days: Array<{ day: string; minutes: number; plays: number }>;
  sessions: Array<{ at: string; seconds: number; completed: boolean; skipped: boolean }>;
  firstPlayedAt: string | null; completions: number;
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export function fmtListen(sec: number): string {
  if (sec < 60) return `${fa(Math.round(sec))} ثانیه`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${fa(m)} دقیقه`;
  return `${fa(Math.floor(m / 60))} ساعت و ${fa(m % 60)} دقیقه`;
}
const toDate = (iso: string) => new Date(iso.includes("T") ? iso : iso.replace(" ", "T").replace(/\+00$/, "Z"));
const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fa-IR", { timeZone: "Asia/Tehran", hour12: false, dateStyle: "medium", timeStyle: "short" });
};
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - toDate(iso).getTime()) / 1000));
  if (s < 60) return "الان";
  if (s < 3600) return `${fa(Math.round(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.round(s / 3600))} ساعت پیش`;
  return `${fa(Math.round(s / 86400))} روز پیش`;
};
const format = (mime: string | null | undefined) => (/flac/i.test(mime ?? "") ? "FLAC" : /ogg/i.test(mime ?? "") ? "OGG" : /mp4/i.test(mime ?? "") ? "M4A" : mime ? "MP3" : "—");

/**
 * Bottom-sheet with everything about one track. Live: the sheet polls the
 * history every 5 s, and when the track is the one currently playing it
 * shows the running session (position, time heard now).
 */
export default function TrackDetail({ t, tq, onClose, onRate, live, lang = "fa" }: {
  t: DetailTrack; tq: string; onClose: () => void; dark?: boolean; onRate?: (r: number) => void; lang?: "fa" | "en";
  live?: { pos: number; dur: number; playing: boolean } | null;
}) {
  const en = lang === "en";
  const d = (v: number | string) => (en ? String(v) : fa(v));
  const listen = (sec: number) => (en ? (sec < 60 ? `${Math.round(sec)} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`) : fmtListen(sec));
  const whenL = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const dt = toDate(iso);
    if (Number.isNaN(dt.getTime())) return "—";
    return en ? dt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : when(iso);
  };
  const agoL = (iso: string) => {
    if (!en) return ago(iso);
    const s = Math.max(0, Math.round((Date.now() - toDate(iso).getTime()) / 1000));
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  };
  const T = en
    ? { like: "Like", dislike: "Dislike", plays: "Plays", total: "Total listened", skips: "Early skips", ofPlays: "of plays", toEnd: "to the end", avg: "Average listened per play", ofTrack: "of the track", chart: "Minutes listened · last 14 days", last: "Recent listens", none: "Nothing recorded yet.", done: "Played to end", skipped: "Skipped", partial: "Partial", live: "Playing now", paused: "Paused", album: "Album", released: "Released", length: "Length", format: "Format", added: "Added", first: "First played", lastPlayed: "Last played", close: "Close", dir: "ltr" as const }
    : { like: "لایک", dislike: "دیسلایک", plays: "تعداد پخش", total: "مجموع گوش‌دادن", skips: "ردشدن زودهنگام", ofPlays: "پخش‌ها", toEnd: "بار تا آخر", avg: "میانگین شنیدن هر بار", ofTrack: "از آهنگ", chart: "{T.chart}", last: "{T.last}", none: "{T.none}", done: "تا آخر", skipped: "ردشد", partial: "نیمه‌کاره", live: "همین الان در حال پخش", paused: "مکث شده", album: "آلبوم", released: "انتشار", length: "مدت", format: "فرمت", added: "اضافه شد", first: "اولین گوش‌دادن", lastPlayed: "آخرین پخش", close: "بستن", dir: "rtl" as const };
  const [h, setH] = useState<History | null>(null);
  const q = tq ? `?${tq}` : "";
  useEffect(() => {
    let on = true;
    const go = () => void fetch(`/api/music/${t.id}/history${q}`, { cache: "no-store" }).then(async (r) => { if (r.ok && on) setH((await r.json()) as History); }).catch(() => {});
    go();
    const i = window.setInterval(go, 5000);
    return () => { on = false; window.clearInterval(i); };
  }, [t.id, q]);

  const kbps = t.sizeBytes && t.durationS ? Math.round((t.sizeBytes * 8) / t.durationS / 1000) : null;
  const sessions = t.playCount + t.skipCount;
  const avgPct = sessions > 0 && t.durationS ? Math.min(100, Math.round((t.listenSeconds / sessions / t.durationS) * 100)) : null;
  const skipRate = sessions > 0 ? Math.round((t.skipCount / sessions) * 100) : null;
  const max = Math.max(1, ...(h?.days.map((d) => d.minutes) ?? [1]));
  const tile = (label: string, value: string, sub?: string) => (
    <div className="rounded-2xl bg-[var(--s1)] border border-[var(--bd)] p-3 text-center">
      <div className="text-lg font-extrabold leading-tight">{value}</div>
      <div className="text-[11px] text-[var(--dim)] mt-1">{label}</div>
      {sub && <div className="text-[10px] text-[var(--dim3)] mt-0.5">{sub}</div>}
    </div>
  );
  const info: Array<[string, string]> = [
    [T.album, t.album ?? "—"], [T.released, t.releaseDate ?? "—"], [T.length, t.durationS ? fmtDur(t.durationS) : "—"],
    [T.format, `${format(t.mime)}${t.sizeBytes ? ` · ${d((t.sizeBytes / 1048576).toFixed(1))} MB` : ""}${kbps ? ` · ~${d(kbps)} kbps` : ""}`],
    [T.added, whenL(t.createdAt)], [T.first, whenL(h?.firstPlayedAt)], [T.lastPlayed, whenL(t.lastPlayedAt)],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div dir={T.dir} onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2, #0d0d13)", color: "var(--fg, #ececf1)", animation: "rise .25s ease-out" }}
        className="relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-[2rem] sm:rounded-[2rem] border border-[var(--bd)] shadow-2xl">
        <style>{`@keyframes rise{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}} @keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
        <div className="relative h-52 overflow-hidden rounded-t-[2rem]">
          {t.hasCover ? <img src={`/api/music/cover/${t.id}${q}`} alt="" className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-60" /> : <div className="absolute inset-0 bg-[var(--s2)]" />}
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent, var(--bg2, #0d0d13))" }} />
          <button onClick={onClose} className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/40 grid place-items-center text-lg" aria-label={T.close}>✕</button>
          <div className="absolute bottom-3 inset-x-4 flex items-end gap-3">
            {t.hasCover ? <img src={`/api/music/cover/${t.id}${q}`} alt="" className="w-24 h-24 rounded-2xl object-cover shadow-2xl ring-1 ring-white/10" /> : <div className="w-24 h-24 rounded-2xl bg-[var(--s2)] grid place-items-center text-4xl">🎵</div>}
            <div className="min-w-0 flex-1 pb-1">
              <div className="text-xl font-extrabold leading-snug">{t.title ?? "—"}</div>
              <div className="text-sm text-[var(--dim2)] truncate">{t.artist}</div>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {live && (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3">
              <div className="flex items-center gap-2 text-xs text-emerald-300 mb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ animation: live.playing ? "pulse-dot 1.2s infinite" : undefined }} />
                {live.playing ? T.live : T.paused}
                <span className="mr-auto text-[var(--dim2)]" dir="ltr">{fmtDur(live.pos)} / {fmtDur(live.dur || t.durationS || 0)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--s2)] overflow-hidden"><div className="h-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${live.dur > 0 ? Math.min(100, (live.pos / live.dur) * 100) : 0}%` }} /></div>
            </div>
          )}

          {onRate && (
            <div className="flex gap-2">
              <button onClick={() => onRate(1)} className={`flex-1 py-2.5 rounded-2xl border text-base font-medium transition ${t.rating > 0 ? "border-rose-400/60 bg-rose-500/20 text-rose-400" : "border-[var(--bd)] bg-[var(--s1)]"}`}><span className="inline-flex items-center justify-center gap-2"><HeartIcon size={20} filled={t.rating > 0} /> {T.like}</span></button>
              <button onClick={() => onRate(-1)} className={`flex-1 py-2.5 rounded-2xl border text-base font-medium transition ${t.rating < 0 ? "border-amber-400/60 bg-amber-500/20 text-amber-400" : "border-[var(--bd)] bg-[var(--s1)]"}`}><span className="inline-flex items-center justify-center gap-2"><ThumbDownIcon size={20} filled={t.rating < 0} /> {T.dislike}</span></button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {tile(T.plays, d(t.playCount), h ? `${d(h.completions)} ${en ? T.toEnd : T.toEnd}` : undefined)}
            {tile(T.total, listen(t.listenSeconds))}
            {tile(T.skips, d(t.skipCount), skipRate == null ? undefined : `${d(skipRate)}% ${T.ofPlays}`)}
          </div>
          {avgPct != null && (
            <div>
              <div className="flex justify-between text-xs text-[var(--dim)] mb-1"><span>{T.avg}</span><span>{d(avgPct)}% {T.ofTrack}</span></div>
              <div className="h-2 rounded-full bg-[var(--s2)] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-l from-emerald-400 to-sky-400" style={{ width: `${avgPct}%` }} /></div>
            </div>
          )}

          <div>
            <div className="text-xs text-[var(--dim)] mb-2">دقیقه‌ی گوش‌دادن به این آهنگ · ۱۴ روز اخیر</div>
            <div className="flex items-end gap-1 h-20" dir="ltr">
              {(h?.days ?? Array.from({ length: 14 }, (_, i) => ({ day: String(i), minutes: 0, plays: 0 }))).map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: ${d.minutes} دقیقه`}>
                  <div className="w-full rounded-t bg-gradient-to-t from-emerald-600 to-emerald-300 transition-[height] duration-500" style={{ height: `${Math.max(3, (d.minutes / max) * 100)}%`, opacity: d.minutes ? 1 : 0.25 }} />
                  <div className="text-[9px] text-[var(--dim3)] mt-1">{d.day.slice(3)}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-[var(--dim)] mb-1">آخرین دفعه‌های شنیدن</div>
            {!h || h.sessions.length === 0 ? <div className="text-xs text-[var(--dim3)] py-2">هنوز ثبت نشده.</div> : h.sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 text-sm border-b border-[var(--bd0)]">
                <span className={`w-2 h-2 rounded-full ${s.completed ? "bg-emerald-400" : s.skipped ? "bg-amber-400" : "bg-sky-400"}`} />
                <span className="flex-1">{s.completed ? T.done : s.skipped ? T.skipped : T.partial} · {listen(s.seconds)}</span>
                <span className="text-[11px] text-[var(--dim3)]">{agoL(s.at)}</span>
              </div>
            ))}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm pt-1">
            {info.map(([k, v]) => (<div key={k} className="contents"><dt className="text-[var(--dim3)]">{k}</dt><dd>{v}</dd></div>))}
          </dl>
          {t.spotifyUrl && <a href={t.spotifyUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-emerald-400 underline">Open in Spotify</a>}
        </div>
      </div>
    </div>
  );
}
