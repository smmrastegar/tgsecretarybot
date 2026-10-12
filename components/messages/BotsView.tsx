"use client";

import { useCallback, useEffect, useState } from "react";
import Chip from "@/components/dash/Chip";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import { relTime } from "@/lib/format";

export type BotSummary = { chatId: number; name: string; total: number; unhandled: number; urgentUnhandled: number; lastAt: string | null; inMain: boolean };

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const BTN = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";

// Bots send ~two thirds of everything the system logs and almost none of it matters day to day, so their
// messages stay out of the main feed. This is where they live: one card per bot, open it to read what it
// sent, pin the few that matter into the main feed, or clear a noisy bot's backlog in one tap.
export default function BotsView({ bots, onOpen, onChanged }: { bots: BotSummary[] | null; onOpen: (b: BotSummary) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 4000); return () => clearTimeout(t); }, [note]);

  const post = useCallback(async (chatId: number, body: Record<string, unknown>): Promise<{ cleared?: number } | null> => {
    setBusy(chatId);
    try {
      const r = await fetch("/api/messages/bots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, ...body }) });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { cleared?: number };
    } catch (e) {
      setNote(`انجام نشد (${e instanceof Error ? e.message : "خطا"})`);
      return null;
    } finally { setBusy(null); }
  }, []);

  if (!bots) return <div className="rounded-2xl border border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>;
  if (bots.length === 0) return <EmptyState icon="🤖" title="ربات فعالی نیست" hint="در ۳۰ روز اخیر هیچ رباتی پیام نفرستاده." />;

  return (
    <div className="space-y-3">
      {note && <div role="alert" className="rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 text-center">{note}</div>}
      <p className="px-2 text-center text-xs leading-6 text-[var(--color-text-dim)]">
        پیام ربات‌ها به‌طور پیش‌فرض در «پیام‌ها» و «فوری» نمی‌آید. اگر ربات مهمی داری، «نمایش در پیام‌های اصلی» را برایش روشن کن.
      </p>
      {bots.map((b) => (
        <section key={b.chatId} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
          <div className="text-sm font-semibold truncate" dir="auto">{b.name}</div>
          <div className="mt-0.5 text-xs text-[var(--color-text-dim)]">{b.lastAt ? `آخرین پیام ${relTime(b.lastAt)}` : "—"}</div>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            <Chip>{fa(b.total.toLocaleString("en-US"))} پیام در ۳۰ روز</Chip>
            {b.unhandled > 0 && <Chip tone="warn">{fa(b.unhandled.toLocaleString("en-US"))} رسیدگی‌نشده</Chip>}
            {b.urgentUnhandled > 0 && <Chip tone="danger">{fa(b.urgentUnhandled)} فوری</Chip>}
            {b.inMain && <Chip tone="ok">در پیام‌های اصلی</Chip>}
          </div>
          <label className="mt-3 flex min-h-12 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm cursor-pointer">
            <input type="checkbox" checked={b.inMain} disabled={busy === b.chatId}
              onChange={async (e) => { const ok = await post(b.chatId, { inMain: e.target.checked }); if (ok) onChanged(); }} />
            نمایش در پیام‌های اصلی
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => onOpen(b)} className="min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium">مشاهدهٔ پیام‌ها</button>
            <button type="button" disabled={busy === b.chatId || b.unhandled === 0} className={BTN}
              onClick={async () => {
                if (!(await confirmDialog(`همهٔ ${fa(b.unhandled.toLocaleString("en-US"))} پیام رسیدگی‌نشدهٔ «${b.name}» رسیدگی‌شده علامت بخورد؟`, { confirmLabel: "همه رسیدگی‌شد" }))) return;
                const r = await post(b.chatId, { markAllHandled: true });
                if (r) { setNote(`${fa(r.cleared ?? 0)} پیام رسیدگی‌شد`); onChanged(); }
              }}>همه رسیدگی‌شد</button>
          </div>
        </section>
      ))}
    </div>
  );
}
