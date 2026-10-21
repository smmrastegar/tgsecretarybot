"use client";

import { useCallback, useEffect, useState } from "react";
import Section, { Pill } from "./Section";

// SoundCloud next to Spotify: connect accounts, import likes / playlists, or paste any song or playlist link.
type Cfg = { hasCredentials: boolean; clientId: string; accounts: Array<{ id: number; username: string | null }>; redirectUri: string };
type Pl = { urn: string; title: string; tracks: number };
type Rep = { total: number; added: number; already: number; removed: number; unavailable: number };

const fa = (v: number) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";
const NOTE: Record<string, string> = { connected: "حساب ساندکلاود وصل شد ✓", denied: "اجازه داده نشد؛ حساب وصل نشد", state: "درخواست ورود منقضی شد؛ دوباره امتحان کن", failed: "وصل شدن ناموفق بود؛ دوباره امتحان کن", nocreds: "اول Client ID / Secret ساندکلاود تنظیم شود" };

export default function SoundcloudSection({ canManage }: { canManage: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [lists, setLists] = useState<Pl[] | null>(null);
  const [cid, setCid] = useState("");
  const [csec, setCsec] = useState("");
  const [denied, setDenied] = useState(false); // a limited password cannot use it at all

  const load = useCallback(async () => {
    const r = await fetch("/api/music/soundcloud/config", { cache: "no-store" });
    if (r.ok) { const j = (await r.json()) as Cfg; setCfg(j); setCid(j.clientId); } else if (r.status === 403 || r.status === 401) setDenied(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("soundcloud");
    if (!q) return;
    setNote(NOTE[q] ?? q);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const report = (r: Rep) => `${fa(r.added)} آهنگ تازه در صف دانلود · ${fa(r.already)} از قبل بود${r.unavailable ? ` · ${fa(r.unavailable)} را ساندکلاود برای برنامه‌ها نمی‌دهد` : ""}${r.removed ? ` · ${fa(r.removed)} حذف‌شدهٔ قبلی دوباره اضافه نشد` : ""}`;
  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key); setNote(null);
    try {
      const r = await fetch("/api/music/soundcloud/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as Rep & { error?: string };
      setNote(r.ok ? report(j) : j.error ?? "انجام نشد");
      if (r.ok && body.what === "url") setUrl("");
    } catch { setNote("اتصال برقرار نشد"); }
    setBusy(null);
  }
  async function toggle(id: number) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setLists(null);
    const r = await fetch(`/api/music/soundcloud/library?account=${id}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { playlists?: Pl[]; error?: string };
    if (r.ok) setLists(j.playlists ?? []); else { setNote(j.error ?? "خواندن لیست‌ها ناموفق بود"); setOpen(null); }
  }
  async function saveCreds() {
    const r = await fetch("/api/music/soundcloud/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: cid, clientSecret: csec }) });
    setNote(r.ok ? "ذخیره شد" : "ذخیره نشد"); setCsec(""); void load();
  }
  async function disconnect(id: number) {
    if (!confirm("این حساب ساندکلاود قطع شود؟ آهنگ‌های دانلودشده می‌مانند.")) return;
    await fetch("/api/music/soundcloud/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disconnect: true, accountId: id }) });
    void load();
  }

  if (denied) return null;
  const accounts = cfg?.accounts ?? [];
  return (
    <Section icon="🟠" title="اتصال به ساندکلاود" summary={cfg ? (accounts.length ? accounts.map((a) => a.username ?? "حساب").join(" · ") : cfg.hasCredentials ? "حسابی وصل نیست؛ لینک آهنگ را مستقیم هم می‌شود وارد کرد" : "هنوز تنظیم نشده") : "…"}
      badge={accounts.length ? <Pill tone="ok">{fa(accounts.length)} حساب</Pill> : undefined}>
      {note && <div role="status" className="mb-3 rounded-xl border border-orange-400/50 text-orange-300 px-3 py-2.5 text-xs leading-6">{note}</div>}

      {canManage && cfg && !cfg.hasCredentials && (
        <div className="mb-4 space-y-2 text-xs text-[var(--color-text-dim)] leading-6">
          <p>یک‌بار: Client ID / Secret اپ ساندکلاود را بده و این آدرس را به‌عنوان Redirect URI در اپ ثبت کن:</p>
          <div dir="ltr" className="font-mono text-[11px] bg-[var(--color-surface-2)] rounded-lg px-3 py-2 select-all break-all">{cfg.redirectUri}</div>
          <input dir="ltr" value={cid} onChange={(e) => setCid(e.target.value)} placeholder="Client ID" className={field} />
          <input dir="ltr" type="password" value={csec} onChange={(e) => setCsec(e.target.value)} placeholder="Client Secret" className={field} />
          <button onClick={() => void saveCreds()} className={`${btn} w-full`}>ذخیره</button>
        </div>
      )}

      <ReviewPanel />

      {cfg?.hasCredentials && (
        <>
          {accounts.length > 0 && (
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li key={a.id} className="rounded-2xl border border-[var(--color-border)] p-2">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="grid place-items-center w-10 h-10 rounded-full text-base font-semibold shrink-0 bg-[var(--color-surface-2)]">{(a.username ?? "?").replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?"}</span>
                    <span className="min-w-0 flex-1 text-sm font-medium truncate" dir="auto">{a.username ?? "حساب ساندکلاود"}</span>
                    {canManage && <button onClick={() => void disconnect(a.id)} className="shrink-0 min-h-10 px-3 rounded-xl text-xs text-rose-300 border border-rose-500/30 active:bg-rose-500/10">قطع</button>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 justify-end">
                    <button disabled={!!busy} onClick={() => void run(`likes${a.id}`, { accountId: a.id, what: "likes" })} className={btn}>{busy === `likes${a.id}` ? "…" : "♥ وارد کردن لایک‌ها"}</button>
                    <button onClick={() => void toggle(a.id)} className={btn}>📋 لیست‌ها {open === a.id ? "▴" : "▾"}</button>
                  </div>
                  {open === a.id && (
                    <div className="mt-2 border-t border-[var(--color-border)] max-h-[45vh] overflow-y-auto">
                      {!lists && <div className="px-3 py-3 text-xs text-[var(--color-text-dim)]">در حال خواندن…</div>}
                      {lists?.length === 0 && <div className="px-3 py-3 text-xs text-[var(--color-text-dim)]">لیستی ندارد.</div>}
                      {lists?.map((l) => (
                        <button key={l.urn} disabled={!!busy} onClick={() => void run(l.urn, { accountId: a.id, what: "playlist", urn: l.urn, name: l.title })} className="w-full min-h-12 px-3 flex items-center gap-3 border-b border-[var(--color-border)] active:bg-[var(--color-surface-2)] disabled:opacity-60">
                          <span className="flex-1 min-w-0 truncate text-sm text-center" dir="auto">{l.title}</span>
                          {l.tracks >= 0 && <span className="text-[11px] text-[var(--color-text-dim)] tabular-nums shrink-0">{fa(l.tracks)}</span>}
                          <span className="shrink-0 text-xs text-[var(--color-text-dim)] w-14 text-end">{busy === l.urn ? "…" : "↓ وارد کن"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2 justify-end">
            <button onClick={() => { window.location.href = "/api/music/soundcloud/login"; }} className="min-h-11 px-4 rounded-xl bg-[#ff5500] text-white text-sm font-semibold active:opacity-80">{accounts.length ? "+ افزودن حساب" : "ورود با ساندکلاود"}</button>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
            <label htmlFor="sc-url" className="block text-xs font-medium mb-2 text-center">لینک آهنگ، لیست یا پروفایل ساندکلاود (لینک پروفایل = لایک‌های عمومی‌اش)</label>
            <input id="sc-url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://soundcloud.com/…" className={field} />
            <div className="mt-2 flex justify-end"><button disabled={!!busy || !/soundcloud\.com\//i.test(url)} onClick={() => void run("url", { what: "url", url })} className={btn}>{busy === "url" ? "…" : "↓ وارد کن"}</button></div>
          </div>
          <p className="mt-3 text-[11px] text-[var(--color-text-dim)] leading-6 text-center">اگر صفحهٔ ورود ساندکلاود سفید ماند: آن صفحه فایل‌هایش را از sndcdn.com می‌گیرد و بدون VPN (یا با افزونهٔ مسدودکننده) باز نمی‌شود. وصل‌کردن حساب لازم نیست؛ لینک پروفایل یا لیست را بالا بچسبان.<br />فقط آهنگ‌هایی که ساندکلاود به برنامه‌ها اجازهٔ پخش می‌دهد دانلود می‌شوند؛ بقیه رد می‌شوند.</p>
        </>
      )}
    </Section>
  );
}

type Sug = { title: string; artist: string; source: string; note?: string };
type Item = { id: number; title: string; artist: string; origTitle: string | null; origArtist: string | null; suggestions: Sug[] };
type Found = { artists: Array<{ name: string; followers: number }>; tracks: Array<{ title: string; artist: string }> };

// Songs whose real artist could not be settled automatically: look up the Spotify artist, or type a new one.
function ReviewPanel() {
  const [data, setData] = useState<{ counts: Record<string, number>; items: Item[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/music/soundcloud/review", { cache: "no-store" });
    if (r.ok) setData((await r.json()) as { counts: Record<string, number>; items: Item[] });
  }, []);
  useEffect(() => { void load(); }, [load]);
  const c = data?.counts ?? {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (!data || total === 0) return null;
  const waiting = (c.new ?? 0), review = c.review ?? 0, fixed = (c.auto ?? 0) + (c.manual ?? 0);
  return (
    <div className="mb-4 rounded-2xl border border-[var(--color-border)] p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full min-h-11 flex items-center gap-2 text-sm font-medium" aria-expanded={open}>
        <span className="flex-1 text-start">اصلاح نام خواننده و آهنگ‌ها{review ? ` · ${fa(review)} مورد نیازمند بررسی` : ""}</span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      <p className="text-[11px] text-[var(--color-text-dim)] leading-6">{fa(fixed)} اصلاح‌شده{c.done ? ` · ${fa(c.done)} بدون تغییر` : ""}{waiting ? ` · ${fa(waiting)} در صف بررسی خودکار` : ""}</p>
      {open && (
        <div className="mt-3 space-y-3">
          {data.items.length === 0 && <div className="text-xs text-[var(--color-text-dim)] py-2">موردی برای بررسی دستی نیست.</div>}
          {data.items.map((it) => <ReviewRow key={`${it.id}|${it.title}|${it.artist}`} it={it} done={load} />)}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ it, done }: { it: Item; done: () => Promise<void> }) {
  const [title, setTitle] = useState(it.title);
  const [artist, setArtist] = useState(it.artist);
  const [q, setQ] = useState(`${it.origArtist ?? it.artist} ${it.title}`.trim());
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/music/soundcloud/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId: it.id, ...body }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string } & Found;
      if (!r.ok) setErr(j.error ?? "انجام نشد"); else if (body.action === "search") setFound(j); else await done();
    } catch { setErr("اتصال برقرار نشد"); }
    setBusy(false);
  }
  const chip = "min-h-9 px-3 rounded-full border border-[var(--color-border)] text-xs active:bg-[var(--color-surface-2)]";
  return (
    <div className="rounded-xl bg-[var(--color-surface-2)] p-3 space-y-2">
      <div dir="ltr" className="text-xs leading-6 text-[var(--color-text-dim)] break-words">
        <div>اصل: <span className="text-[var(--color-text)]">{it.origTitle ?? it.title}</span></div>
        <div>آپلودکننده: <span className="text-[var(--color-text)]">{it.origArtist ?? it.artist}</span></div>
      </div>
      {it.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" dir="ltr">
          {it.suggestions.map((s, i) => <button key={i} onClick={() => { setTitle(s.title); setArtist(s.artist); }} className={chip}>{s.artist} — {s.title}</button>)}
        </div>
      )}
      <input dir="ltr" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" aria-label="Song title" className={field} />
      <input dir="ltr" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" aria-label="Artist" className={field} />
      <div className="flex gap-2">
        <input dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Spotify" aria-label="Search Spotify" className={field} />
        <button disabled={busy || q.trim().length < 2} onClick={() => void post({ action: "search", q })} className={`${btn} shrink-0`}>جستجو</button>
      </div>
      {found && (
        <div className="space-y-2" dir="ltr">
          {found.artists.length === 0 && found.tracks.length === 0 && <div className="text-xs text-[var(--color-text-dim)]">چیزی پیدا نشد؛ نام دقیق را بالا بنویس.</div>}
          {found.artists.length > 0 && <div className="flex flex-wrap gap-2">{found.artists.map((a) => <button key={a.name} onClick={() => setArtist(a.name)} className={chip}>🎤 {a.name}</button>)}</div>}
          {found.tracks.length > 0 && <div className="flex flex-wrap gap-2">{found.tracks.map((t, i) => <button key={i} onClick={() => { setTitle(t.title); setArtist(t.artist); }} className={chip}>{t.artist} — {t.title}</button>)}</div>}
        </div>
      )}
      {err && <div role="alert" className="text-xs text-rose-300">{err}</div>}
      <div className="flex flex-wrap gap-2 justify-end">
        <button disabled={busy} onClick={() => void post({ action: "revert" })} className={btn}>اصلِ آپلود</button>
        <button disabled={busy} onClick={() => void post({ action: "keep" })} className={btn}>همین‌طور بماند</button>
        <button disabled={busy || !title.trim() || !artist.trim()} onClick={() => void post({ action: "apply", title, artist })} className="min-h-11 px-4 rounded-xl bg-[var(--color-accent,#1db954)] text-black text-sm font-semibold disabled:opacity-50">ذخیره</button>
      </div>
    </div>
  );
}
