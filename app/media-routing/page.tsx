"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type LogEntry = {
  id: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  kind: string;
  decision: string;
  targetRole: string | null;
  targetChatId: number | null;
  targetMessageId: number | null;
  error: string | null;
  createdAt: string;
};

const DECISIONS = [
  ["all", "همه"],
  ["routed", "✅ کپی شد"],
  ["flag_off", "⏸ flag خاموش"],
  ["muted", "🔇 muted"],
  ["no_target", "❌ کانال هدف ست نیست"],
  ["no_rule", "ℹ️ chat_rules نداره"],
  ["error", "🔴 خطای ارسال"],
  ["received_business", "📨 رسید (business)"],
  ["received_group", "📨 رسید (group/channel)"],
] as const;

const DECISION_STYLE: Record<string, string> = {
  routed: "border-emerald-700 bg-emerald-900/20 text-emerald-300",
  no_rule: "border-[var(--color-border)] bg-[var(--color-surface-2)]/30",
  flag_off: "border-amber-700 bg-amber-900/20 text-amber-300",
  muted: "border-amber-700 bg-amber-900/20 text-amber-300",
  no_target: "border-red-700 bg-red-900/20 text-red-300",
  error: "border-red-700 bg-red-900/20 text-red-300",
  received_business: "border-blue-700 bg-blue-900/15 text-blue-300",
  received_group: "border-blue-700 bg-blue-900/15 text-blue-300",
  received_secretary: "border-blue-700 bg-blue-900/15 text-blue-300",
  received_edit: "border-blue-700 bg-blue-900/15 text-blue-300",
};

const DECISION_LABEL: Record<string, string> = {
  routed: "✅ کپی شد",
  no_rule: "ℹ️ chat_rules نداره",
  flag_off: "⏸ flag خاموش",
  muted: "🔇 muted",
  no_target: "❌ کانال هدف ست نیست",
  error: "🔴 خطای ارسال",
  received_business: "📨 پیام رسید — مسیر business",
  received_group: "📨 پیام رسید — مسیر group/channel",
  received_secretary: "📨 پیام رسید — مسیر secretary",
  received_edit: "📨 ویرایش پیام رسید",
};

export default function MediaRoutingPage() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [decision, setDecision] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (decision !== "all") params.set("decision", decision);
      const r = await fetch(`/api/media-routing-log?${params.toString()}`);
      if (r.ok) {
        const j = (await r.json()) as { log: LogEntry[] };
        setLog(j.log);
      }
    } finally {
      setLoading(false);
    }
  }, [decision]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Group by source_chat_id so the operator can see which chats are
  // actually firing the router.
  const groups = log.reduce<Record<number, LogEntry[]>>((acc, e) => {
    if (!acc[e.sourceChatId]) acc[e.sourceChatId] = [];
    acc[e.sourceChatId]!.push(e);
    return acc;
  }, {});
  const chatIds = Object.keys(groups)
    .map(Number)
    .sort(
      (a, b) =>
        Date.parse(groups[b]![0]!.createdAt) -
        Date.parse(groups[a]![0]!.createdAt),
    );

  const totals = DECISIONS.slice(1).map(([k]) => ({
    key: k,
    count: log.filter((e) => e.decision === k).length,
  }));

  return (
    <Shell>
      <PageTitle
        title="🛰 Media routing log"
        subtitle="هر voice/video/photo که router تصمیم گرفت روش، اینجا ثبت می‌شه — حتی اگه روت نشده. برای debug «چرا کپی نشد؟»"
      />

      <Card className="mb-3 !p-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[var(--color-text-dim)]">فیلتر:</span>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          >
            {DECISIONS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={reload}
            disabled={loading}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {loading ? "…" : "🔄"}
          </button>
          <span className="text-[var(--color-text-dim)] ml-auto">
            {log.length} ردیف نمایش
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-2 text-[10px]">
          {totals.map((t) => (
            <Badge
              key={t.key}
              tone={
                t.count === 0
                  ? "neutral"
                  : t.key === "routed"
                    ? "success"
                    : t.key === "error" || t.key === "no_target"
                      ? "danger"
                      : "warn"
              }
            >
              {DECISION_LABEL[t.key]?.replace(/^[^\s]+\s/, "") ?? t.key}:{" "}
              {t.count}
            </Badge>
          ))}
        </div>
      </Card>

      {log.length === 0 ? (
        <Card>
          <div className="text-[11px] text-[var(--color-text-dim)] mb-1">
            هیچ ردیفی نیست.
          </div>
          <div className="text-[10px] text-[var(--color-text-dim)]">
            یعنی router برای هیچ پیام voice/video/photo اجرا نشده. اگه مطمئنی
            که voice فرستادی، احتمالاً:
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>
                bot روی اون چت business connection نداره یا توی اون گروه عضو
                نیست
              </li>
              <li>
                deploy آخر بهینه نشده — کامیت <code>b49b061</code> رو deploy کن
                تا گروه/کانال هم لاگ بشن
              </li>
              <li>
                از مسیر دیگه‌ای (مثل secretary forward / inline) رفته که router
                ازش رد می‌شه
              </li>
            </ul>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {chatIds.map((chatId) => (
            <Card key={chatId} className="!p-2">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <Link
                  href={`/chats/${chatId}`}
                  className="text-sm font-medium hover:underline"
                  dir="ltr"
                >
                  chat {chatId}
                </Link>
                <span className="text-[10px] text-[var(--color-text-dim)]">
                  {groups[chatId]!.length} ردیف
                </span>
              </div>
              <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
                {groups[chatId]!.map((e) => (
                  <div
                    key={e.id}
                    className={`text-[11px] p-1.5 rounded-md border ${
                      DECISION_STYLE[e.decision] ??
                      "border-[var(--color-border)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {DECISION_LABEL[e.decision] ?? e.decision}
                      </span>
                      <span className="text-[10px]" dir="ltr">
                        {e.kind}
                      </span>
                      {e.targetChatId && (
                        <span className="text-[10px]" dir="ltr">
                          → {e.targetRole}:{e.targetChatId}
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">
                        {relTime(e.createdAt)}
                      </span>
                    </div>
                    {e.error && (
                      <div
                        dir="ltr"
                        className="text-[10px] mt-1 break-all font-mono opacity-80"
                      >
                        {e.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
