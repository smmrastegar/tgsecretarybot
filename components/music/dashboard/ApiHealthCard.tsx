"use client";

import { useCallback, useEffect, useState } from "react";
import Section, { Pill } from "./Section";

// Spotify / SoundCloud: are they answering, or have they limited us? (counted per call + a probe every 6 hours)
type Day = { day: string; provider: string; ok: number; limited: number; error: number; lastLimitedAt: string | null; lastRetryAfterS: number | null; lastError: string | null; lastOkAt: string | null };
type Data = { days: Day[]; state: { spotify: string; soundcloud: string }; probedAt: number | null; cleanupPausedUntil: number | null };

const fa = (v: number) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const NAMES: Record<string, string> = { spotify: "اسپاتیفای", soundcloud: "ساندکلاود" };
const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";

function ago(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? "همین الان" : m < 60 ? `${fa(m)} دقیقه پیش` : m < 2880 ? `${fa(Math.round(m / 60))} ساعت پیش` : `${fa(Math.round(m / 1440))} روز پیش`;
}

export default function ApiHealthCard() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/music/api-health", { cache: "no-store" });
    if (r.ok) setD((await r.json()) as Data); else if (r.status === 401 || r.status === 403) setDenied(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (denied || !d) return null;

  const providers = ["spotify", "soundcloud"] as const;
  const bad = providers.filter((p) => d.state[p] !== "ok");
  async function probe() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/music/api-health", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { results?: Array<{ provider: string; ok: boolean; status: number | null; detail: string; retryAfterS?: number }> };
      setNote((j.results ?? []).map((x) => `${NAMES[x.provider] ?? x.provider}: ${x.ok ? "سالم ✓" : x.status === 429 ? `محدود شده${x.retryAfterS ? ` (حدود ${fa(Math.ceil(x.retryAfterS / 3600))} ساعت)` : ""}` : `خطا — ${x.detail}`}`).join("  ·  ") || "هیچ‌کدام تنظیم نشده");
    } catch { setNote("اتصال برقرار نشد"); }
    setBusy(false); void load();
  }
  const today = (p: string) => d.days.find((x) => x.provider === p && x.day === d.days[0]?.day);
  return (
    <Section icon="📡" title="سلامت اسپاتیفای و ساندکلاود" summary={bad.length ? bad.map((p) => `${NAMES[p]} ${d.state[p] === "limited" ? "محدود" : "خطا"}`).join(" · ") : `هر دو سالم${d.probedAt ? ` — آخرین آزمایش ${ago(d.probedAt)}` : ""}`}
      badge={bad.length ? <Pill tone="warn">{fa(bad.length)} مشکل</Pill> : <Pill tone="ok">سالم</Pill>}>
      <div className="space-y-2">
        {providers.map((p) => {
          const rows = d.days.filter((x) => x.provider === p);
          const sum = rows.reduce((a, x) => ({ ok: a.ok + x.ok, limited: a.limited + x.limited, error: a.error + x.error }), { ok: 0, limited: 0, error: 0 });
          const last = rows.map((x) => x.lastLimitedAt).filter(Boolean).sort().pop();
          const t = today(p);
          return (
            <div key={p} className="rounded-xl border border-[var(--color-border)] p-3 text-xs leading-6">
              <div className="flex items-center gap-2"><span className="text-sm font-medium flex-1">{NAMES[p]}</span>{d.state[p] === "ok" ? <Pill tone="ok">سالم</Pill> : <Pill tone="warn">{d.state[p] === "limited" ? "محدود" : "خطا"}</Pill>}</div>
              <div className="text-[var(--color-text-dim)]">۷ روز اخیر: {fa(sum.ok)} درخواست موفق، {fa(sum.limited)} بار «محدود شدی»، {fa(sum.error)} خطا{t ? ` — امروز ${fa(t.ok)} موفق` : ""}</div>
              {last && <div className="text-[var(--color-text-dim)]">آخرین محدودیت: {ago(new Date(last).getTime())}</div>}
              {rows.find((x) => x.lastError)?.lastError && <div dir="ltr" className="text-[11px] text-amber-300 break-words">{rows.find((x) => x.lastError)!.lastError}</div>}
            </div>
          );
        })}
      </div>
      {d.cleanupPausedUntil && <p className="mt-2 text-[11px] text-amber-300 leading-6">اصلاح خودکار نام آهنگ‌های ساندکلاود تا {new Date(d.cleanupPausedUntil).toLocaleString("fa-IR")} صبر می‌کند (اسپاتیفای محدود کرده).</p>}
      {note && <div role="status" className="mt-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs leading-6">{note}</div>}
      <div className="mt-3 flex justify-end"><button onClick={() => void probe()} disabled={busy} className={btn}>{busy ? "…" : "آزمایش همین الان"}</button></div>
      <p className="mt-2 text-[11px] text-[var(--color-text-dim)] leading-6 text-center">هر ۶ ساعت یک آزمایش خودکار انجام می‌شود و اگر چیزی خراب شود در گزارش شبانه و لاگ سیستم می‌آید.</p>
    </Section>
  );
}
