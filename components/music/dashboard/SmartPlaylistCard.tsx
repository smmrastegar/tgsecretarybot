"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";

// Smart playlists are built here only. Their songs are computed from the rules
// every time (genre, mood, energy, tempo, likes, "sounds like …"), so they keep
// up with new songs and new likes; assign them to player links in the links card.
type TrackLite = { id: number; title: string | null; artist: string | null; status: string };

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const MOODS: Array<[string, string]> = [["sad", "غمگین"], ["happy", "شاد"], ["relaxed", "آرام"], ["aggressive", "تند و پرانرژی"], ["danceable", "رقص‌پذیر"]];

export default function SmartPlaylistCard({ tracks, onCreated, onMessage }: { tracks: TrackLite[]; onCreated: () => void; onMessage: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [liked, setLiked] = useState(false);
  const [genres, setGenres] = useState("");
  const [artists, setArtists] = useState("");
  const [mood, setMood] = useState("");
  const [vocal, setVocal] = useState("");
  const [energy, setEnergy] = useState("");
  const [mode, setMode] = useState("");
  const [bpmMin, setBpmMin] = useState("");
  const [bpmMax, setBpmMax] = useState("");
  const [seedQ, setSeedQ] = useState("");
  const [seed, setSeed] = useState<TrackLite | null>(null);
  const [limit, setLimit] = useState("");
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const rules = () => {
    const r: Record<string, unknown> = {};
    if (liked) r.liked = true;
    const list = (s: string) => s.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
    if (list(genres).length) r.genres = list(genres);
    if (list(artists).length) r.artists = list(artists);
    if (mood) r.moods = { [mood]: 0.5 };
    if (vocal) r.vocal = vocal;
    if (energy) r.energy = energy === "low" ? [0, 0.35] : energy === "mid" ? [0.35, 0.6] : [0.6, 1];
    if (mode) r.mode = mode;
    if (bpmMin || bpmMax) r.bpm = [Number(bpmMin) || 0, Number(bpmMax) || 300];
    if (seed) r.seed = { trackId: seed.id, n: Number(limit) || 40 };
    if (Number(limit) > 0) r.limit = Number(limit);
    return r;
  };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify([liked, genres, artists, mood, vocal, energy, mode, bpmMin, bpmMax, seed?.id, limit]);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await fetch("/api/music/playlists/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: rules() }) });
      if (r.ok) setPreview((await r.json()) as { count: number; sample: string[] });
    }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every input of rules()
  }, [open, key]);

  async function create() {
    if (!name.trim()) { onMessage("برای پلی‌لیست هوشمند یک نام بنویس"); return; }
    setBusy(true);
    const r = await fetch("/api/music/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), rules: rules() }) });
    setBusy(false);
    if (r.ok) { onMessage(`پلی‌لیست هوشمند «${name.trim()}» ساخته شد؛ آن را به یک لینک بده`); setName(""); setOpen(false); onCreated(); }
    else onMessage("ساخت ناموفق بود");
  }

  const hits = seedQ.trim() ? tracks.filter((t) => t.status === "ready" && `${t.title} ${t.artist}`.toLowerCase().includes(seedQ.trim().toLowerCase())).slice(0, 5) : [];
  const field = "text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5";

  return (
    <Card className="mb-4">
      <button onClick={() => setOpen((v) => !v)} className="text-sm font-medium w-full text-right">✨ ساخت پلی‌لیست هوشمند {open ? "▴" : "▾"}</button>
      {open && (
        <div className="mt-3 space-y-3 text-xs">
          <p className="text-[var(--color-text-dim)] leading-6">آهنگ‌ها را بر اساس سبک، حال‌وهوا، انرژی، تمپو، لایک یا شباهت به یک آهنگ خودکار انتخاب می‌کند و همیشه به‌روز می‌ماند. شرط‌های خالی نادیده گرفته می‌شوند.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام پلی‌لیست" className={`${field} w-full text-sm py-2`} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={liked} onChange={(e) => setLiked(e.target.checked)} /> فقط آهنگ‌های لایک‌شده</label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-[var(--color-text-dim)]">حال‌وهوا</span>
              <select value={mood} onChange={(e) => setMood(e.target.value)} className={`${field} w-full`}><option value="">هر حالتی</option>{MOODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="space-y-1"><span className="text-[var(--color-text-dim)]">انرژی</span>
              <select value={energy} onChange={(e) => setEnergy(e.target.value)} className={`${field} w-full`}><option value="">هر مقدار</option><option value="low">کم (آرام)</option><option value="mid">متوسط</option><option value="high">زیاد</option></select></label>
            <label className="space-y-1"><span className="text-[var(--color-text-dim)]">صدا</span>
              <select value={vocal} onChange={(e) => setVocal(e.target.value)} className={`${field} w-full`}><option value="">هر دو</option><option value="vocal">با خواننده</option><option value="instrumental">بی‌کلام</option></select></label>
            <label className="space-y-1"><span className="text-[var(--color-text-dim)]">گام</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${field} w-full`}><option value="">هر دو</option><option value="major">ماژور (شاد)</option><option value="minor">مینور (غمگین)</option></select></label>
          </div>
          <div className="grid grid-cols-2 gap-2" dir="ltr">
            <input value={bpmMin} onChange={(e) => setBpmMin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="BPM min" className={field} />
            <input value={bpmMax} onChange={(e) => setBpmMax(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="BPM max" className={field} />
          </div>
          <input value={genres} onChange={(e) => setGenres(e.target.value)} dir="ltr" placeholder="سبک (انگلیسی، با کاما): pop, rock, electronic" className={`${field} w-full`} />
          <input value={artists} onChange={(e) => setArtists(e.target.value)} dir="ltr" placeholder="خواننده (با کاما)" className={`${field} w-full`} />
          <div>
            <div className="text-[var(--color-text-dim)] mb-1">شبیه این آهنگ (اختیاری){seed ? ` — ${seed.title}` : ""}</div>
            {seed ? <button onClick={() => setSeed(null)} className="px-3 py-1 rounded-md border border-[var(--color-border)]">حذف «{seed.title}»</button> : (
              <>
                <input value={seedQ} onChange={(e) => setSeedQ(e.target.value)} dir="ltr" placeholder="جستجوی آهنگ…" className={`${field} w-full`} />
                {hits.map((t) => <button key={t.id} onClick={() => { setSeed(t); setSeedQ(""); }} className="block w-full text-start px-2 py-1.5 hover:bg-[var(--color-surface-2)] rounded" dir="ltr">{t.title} — {t.artist}</button>)}
              </>
            )}
          </div>
          <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" placeholder="حداکثر تعداد آهنگ (اختیاری)" className={`${field} w-full`} />
          <div className="rounded-lg bg-[var(--color-surface-2)] p-3 leading-6">
            {preview ? <>الان <b>{fa(preview.count)}</b> آهنگ انتخاب می‌شود{preview.sample.length ? <div className="text-[var(--color-text-dim)]" dir="ltr">{preview.sample.join(" · ")}</div> : null}</> : "در حال محاسبه…"}
          </div>
          <button onClick={() => void create()} disabled={busy} className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-xs disabled:opacity-50">ساخت پلی‌لیست هوشمند</button>
        </div>
      )}
    </Card>
  );
}
