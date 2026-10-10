"use client";

import { useCallback, useEffect, useState } from "react";
import Section from "./Section";

// Numeric password for signing in to the music pages on playlist.bz (it opens the player only).
export default function PinCard({ onMessage }: { onMessage: (m: string) => void }) {
  const [state, setState] = useState<{ configured: boolean; canManage: boolean } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/auth/pin", { cache: "no-store" });
    if (r.ok) setState((await r.json()) as { configured: boolean; canManage: boolean });
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!state?.canManage) return null;

  async function save() {
    setBusy(true);
    const r = await fetch("/api/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    setBusy(false);
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (r.ok) { setPin(""); onMessage("رمز عددی ذخیره شد"); await load(); } else onMessage(j.error ?? "ذخیره نشد");
  }
  async function remove() {
    if (!confirm("رمز عددی حذف شود؟ ورود به playlist.bz تا تنظیم رمز جدید ممکن نیست.")) return;
    await fetch("/api/auth/pin", { method: "DELETE" });
    onMessage("رمز عددی حذف شد"); await load();
  }

  return (
    <Section icon="🔢" title="رمز عددی playlist.bz" summary={state.configured ? "تنظیم شده" : "هنوز تنظیم نشده"}>
      <p className="text-sm text-[var(--color-text-dim)] mt-2 leading-7">
        با این رمز در <span dir="ltr">playlist.bz/music</span> وارد می‌شوی. این ورود فقط به پلیر دسترسی دارد، نه به بقیهٔ داشبورد.
        {" "}{state.configured ? "رمز فعلی تنظیم شده؛ برای تغییر، رمز تازه را بنویس." : "هنوز رمزی تنظیم نشده."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="new-password" placeholder="۶ تا ۱۰ رقم" dir="ltr" aria-label="رمز عددی"
          className="h-11 w-44 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 tracking-widest tabular-nums" />
        <button onClick={() => void save()} disabled={busy || pin.length < 6} className="h-11 px-4 rounded-lg bg-[var(--color-accent,#3b82f6)] text-white disabled:opacity-50">{state.configured ? "تغییر رمز" : "ذخیره رمز"}</button>
        {state.configured && <button onClick={() => void remove()} className="h-11 px-4 rounded-lg border border-[var(--color-border)]">حذف رمز</button>}
      </div>
    </Section>
  );
}
