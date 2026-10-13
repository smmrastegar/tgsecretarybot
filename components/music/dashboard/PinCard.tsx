"use client";

import { useCallback, useEffect, useState } from "react";
import Section, { Pill } from "./Section";

// Numeric passwords for signing in to the music pages on playlist.bz (they open the player only).
// Several can exist; each is shown on request, can be copied, switched off and on, or removed.
type Pin = { id: number; label: string; pin: string; active: boolean; createdAt: string; lastUsedAt: string | null };

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const when = (iso: string | null) => (iso ? new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "—");
const btn = "min-h-10 px-3 rounded-lg border border-[var(--color-border)] text-xs active:bg-[var(--color-surface-2)] disabled:opacity-50";
const randomPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0]! % 900000)); };

export default function PinCard({ onMessage }: { onMessage: (m: string) => void }) {
  const [state, setState] = useState<{ configured: boolean; canManage: boolean; pins?: Pin[] } | null>(null);
  const [pin, setPin] = useState("");
  const [label, setLabel] = useState("");
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/auth/pin", { cache: "no-store" });
    if (r.ok) setState((await r.json()) as { configured: boolean; canManage: boolean; pins?: Pin[] });
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!state?.canManage) return null;
  const pins = state.pins ?? [];
  const activeCount = pins.filter((p) => p.active).length;

  async function call(method: string, body?: unknown, qs = ""): Promise<{ ok: boolean; error?: string }> {
    const r = await fetch(`/api/auth/pin${qs}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: r.ok, error: j.error };
  }
  async function add() {
    setBusy(true);
    const r = await call("POST", { pin, label });
    setBusy(false);
    if (r.ok) { setPin(""); setLabel(""); onMessage("رمز ذخیره شد"); await load(); } else onMessage(r.error ?? "ذخیره نشد");
  }
  async function patch(id: number, body: Record<string, unknown>) {
    const r = await call("PATCH", { id, ...body });
    if (!r.ok) onMessage(r.error ?? "انجام نشد");
    await load();
  }
  async function remove(p: Pin) {
    if (!confirm(`رمز «${p.label || p.pin.replace(/./g, "•")}» حذف شود؟`)) return;
    await call("DELETE", undefined, `?id=${p.id}`);
    onMessage("رمز حذف شد"); await load();
  }
  async function copy(p: Pin) {
    try { await navigator.clipboard.writeText(p.pin); onMessage("رمز کپی شد"); } catch { onMessage("کپی نشد؛ رمز را نشان بده و دستی بنویس"); }
  }
  const toggleShow = (id: number) => setShown((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Section icon="🔢" title="رمزهای عددی playlist.bz" summary={pins.length ? `${fa(activeCount)} فعال از ${fa(pins.length)}` : state.configured ? "یک رمز قدیمی فعال است" : "هنوز تنظیم نشده"}
      badge={activeCount > 0 ? <Pill tone="ok">{fa(activeCount)} فعال</Pill> : undefined}>
      <p className="text-sm text-[var(--color-text-dim)] mt-2 leading-7">
        با هر رمزِ فعال می‌شود در <span dir="ltr">playlist.bz/music</span> وارد شد. این ورود فقط به پلیر دسترسی دارد، نه به بقیهٔ داشبورد.
        می‌توانی چند رمز بسازی (مثلاً برای هر نفر یکی) و هر کدام را جدا خاموش و روشن کنی.
      </p>

      {pins.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pins.map((p) => (
            <li key={p.id} className={`rounded-xl border border-[var(--color-border)] p-3 ${p.active ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-2 flex-wrap justify-center text-center">
                <span className="text-sm font-medium" dir="auto">{p.label || "بدون نام"}</span>
                <Pill tone={p.active ? "ok" : undefined}>{p.active ? "فعال" : "غیرفعال"}</Pill>
              </div>
              <div dir="ltr" className="mt-2 text-center font-mono text-lg tracking-[0.3em] tabular-nums select-all">{shown.has(p.id) ? p.pin : "•".repeat(p.pin.length)}</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-dim)] text-center">ساخته‌شده: {when(p.createdAt)} · آخرین ورود: {when(p.lastUsedAt)}</div>
              <div className="mt-2 flex flex-wrap gap-2 justify-end">
                <button onClick={() => toggleShow(p.id)} className={btn}>{shown.has(p.id) ? "🙈 پنهان" : "👁 نمایش"}</button>
                <button onClick={() => void copy(p)} className={btn}>⧉ کپی</button>
                <button onClick={() => { const n = prompt("نام این رمز (مثلاً: ماشین، پرنیان):", p.label); if (n != null) void patch(p.id, { label: n }); }} className={btn}>نام</button>
                <button onClick={() => void patch(p.id, { active: !p.active })} className={`${btn} ${p.active ? "text-amber-200" : "text-emerald-200"}`}>{p.active ? "خاموش کردن" : "روشن کردن"}</button>
                <button onClick={() => void remove(p)} className={`${btn} text-rose-300`}>حذف</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pins.length === 0 && state.configured && <p className="mt-3 text-xs text-amber-300 leading-6">یک رمزِ قدیمی (که قابل نمایش نیست) هنوز کار می‌کند. یک رمز تازه بساز تا همه‌چیز اینجا دیده شود.</p>}

      <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
        <div className="text-xs font-medium mb-2 text-center">رمز تازه</div>
        <div className="flex flex-wrap gap-2 items-center justify-center">
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="off" placeholder="۶ تا ۱۰ رقم" dir="ltr" aria-label="رمز عددی"
            className="h-11 w-40 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 tracking-widest tabular-nums text-center" />
          <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="نام (اختیاری)" aria-label="نام رمز" className="h-11 w-40 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 text-center" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 justify-end">
          <button onClick={() => setPin(randomPin())} className={btn}>🎲 رمز تصادفی</button>
          <button onClick={() => void add()} disabled={busy || pin.length < 6} className="min-h-10 px-4 rounded-lg bg-[var(--color-accent,#3b82f6)] text-white text-sm disabled:opacity-50">＋ ذخیره رمز</button>
        </div>
      </div>
    </Section>
  );
}
