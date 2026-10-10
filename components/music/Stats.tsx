"use client";

import { useEffect, useState } from "react";
import { fmtListen as fmtListenFa } from "./TrackDetail";

type Stats = {
  totals: { tracks: number; plays: number; listenSeconds: number; likes: number; dislikes: number; skips: number };
  topTracks: Array<{ id: number; title: string | null; artist: string | null; plays: number; skips: number; listenSeconds: number }>;
  topArtists: Array<{ artist: string; plays: number; listenSeconds: number; tracks: number }>;
  days: Array<{ day: string; minutes: number; plays: number }>;
  recent: Array<{ id: number; title: string | null; artist: string | null; at: string; seconds: number; completed: boolean }>;
};
const faDigits = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const agoOf = (iso: string, lang: "fa" | "en", fa: (v: number | string) => string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (lang === "en") {
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  if (s < 60) return "چند ثانیه پیش";
  if (s < 3600) return `${fa(Math.round(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.round(s / 3600))} ساعت پیش`;
  return `${fa(Math.round(s / 86400))} روز پیش`;
};

const TXT = {
  fa: { loading: "در حال بارگذاری…", listen: "مجموع گوش‌دادن", plays: "تعداد پخش", tracks: "آهنگ در کتابخانه", likes: "لایک", dislikes: "دیسلایک", skips: "ردشدن زودهنگام", chart: "دقیقه‌ی گوش‌دادن در ۱۴ روز اخیر", topT: "پرشنیده‌ترین آهنگ‌ها", topA: "پرشنیده‌ترین خواننده‌ها", none: "هنوز داده‌ای نیست.", recent: "آخرین شنیده‌ها", full: "کامل", dir: "rtl" },
  en: { loading: "Loading…", listen: "Total listening", plays: "Plays", tracks: "Tracks", likes: "Likes", dislikes: "Dislikes", skips: "Early skips", chart: "Minutes listened · last 14 days", topT: "Most played tracks", topA: "Most played artists", none: "No data yet.", recent: "Recently played", full: "Full", dir: "ltr" },
} as const;

export default function MusicStats({ tq, lang = "fa" }: { tq: string; lang?: "fa" | "en" }) {
  const L = TXT[lang];
  const fa = lang === "en" ? (v: number | string) => String(v) : faDigits;
  const ago = (iso: string) => agoOf(iso, lang, faDigits);
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fmtListen = (sec: number) => (lang === "en" ? (sec < 60 ? `${Math.round(sec)} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`) : fmtListenFa(sec));
  useEffect(() => {
    void fetch(`/api/music/stats${tq ? `?${tq}` : ""}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? setS((await r.json()) as Stats) : setErr(`HTTP ${r.status}`)))
      .catch((e) => setErr(String(e)));
  }, [tq]);
  if (err) return <div className="text-sm text-rose-300">{err}</div>;
  if (!s) return <div className="text-sm text-[var(--dim)]">در حال بارگذاری…</div>;
  const max = Math.max(1, ...s.days.map((d) => d.minutes));
  const tile = (label: string, value: string) => (
    <div className="rounded-xl border border-[var(--bd)] bg-[var(--s1)] p-3 text-center"><div className="text-lg font-bold">{value}</div><div className="text-[11px] text-[var(--dim)] mt-0.5">{label}</div></div>
  );
  return (
    <div dir={L.dir} className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tile(L.listen, fmtListen(s.totals.listenSeconds))}
        {tile(L.plays, fa(s.totals.plays))}
        {tile(L.tracks, fa(s.totals.tracks))}
        {tile(L.likes, `❤️ ${fa(s.totals.likes)}`)}
        {tile(L.dislikes, `👎 ${fa(s.totals.dislikes)}`)}
        {tile(L.skips, fa(s.totals.skips))}
      </div>
      <div>
        <div className="text-xs text-[var(--dim)] mb-1">{L.chart}</div>
        <div className="flex items-end gap-1 h-24" dir="ltr">
          {s.days.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: ${d.minutes} دقیقه، ${d.plays} پخش`}>
              <div className="w-full rounded-t bg-emerald-500/80" style={{ height: `${Math.max(2, (d.minutes / max) * 100)}%` }} />
              <div className="text-[9px] text-[var(--dim3)] mt-1">{d.day.slice(3)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="text-xs text-[var(--dim)] mb-1">{L.topT}</div>
          {s.topTracks.length === 0 ? <div className="text-xs text-[var(--dim3)]">{L.none}</div> : s.topTracks.map((t, i) => (
            <div key={t.id} className="flex items-center gap-2 py-1 text-sm border-b border-[var(--bd0)]">
              <span className="w-5 text-[var(--dim3)] text-xs">{fa(i + 1)}</span>
              <span className="min-w-0 flex-1 truncate">{t.title ?? "—"}<span className="text-[var(--dim3)] text-xs"> · {t.artist}</span></span>
              <span className="text-xs text-emerald-400 shrink-0">{fa(t.plays)}×</span>
              {t.skips > 0 && <span className="text-xs text-amber-400 shrink-0">⏭{fa(t.skips)}</span>}
            </div>
          ))}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-[var(--dim)] mb-1">{L.topA}</div>
          {s.topArtists.length === 0 ? <div className="text-xs text-[var(--dim3)]">{L.none}</div> : s.topArtists.map((a, i) => (
            <div key={a.artist} className="flex items-center gap-2 py-1 text-sm border-b border-[var(--bd0)]">
              <span className="w-5 text-[var(--dim3)] text-xs">{fa(i + 1)}</span>
              <span className="min-w-0 flex-1 truncate">{a.artist}</span>
              <span className="text-xs text-[var(--dim)] shrink-0">{fmtListen(a.listenSeconds)}</span>
              <span className="text-xs text-emerald-400 shrink-0">{fa(a.plays)}×</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-[var(--dim)] mb-1">{L.recent}</div>
        {s.recent.map((r, i) => (
          <div key={`${r.id}-${i}`} className="flex items-center gap-2 py-1 text-sm border-b border-[var(--bd0)]">
            <span className="min-w-0 flex-1 truncate">{r.title ?? "—"}<span className="text-[var(--dim3)] text-xs"> · {r.artist}</span></span>
            <span className="text-xs text-[var(--dim)] shrink-0">{r.completed ? L.full : fmtListen(r.seconds)}</span>
            <span className="text-[11px] text-[var(--dim3)] shrink-0">{ago(r.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
