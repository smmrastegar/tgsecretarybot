"use client";

import { useEffect, useState } from "react";
import { fmtListen } from "./TrackDetail";

type Stats = {
  totals: { tracks: number; plays: number; listenSeconds: number; likes: number; dislikes: number; skips: number };
  topTracks: Array<{ id: number; title: string | null; artist: string | null; plays: number; skips: number; listenSeconds: number }>;
  topArtists: Array<{ artist: string; plays: number; listenSeconds: number; tracks: number }>;
  days: Array<{ day: string; minutes: number; plays: number }>;
  recent: Array<{ id: number; title: string | null; artist: string | null; at: string; seconds: number; completed: boolean }>;
};
const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "چند ثانیه پیش";
  if (s < 3600) return `${fa(Math.round(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.round(s / 3600))} ساعت پیش`;
  return `${fa(Math.round(s / 86400))} روز پیش`;
};

export default function MusicStats({ tq }: { tq: string }) {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void fetch(`/api/music/stats${tq ? `?${tq}` : ""}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? setS((await r.json()) as Stats) : setErr(`HTTP ${r.status}`)))
      .catch((e) => setErr(String(e)));
  }, [tq]);
  if (err) return <div className="text-sm text-rose-300">{err}</div>;
  if (!s) return <div className="text-sm text-zinc-400">در حال بارگذاری…</div>;
  const max = Math.max(1, ...s.days.map((d) => d.minutes));
  const tile = (label: string, value: string) => (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/40 p-3 text-center"><div className="text-lg font-bold">{value}</div><div className="text-[11px] text-zinc-400 mt-0.5">{label}</div></div>
  );
  return (
    <div dir="rtl" className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tile("مجموع گوش‌دادن", fmtListen(s.totals.listenSeconds))}
        {tile("تعداد پخش", fa(s.totals.plays))}
        {tile("آهنگ در کتابخانه", fa(s.totals.tracks))}
        {tile("لایک", `❤️ ${fa(s.totals.likes)}`)}
        {tile("دیسلایک", `👎 ${fa(s.totals.dislikes)}`)}
        {tile("ردشدن زودهنگام", fa(s.totals.skips))}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">دقیقه‌ی گوش‌دادن در ۱۴ روز اخیر</div>
        <div className="flex items-end gap-1 h-24" dir="ltr">
          {s.days.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: ${d.minutes} دقیقه، ${d.plays} پخش`}>
              <div className="w-full rounded-t bg-emerald-500/80" style={{ height: `${Math.max(2, (d.minutes / max) * 100)}%` }} />
              <div className="text-[9px] text-zinc-500 mt-1">{d.day.slice(3)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-zinc-400 mb-1">پرشنیده‌ترین آهنگ‌ها</div>
          {s.topTracks.length === 0 ? <div className="text-xs text-zinc-500">هنوز داده‌ای نیست.</div> : s.topTracks.map((t, i) => (
            <div key={t.id} className="flex items-center gap-2 py-1 text-sm border-b border-zinc-800/60">
              <span className="w-5 text-zinc-500 text-xs">{fa(i + 1)}</span>
              <span className="min-w-0 flex-1 truncate">{t.title ?? "—"}<span className="text-zinc-500 text-xs"> · {t.artist}</span></span>
              <span className="text-xs text-emerald-400 shrink-0">{fa(t.plays)}×</span>
              {t.skips > 0 && <span className="text-xs text-amber-400 shrink-0">⏭{fa(t.skips)}</span>}
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs text-zinc-400 mb-1">پرشنیده‌ترین خواننده‌ها</div>
          {s.topArtists.length === 0 ? <div className="text-xs text-zinc-500">هنوز داده‌ای نیست.</div> : s.topArtists.map((a, i) => (
            <div key={a.artist} className="flex items-center gap-2 py-1 text-sm border-b border-zinc-800/60">
              <span className="w-5 text-zinc-500 text-xs">{fa(i + 1)}</span>
              <span className="min-w-0 flex-1 truncate">{a.artist}</span>
              <span className="text-xs text-zinc-400 shrink-0">{fmtListen(a.listenSeconds)}</span>
              <span className="text-xs text-emerald-400 shrink-0">{fa(a.plays)}×</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">آخرین شنیده‌ها</div>
        {s.recent.map((r, i) => (
          <div key={`${r.id}-${i}`} className="flex items-center gap-2 py-1 text-sm border-b border-zinc-800/60">
            <span className="min-w-0 flex-1 truncate">{r.title ?? "—"}<span className="text-zinc-500 text-xs"> · {r.artist}</span></span>
            <span className="text-xs text-zinc-400 shrink-0">{r.completed ? "کامل" : fmtListen(r.seconds)}</span>
            <span className="text-[11px] text-zinc-500 shrink-0">{ago(r.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
