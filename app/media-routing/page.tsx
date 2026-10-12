"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
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
  skipped_bot_echo: "🤖 رد شد چون bot-echo بود",
  skipped_no_owner: "👤 رد شد چون owner پیدا نشد",
  skipped_owner_self: "👤 شاخه‌ی owner-self (router داره صدا می‌خوره)",
  passed_to_router: "→ rule گرفته شد، router داره اجرا می‌شه",
  skipped_no_bcid: "⚠️ بدون business_connection_id",
  skipped_no_content: "⚠️ hasContent=false (نباید برای voice پیش بیاد)",
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;

// Rows shown per chat before "show all" (the log can hold hundreds of rows for one chat).
const PER_CHAT = 15;

export default function MediaRoutingPage() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [decision, setDecision] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (decision !== "all") params.set("decision", decision);
      const r = await fetch(`/api/media-routing-log?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { log: LogEntry[] };
      setLog(j.log);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
        title="🛰 لاگ مسیریابی مدیا"
        subtitle="هر voice/video/photo که router تصمیم گرفت روش، اینجا ثبت می‌شه — حتی اگه روت نشده. برای debug «چرا کپی نشد؟»"
      />

      <Card className="mb-3">
        <label className="block text-sm text-[var(--color-text-dim)] mb-1.5" htmlFor="mr-filter">فیلتر</label>
        <select
          id="mr-filter"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          className="w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3"
        >
          {DECISIONS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-text-dim)]">{fa(log.length)} ردیف نمایش</span>
          <button onClick={reload} disabled={loading} className={BTN_PLAIN}>
            {loading ? "در حال بارگذاری…" : "🔄 بروزرسانی"}
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5 flex-wrap mt-3">
          {totals.map((t) => (
            <Pill
              key={t.key}
              tone={
                t.count === 0
                  ? "neutral"
                  : t.key === "routed"
                    ? "ok"
                    : t.key === "error" || t.key === "no_target"
                      ? "bad"
                      : "warn"
              }
            >
              {DECISION_LABEL[t.key]?.replace(/^[^\s]+\s/, "") ?? t.key}: {fa(t.count)}
            </Pill>
          ))}
        </div>
      </Card>

      {err ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری لاگ: {err}</p>
          <div className="mt-3 flex">
            <button onClick={() => void reload()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading && log.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری لاگ…</p>
        </Card>
      ) : log.length === 0 ? (
        <>
          <EmptyState
            icon="🛰"
            title="هیچ ردیفی نیست."
            hint="یعنی router برای هیچ پیام voice/video/photo اجرا نشده."
          />
          <div className="mt-3">
            <Section icon="❓" title="چرا خالیه؟" summary="اگه مطمئنی voice فرستادی، احتمالاً…">
              <ul className="flex flex-col gap-2 text-sm leading-7">
                <li className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
                  bot روی اون چت business connection نداره یا توی اون گروه عضو نیست
                </li>
                <li className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
                  deploy آخر بهینه نشده — کامیت <code dir="ltr">b49b061</code> رو deploy کن تا گروه/کانال هم لاگ بشن
                </li>
                <li className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
                  از مسیر دیگه‌ای (مثل secretary forward / inline) رفته که router ازش رد می‌شه
                </li>
              </ul>
            </Section>
          </div>
        </>
      ) : (
        chatIds.map((chatId, idx) => {
          const rows = groups[chatId]!;
          const expanded = showAll.has(chatId);
          const visible = expanded ? rows : rows.slice(0, PER_CHAT);
          return (
            <Section
              key={chatId}
              icon="💬"
              title={`chat ${chatId}`}
              summary={`${fa(rows.length)} ردیف · آخرین ${relTime(rows[0]!.createdAt)}`}
              badge={<Pill>{fa(rows.length)}</Pill>}
              defaultOpen={idx === 0}
            >
              <div className="flex mb-3">
                <Link href={`/chats/${chatId}`} className={BTN_PLAIN}>
                  باز کردن چت ↗
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {visible.map((e) => (
                  <div
                    key={e.id}
                    className={`p-3 rounded-xl border ${
                      DECISION_STYLE[e.decision] ?? "border-[var(--color-border)]"
                    }`}
                  >
                    <div className="text-sm font-medium leading-6">
                      {DECISION_LABEL[e.decision] ?? e.decision}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs">
                      <span dir="ltr">{e.kind}</span>
                      {e.targetChatId && (
                        <span dir="ltr">→ {e.targetRole}:{e.targetChatId}</span>
                      )}
                      <span className="text-[var(--color-text-dim)]">{relTime(e.createdAt)}</span>
                    </div>
                    {e.error && (
                      <div dir="ltr" className="text-xs mt-2 break-all font-mono opacity-80 text-start">
                        {e.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {rows.length > PER_CHAT && (
                <div className="mt-3 flex">
                  <button
                    onClick={() =>
                      setShowAll((cur) => {
                        const next = new Set(cur);
                        if (next.has(chatId)) next.delete(chatId);
                        else next.add(chatId);
                        return next;
                      })
                    }
                    className={BTN_PLAIN}
                  >
                    {expanded ? "نمایش کمتر" : `نمایش همه (${fa(rows.length)})`}
                  </button>
                </div>
              )}
            </Section>
          );
        })
      )}
    </Shell>
  );
}
