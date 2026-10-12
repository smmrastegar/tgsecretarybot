"use client";

import { useCallback, useEffect, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { relTime } from "@/lib/format";
import { btnCls, fa } from "./shared";
import type { LogEntry } from "./types";

const decisionStyle: Record<string, string> = {
  routed: "border-emerald-700 bg-emerald-900/20 text-emerald-300",
  no_rule: "border-[var(--color-border)] bg-[var(--color-surface-2)]/30",
  flag_off: "border-amber-700 bg-amber-900/20 text-amber-300",
  muted: "border-amber-700 bg-amber-900/20 text-amber-300",
  no_target: "border-red-700 bg-red-900/20 text-red-300",
  error: "border-red-700 bg-red-900/20 text-red-300",
};
const decisionLabel: Record<string, string> = {
  routed: "✅ کپی شد",
  no_rule: "ℹ️ chat_rules نداره",
  flag_off: "⏸ flag خاموش",
  muted: "🔇 muted",
  no_target: "❌ کانال هدف ست نیست",
  error: "🔴 خطای ارسال",
};

// Why a voice/video/photo of this chat was (or was not) copied to a storage channel. Loads when opened.
export default function MediaRoutingLog({ chatId }: { chatId: number }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const r = await fetch(`/api/media-routing-log?chatId=${chatId}`);
      if (r.ok) {
        const j = (await r.json()) as { log: LogEntry[] };
        setLog(j.log);
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full min-h-12! flex items-center justify-center gap-2 text-sm font-medium">
        <span aria-hidden className="text-xs text-[var(--color-text-dim)]">{open ? "▼" : "◀"}</span>
        🛰 لاگ مسیریابی رسانه
      </button>
      <p className="text-xs leading-6 text-[var(--color-text-dim)]">دلیل اینکه چرا voice/video/photo رفت یا نرفت</p>
      <div className="mt-1 text-center">
        <a href="/media-routing" className="inline-flex min-h-10 items-center text-xs text-[var(--color-text-dim)] underline underline-offset-2">→ همه‌ی چت‌ها</a>
      </div>
      {open && (
        <div className="mt-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <span className="text-xs text-[var(--color-text-dim)]">{fa(log.length)} مورد آخر برای این چت</span>
            <button type="button" onClick={reload} disabled={loading} className={btnCls}>{loading ? "…" : "🔄 بازخوانی"}</button>
          </div>
          {failed ? (
            <EmptyState icon="⚠️" title="لاگ بارگذاری نشد" action={<button type="button" onClick={reload} className={btnCls}>تلاش دوباره</button>} />
          ) : log.length === 0 ? (
            <EmptyState icon="🛰" title="لاگ خالیه" hint="اولین voice/video/photo که توی این چت بیاد، تصمیم router اینجا ثبت می‌شه." />
          ) : (
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
              {log.map((e) => (
                <div key={e.id} className={`text-sm p-3 rounded-xl border ${decisionStyle[e.decision] ?? "border-[var(--color-border)]"}`}>
                  <div className="font-medium">{decisionLabel[e.decision] ?? e.decision}</div>
                  <div className="mt-1 flex items-center justify-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-[var(--color-text-dim)]">
                    <span dir="ltr">{e.kind}</span>
                    {e.targetChatId && <span dir="ltr">→ {e.targetRole}:{e.targetChatId}</span>}
                    <span>{relTime(e.createdAt)}</span>
                  </div>
                  {e.error && <div dir="ltr" className="text-xs mt-1.5 break-all font-mono opacity-80 text-start">{e.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
