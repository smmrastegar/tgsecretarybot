"use client";

import { useCallback, useEffect, useState } from "react";
import Section, { Pill } from "./Section";

type Artist = { id: number; spotifyArtistId: string; name: string; imageUrl: string | null; lastCheckedAt: string | null; lastError: string | null; trackCount: number };
type Hit = { id: string; name: string; followers: number; imageUrl: string | null; genres: string[] };
type Check = { albums: number; added: number; known: number; titles: string[]; error?: string };

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const when = (iso: string | null) => (iso ? new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "هنوز نه");
const btn = "min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs active:bg-[var(--color-surface-2)] disabled:opacity-50";
const post = (body: unknown) => fetch("/api/music/artists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Avatar({ url, name }: { url: string | null; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- remote Spotify artwork, tiny
  return url ? <img src={url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" /> : <span aria-hidden className="grid place-items-center w-11 h-11 rounded-full bg-[var(--color-surface-2)] shrink-0 font-semibold">{(name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase()}</span>;
}

// Follow artists: their songs are brought into the library (playlist "🎤 name") and new releases follow automatically.
export default function ArtistsSection({ onChanged }: { onChanged: () => void }) {
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/music/artists", { cache: "no-store" });
    if (r.ok) setArtists(((await r.json()) as { artists: Artist[] }).artists);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function search() {
    if (!q.trim()) return;
    setBusy("search"); setNote(null); setHits(null);
    const r = await post({ action: "search", q });
    const j = (await r.json().catch(() => ({}))) as { results?: Hit[]; error?: string };
    setBusy(null);
    if (r.ok) { setHits(j.results ?? []); if (!(j.results ?? []).length) setNote({ ok: false, text: "خواننده‌ای پیدا نشد" }); }
    else setNote({ ok: false, text: `جستجو ناموفق: ${j.error ?? r.status}` });
  }
  const report = (name: string, c: Check) => setNote(c.error
    ? { ok: false, text: `«${name}»: ${c.error}` }
    : { ok: true, text: c.added > 0 ? `«${name}»: ${fa(c.added)} آهنگ تازه به صف دانلود اضافه شد` : `«${name}»: چیز تازه‌ای نبود` });

  async function follow(h: Hit, all: boolean) {
    setBusy(`f${h.id}`); setNote(null);
    const r = await post({ action: "follow", id: h.id, name: h.name, imageUrl: h.imageUrl, all });
    const j = (await r.json().catch(() => ({}))) as Check;
    setBusy(null);
    if (r.ok || j.albums != null) { report(h.name, j); setHits(null); setQ(""); await load(); onChanged(); }
    else setNote({ ok: false, text: `ناموفق: ${(j as { error?: string }).error ?? r.status}` });
  }
  async function check(a: Artist) {
    setBusy(`c${a.id}`); setNote(null);
    const r = await post({ action: "check", artistId: a.id });
    const j = (await r.json().catch(() => ({}))) as Check;
    setBusy(null); report(a.name, j); await load(); onChanged();
  }
  async function unfollow(a: Artist) {
    if (!confirm(`دنبال‌کردن «${a.name}» متوقف شود؟ آهنگ‌ها و پلی‌لیستش می‌مانند.`)) return;
    await fetch(`/api/music/artists?id=${a.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Section icon="🎤" title="خواننده‌های دنبال‌شده" summary="آهنگ‌های جدیدشان خودکار می‌آید"
      badge={artists && artists.length ? <Pill>{fa(artists.length)}</Pill> : undefined}>
      {note && <div role="status" className={`mb-3 rounded-xl border px-3 py-2.5 text-xs leading-6 ${note.ok ? "border-[#1db954]/50 text-[#1db954]" : "border-rose-400/50 text-rose-300"}`}>{note.text}</div>}

      {artists && artists.length > 0 && (
        <ul className="space-y-2 mb-4">
          {artists.map((a) => (
            <li key={a.id} className="rounded-2xl border border-[var(--color-border)] p-2.5">
              <div className="flex items-center gap-3">
                <Avatar url={a.imageUrl} name={a.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" dir="auto">{a.name}</div>
                  <div className="text-[11px] text-[var(--color-text-dim)] truncate">{fa(a.trackCount)} آهنگ · بررسی: {when(a.lastCheckedAt)}</div>
                </div>
              </div>
              {a.lastError && <div className="mt-2 text-[11px] text-rose-300 break-words" dir="auto">{a.lastError}</div>}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button className={btn} disabled={busy === `c${a.id}`} onClick={() => void check(a)}>{busy === `c${a.id}` ? "در حال بررسی…" : "↻ بررسی حالا"}</button>
                <button className={`${btn} text-rose-300`} onClick={() => void unfollow(a)}>توقف</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام خواننده…" aria-label="جستجوی خواننده" dir="auto"
          className="min-w-0 flex-1 min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3" />
        <button type="submit" disabled={busy === "search" || !q.trim()} className="min-h-11 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm disabled:opacity-50">{busy === "search" ? "…" : "جستجو"}</button>
      </form>

      {hits && hits.length > 0 && (
        <ul className="mt-3 space-y-2">
          {hits.map((h) => (
            <li key={h.id} className="rounded-2xl border border-[var(--color-border)] p-2.5">
              <div className="flex items-center gap-3">
                <Avatar url={h.imageUrl} name={h.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" dir="auto">{h.name}</div>
                  <div className="text-[11px] text-[var(--color-text-dim)] truncate">{fa(h.followers.toLocaleString("en-US"))} دنبال‌کننده{h.genres.length ? ` · ${h.genres.slice(0, 2).join("، ")}` : ""}</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <button className="min-h-11 rounded-xl bg-[#1db954] text-black text-xs font-semibold disabled:opacity-60" disabled={!!busy} onClick={() => void follow(h, true)}>{busy === `f${h.id}` ? "در حال گرفتن آهنگ‌ها… (چند دقیقه)" : "دنبال کن + همهٔ آهنگ‌هایش را بیاور"}</button>
                <button className={btn} disabled={!!busy} onClick={() => void follow(h, false)}>فقط از الان (آهنگ‌های جدید)</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[var(--color-text-dim)] leading-6">هر ۶ ساعت آلبوم‌ها و تک‌آهنگ‌ها بررسی می‌شود. آهنگ تازه خودکار دانلود می‌شود و در تلگرام خبرت می‌کنم. آهنگی که خودت حذف کرده باشی دوباره نمی‌آید.</p>
    </Section>
  );
}
