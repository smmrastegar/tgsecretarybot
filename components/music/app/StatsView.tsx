"use client";

import { useEffect, useMemo, useState } from "react";
import { HeartIcon, ThumbDownIcon } from "../Icons";
import { Cover, fmt, type Track } from "./shared";
import { Skeleton, type Api } from "./Views";

type Stats = {
  totals: { tracks: number; plays: number; listenSeconds: number; likes: number; dislikes: number; skips: number };
  topTracks: Array<{ id: number; title: string | null; artist: string | null; plays: number; skips: number; listenSeconds: number }>;
  topArtists: Array<{ artist: string; plays: number; listenSeconds: number; tracks: number }>;
  days: Array<{ day: string; minutes: number; plays: number }>;
  recent: Array<{ id: number; title: string | null; artist: string | null; at: string; seconds: number; completed: boolean }>;
};

const dur = (sec: number) => {
  if (sec < 60) return { v: String(Math.round(sec)), u: "sec" };
  if (sec < 3600) return { v: String(Math.round(sec / 60)), u: "min" };
  return { v: (sec / 3600).toFixed(sec < 36000 ? 1 : 0).replace(/\.0$/, ""), u: "hours" };
};
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-8"><h2 className="text-[20px] font-bold tracking-tight mb-3">{title}</h2>{children}</section>
);

export default function StatsView({ api }: { api: Api }) {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/api/music/stats?${api.tq}`, { cache: "no-store" }).then(async (r) => (r.ok ? setS((await r.json()) as Stats) : setErr(true))).catch(() => setErr(true));
  }, [api.tq]);

  const derived = useMemo(() => {
    if (!s) return null;
    const max = Math.max(5, ...s.days.map((d) => d.minutes));
    const nice = max <= 10 ? 10 : max <= 30 ? Math.ceil(max / 10) * 10 : Math.ceil(max / 30) * 30;
    const active = s.days.filter((d) => d.minutes > 0).length;
    const total14 = s.days.reduce((a, d) => a + d.minutes, 0);
    const skipRate = s.totals.plays + s.totals.skips > 0 ? Math.round((s.totals.skips / (s.totals.plays + s.totals.skips)) * 100) : 0;
    const best = s.days.reduce((b, d) => (d.minutes > b.minutes ? d : b), s.days[0]!);
    return { nice, active, total14, skipRate, best, avg: Math.round(total14 / Math.max(1, s.days.length)) };
  }, [s]);

  if (err) return <div className="py-14 text-center text-sm text-[var(--dim)]">Couldn&apos;t load stats.</div>;
  if (!s || !derived) return <Skeleton />;
  const total = dur(s.totals.listenSeconds);
  const topPlays = Math.max(1, ...s.topTracks.map((t) => t.plays));
  const topArtistPlays = Math.max(1, ...s.topArtists.map((a) => a.plays));
  const shown = sel != null ? s.days[sel]! : s.days[s.days.length - 1]!;

  return (
    <div className="pb-4">
      {/* hero */}
      <div className="rounded-3xl p-5 border border-[var(--bd)]" style={{ background: "linear-gradient(135deg, var(--s2), var(--s0))" }}>
        <div className="text-[13px] text-[var(--dim)]">Total listening time</div>
        <div className="mt-1 flex items-baseline gap-2"><span className="text-[56px] leading-none font-extrabold tracking-tight tabular-nums">{total.v}</span><span className="text-xl text-[var(--dim)]">{total.u}</span></div>
        <div className="mt-2 text-[13px] text-[var(--dim)]">Active on {derived.active} of the last 14 days · avg {derived.avg} min/day</div>
      </div>

      {/* kpis */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { l: "Plays", v: s.totals.plays },
          { l: "Library", v: s.totals.tracks },
          { l: "Liked", v: s.totals.likes, i: <HeartIcon size={13} filled className="text-rose-500" /> },
          { l: "Disliked", v: s.totals.dislikes, i: <ThumbDownIcon size={13} /> },
        ].map((k) => (
          <div key={k.l} className="rounded-2xl bg-[var(--s1)] py-3 text-center">
            <div className="text-[22px] font-bold tabular-nums leading-none">{k.v}</div>
            <div className="mt-1.5 text-[11px] text-[var(--dim)] inline-flex items-center gap-1">{k.i}{k.l}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-2xl bg-[var(--s1)] px-4 py-3 flex items-center justify-between text-[13px]">
        <span className="text-[var(--dim)]">Early-skip rate</span>
        <span className="flex items-center gap-3 flex-1 ml-4"><span className="h-1.5 flex-1 rounded-full bg-[var(--s2)] overflow-hidden"><span className="block h-full rounded-full bg-[rgb(var(--ac))]" style={{ width: `${derived.skipRate}%` }} /></span><span className="font-semibold tabular-nums w-10 text-right">{derived.skipRate}%</span></span>
      </div>

      {/* chart */}
      <Section title="Last 14 days">
        <div className="rounded-2xl bg-[var(--s1)] p-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-[26px] font-bold tabular-nums">{shown.minutes}<span className="text-sm font-medium text-[var(--dim)]"> min</span></span>
            <span className="text-[12px] text-[var(--dim)]">{shown.day.replace("-", "/")} · {shown.plays} plays</span>
          </div>
          <div className="relative h-32">
            {[1, 0.5, 0].map((f) => (
              <div key={f} className="absolute inset-x-0 border-t border-dashed border-[var(--bd0)]" style={{ bottom: `${f * 100}%` }}><span className="absolute -top-2 right-0 text-[9px] text-[var(--dim3)] bg-[var(--s0)] pl-1">{Math.round(derived.nice * f)}</span></div>
            ))}
            <div className="absolute inset-0 pr-6 flex items-end gap-[3px]">
              {s.days.map((d, i) => {
                const on = (sel ?? s.days.length - 1) === i;
                return (
                  <button key={d.day} onClick={() => setSel(i)} className="flex-1 h-full flex items-end" aria-label={`${d.day}: ${d.minutes} minutes`}>
                    <span className="w-full rounded-t-md transition-all" style={{ height: `${Math.max(d.minutes > 0 ? 4 : 1.5, (d.minutes / derived.nice) * 100)}%`, background: on ? "rgb(var(--ac))" : "var(--s2)" }} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-2 pr-6 flex gap-[3px]">
            {s.days.map((d, i) => <span key={d.day} className="flex-1 text-center text-[9px] text-[var(--dim3)]">{i % 2 === (s.days.length - 1) % 2 ? d.day.slice(3) : ""}</span>)}
          </div>
        </div>
        {derived.best.minutes > 0 && <div className="mt-2 text-[12px] text-[var(--dim)]">Best day: {derived.best.day.replace("-", "/")} with {derived.best.minutes} min</div>}
      </Section>

      {/* top tracks */}
      <Section title="Top tracks">
        {s.topTracks.length === 0 ? <div className="text-sm text-[var(--dim)]">Play something to see data here.</div> : (
          <div className="divide-y divide-[var(--bd0)]">
            {s.topTracks.slice(0, 8).map((t, i) => {
              const tr: Track | undefined = api.byId.get(t.id);
              return (
                <button key={t.id} onClick={() => tr && api.play(s.topTracks.map((x) => x.id).filter((id) => api.byId.has(id)), t.id)} className="w-full flex items-center gap-3 py-2.5 text-left">
                  <span className="w-5 text-center text-sm text-[var(--dim3)] tabular-nums">{i + 1}</span>
                  <Cover t={tr ?? { id: t.id, title: t.title, hasCover: false }} tq={api.tq} size={46} radius={8} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium truncate">{t.title ?? "—"}</span>
                    <span className="mt-1.5 flex items-center gap-2"><span className="h-1 flex-1 rounded-full bg-[var(--s2)] overflow-hidden"><span className="block h-full rounded-full bg-[rgb(var(--ac))] opacity-80" style={{ width: `${(t.plays / topPlays) * 100}%` }} /></span><span className="text-[12px] text-[var(--dim)] tabular-nums w-14 text-right">{t.plays} plays</span></span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* artists */}
      {s.topArtists.length > 0 && (
        <Section title="Top artists">
          <div className="divide-y divide-[var(--bd0)]">
            {s.topArtists.slice(0, 6).map((a) => {
              const first = a.artist.split(/,\s*/)[0] ?? a.artist;
              const rep = api.tracks.find((t) => (t.artist ?? "").startsWith(first));
              const d = dur(a.listenSeconds);
              return (
                <button key={a.artist} onClick={() => api.open({ kind: "artist", key: first, title: first })} className="w-full flex items-center gap-3 py-2.5 text-left">
                  <span className="w-[46px] h-[46px] rounded-full overflow-hidden block shrink-0"><Cover t={rep ?? { id: 0, title: first, hasCover: false }} tq={api.tq} size="100%" radius={0} res={128} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium truncate">{a.artist}</span>
                    <span className="mt-1.5 flex items-center gap-2"><span className="h-1 flex-1 rounded-full bg-[var(--s2)] overflow-hidden"><span className="block h-full rounded-full bg-[rgb(var(--ac))] opacity-80" style={{ width: `${(a.plays / topArtistPlays) * 100}%` }} /></span><span className="text-[12px] text-[var(--dim)] tabular-nums w-20 text-right">{d.v} {d.u}</span></span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* history */}
      {s.recent.length > 0 && (
        <Section title="Listening history">
          <div className="divide-y divide-[var(--bd0)]">
            {s.recent.slice(0, 10).map((r, i) => {
              const tr = api.byId.get(r.id);
              return (
                <div key={`${r.id}-${i}`} className="flex items-center gap-3 py-2">
                  <Cover t={tr ?? { id: r.id, title: r.title, hasCover: false }} tq={api.tq} size={40} radius={7} />
                  <span className="min-w-0 flex-1"><span className="block text-[14px] truncate">{r.title ?? "—"}</span><span className="block text-[12px] text-[var(--dim)] truncate">{r.artist}</span></span>
                  <span className="text-right shrink-0"><span className="block text-[12px] tabular-nums">{r.completed ? "Full" : fmt(r.seconds)}</span><span className="block text-[11px] text-[var(--dim3)]">{ago(r.at)}</span></span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
