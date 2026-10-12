"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import GroupAnalyticsView, { type Analysis } from "@/components/GroupAnalyticsView";

type CurrentTopic = {
  name: string;
  messageThreadId: number;
  archived: boolean;
};

type AnalyticsResponse = {
  ok: boolean;
  empty?: boolean;
  cached?: boolean;
  chatTitle: string | null;
  sinceIso: string | null;
  messageCount: number;
  analysis: Analysis | null;
  cachedAt?: string;
  shareToken?: string | null;
  currentTopics?: CurrentTopic[];
  error?: string;
};

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: "۳ روز", days: 3 },
  { label: "۷ روز", days: 7 },
  { label: "۱۴ روز", days: 14 },
  { label: "۳۰ روز", days: 30 },
];

const fa = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Shared control styles: every button/field is >= 44px tall and >= 14px text.
const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;
const BTN_DANGER = `${BTN} border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`;
// Action row: buttons sit on the physical left (also when it holds links, which the global rule does not cover).
const ACTIONS = "flex flex-wrap gap-2 w-full justify-[left]";
const FIELD = "w-full min-h-11 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3";

export default function GroupAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const chatId = Number(id);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Default to "از ابتدا" — operator wants the full history first,
  // then can drill into bounded windows.
  const [days, setDays] = useState(0);
  const [showRawMessages, setShowRawMessages] = useState(false);

  const load = useCallback(
    async (windowDays: number, force = false) => {
      setRunning(true);
      setErr(null);
      try {
        const method = force ? "POST" : "GET";
        const r = await fetch(
          `/api/groups/${chatId}/analytics?days=${windowDays}${force ? "&force=1" : ""}`,
          { method },
        );
        const j = (await r.json()) as AnalyticsResponse;
        if (!r.ok) throw new Error(j.error ?? "failed");
        setData(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [chatId],
  );

  useEffect(() => {
    if (Number.isFinite(chatId)) {
      load(days);
    }
  }, [chatId, days, load]);

  // Wipe every cached report of this group and rebuild the current window from scratch.
  const clearAndRebuild = async () => {
    await fetch(`/api/groups/${chatId}/analytics`, { method: "DELETE" });
    load(days, true);
  };

  return (
    <Shell>
      <div dir="rtl">
        <PageTitle
          title={
            data?.chatTitle
              ? `📊 ${data.chatTitle}`
              : `📊 گروه ${chatId}`
          }
          subtitle="تحلیل کارها، نقش‌ها، و موارد معوق در بازه‌ی انتخاب‌شده."
          actions={
            <div className={ACTIONS}>
              <Link href="/groups" className={BTN_PLAIN}>
                ← گروه‌ها
              </Link>
            </div>
          }
        />

        {/* Window picker + the one primary action */}
        <Card className="mb-3">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">بازه‌ی تحلیل</div>
          <div className="grid grid-cols-3 gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setDays(w.days)}
                disabled={running}
                aria-pressed={days === w.days}
                className={`min-h-11 px-2 rounded-xl text-sm border disabled:opacity-50 ${
                  days === w.days
                    ? "bg-[var(--color-accent)] text-white border-transparent"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {w.label}
              </button>
            ))}
            <button
              onClick={() => setDays(0)}
              disabled={running}
              aria-pressed={days === 0}
              className={`min-h-11 px-2 col-span-2 rounded-xl text-sm border text-amber-200 disabled:opacity-50 ${
                days === 0
                  ? "bg-amber-500/15 border-amber-500/40"
                  : "bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/15"
              }`}
              title="پردازش تمام تاریخچه‌ی گروه از ابتدا. سقف ۵۰۰۰ پیام."
            >
              🗂 از ابتدا
            </button>
          </div>
          <button
            onClick={() => load(days, true)}
            disabled={running}
            className={`${BTN_PRIMARY} w-full mt-3`}
          >
            {running ? "در حال پردازش…" : "↻ پردازش مجدد"}
          </button>
        </Card>

        {/* Less common tools stay folded away */}
        <Section icon="🧰" title="ابزارهای بیشتر" summary="پیام‌ها به تفکیک تاپیک، خروجی اعضا، پاکسازی">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowRawMessages(true)}
              disabled={running}
              className={`${BTN_PLAIN} w-full`}
              title="نمایش همه پیام‌های دریافت‌شده در این بازه به تفکیک تاپیک — برای بررسی اینکه AI با چی کار می‌کرده"
            >
              👀 نمایش پیام‌ها به تفکیک تاپیک
            </button>
            <a
              href={`/api/groups/${chatId}/members?format=csv`}
              download={`group-${chatId}-members.csv`}
              className={`${BTN_PLAIN} w-full`}
              title="فایل CSV با ID عددی، @username و اسم همه افرادی که توی این گروه پیام دادن"
            >
              👥 خروجی اعضا (CSV)
            </a>
            <button
              onClick={async () => {
                if (
                  !(await confirmDialog(
                    "همه گزارش‌های کش‌شده این گروه (همه بازه‌ها) پاک بشن؟ گزارش بعدی از اول ساخته می‌شه.",
                    { danger: true, confirmLabel: "پاک شود" },
                  ))
                )
                  return;
                await clearAndRebuild();
              }}
              disabled={running}
              className={`${BTN_DANGER} w-full`}
              title="پاک کردن همه گزارش‌های کش‌شده تا گزارش بعدی از صفر ساخته بشه"
            >
              🗑 پاکسازی گزارش‌ها
            </button>
          </div>
        </Section>

        <p className="mb-4 px-2 text-xs leading-6 text-center text-[var(--color-text-dim)]">
          لینکِ اشتراک‌گذاری عمومی و فرکانسِ خلاصه‌سازیِ این گروه از{" "}
          <Link href="/groups" className="text-[var(--color-accent)] underline">
            صفحه‌ی گروه‌ها
          </Link>{" "}
          تنظیم می‌شود.
        </p>

        {err && (
          <Card className="mb-4 border-red-800">
            <p className="text-sm text-red-300 leading-6">{err}</p>
            <div className="mt-3 flex">
              <button onClick={() => load(days)} disabled={running} className={BTN_PRIMARY}>
                تلاش دوباره
              </button>
            </div>
          </Card>
        )}

        {running && !data && (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">
              در حال پردازش پیام‌های گروه…
            </p>
          </Card>
        )}

        {data?.empty && (
          <EmptyState
            icon="💬"
            title="هیچ پیامی در این بازه پیدا نشد."
            hint="بازه‌ی بزرگ‌تری مثل «از ابتدا» را امتحان کن."
          />
        )}

        {data?.analysis && (
          <>
            {data.cached && data.cachedAt && (
              <div className="text-xs leading-6 text-center text-[var(--color-text-dim)] mb-3">
                💾 از کش: {new Date(data.cachedAt).toLocaleString("fa-IR")} (برای داده‌ی تازه‌تر «پردازش مجدد» رو بزن)
              </div>
            )}
            {data.analysis.tasks.length === 0 && data.messageCount > 0 && (
              <EmptyAnalysisBanner
                messageCount={data.messageCount}
                debug={data.analysis.debug}
                running={running}
                onReprocess={() => load(days, true)}
                onClear={clearAndRebuild}
              />
            )}
            <GroupAnalyticsView
              analysis={data.analysis}
              messageCount={data.messageCount}
              sinceIso={data.sinceIso}
              currentTopics={data.currentTopics}
            />
          </>
        )}
        {showRawMessages && (
          <RawMessagesModal
            chatId={chatId}
            days={days}
            onClose={() => setShowRawMessages(false)}
            onAnalyze={async () => {
              setShowRawMessages(false);
              await clearAndRebuild();
            }}
            running={running}
          />
        )}
      </div>
    </Shell>
  );
}

function EmptyAnalysisBanner({
  messageCount,
  debug,
  running,
  onReprocess,
  onClear,
}: {
  messageCount: number;
  debug: Analysis["debug"];
  running: boolean;
  onReprocess: () => void;
  onClear: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const statusHint = (() => {
    if (!debug) return null;
    switch (debug.parseStatus) {
      case "empty_response":
        return "AI پاسخی برنگردوند — احتمالاً مدل time-out یا rate-limit خورده.";
      case "no_json":
        return "AI پاسخ داد ولی JSON معتبر نبود — احتمالاً پاسخ توی نیمه قطع شده.";
      case "parse_error":
        return "AI پاسخ JSON داد ولی هیچ task/overview معتبری توش نبود — احتمالاً مدل سوال رو بد فهمیده.";
      default:
        return "AI پاسخ معتبر داد ولی تشخیص داد هیچ task واضحی توی پیام‌ها نیست.";
    }
  })();
  return (
    <Card className="mb-3 border-amber-500/40 bg-amber-500/5">
      <p className="text-sm leading-6 text-amber-200 mb-1">
        ⚠️ {fa(messageCount)} پیام پردازش شد ولی AI هیچ تسکی استخراج نکرد.
      </p>
      {statusHint && (
        <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
          {statusHint}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onReprocess}
          disabled={running}
          className={`${BTN} bg-amber-500/20 border border-amber-500/50 text-amber-100 hover:bg-amber-500/30`}
        >
          {running ? "..." : "↻ پردازش مجدد"}
        </button>
        <button onClick={onClear} disabled={running} className={BTN_DANGER}>
          🗑 پاک کن و از نو
        </button>
        {debug?.rawResponse && (
          <button onClick={() => setShowRaw((v) => !v)} className={`${BTN_PLAIN} col-span-2`}>
            {showRaw ? "بستن" : "🔧 پاسخ خام AI"}
          </button>
        )}
      </div>
      {showRaw && debug?.rawResponse && (
        <pre
          dir="ltr"
          className="mt-3 text-xs text-start bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-80"
        >
          {debug.rawResponse}
        </pre>
      )}
    </Card>
  );
}

type TopicBucket = {
  name: string;
  messageThreadId: number | null;
  archived: boolean;
  notes: string | null;
  messages: { sender: string; text: string; at: string; fromOwner: boolean }[];
};

// Full-height sheet on phones (bottom sheet), centred dialog on desktop.
function RawMessagesModal({
  chatId,
  days,
  onClose,
  onAnalyze,
  running,
}: {
  chatId: number;
  days: number;
  onClose: () => void;
  onAnalyze: () => void;
  running: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicBucket[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [archivedHidden, setArchivedHidden] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetch(
      `/api/groups/${chatId}/messages?days=${days}${
        showArchived ? "&includeArchived=1" : ""
      }`,
    )
      .then(async (r) => {
        const j = (await r.json()) as {
          ok: boolean;
          totalMessages?: number;
          archivedHidden?: number;
          topics?: TopicBucket[];
          error?: string;
        };
        if (!alive) return;
        if (!r.ok) throw new Error(j.error ?? "failed");
        setTopics(j.topics ?? []);
        setTotalMessages(j.totalMessages ?? 0);
        setArchivedHidden(j.archivedHidden ?? 0);
        // Auto-expand the first (largest) topic so the operator sees
        // content immediately without an extra click.
        const first = (j.topics ?? []).find((t) => !t.archived);
        if (first) {
          setExpanded(new Set([keyOf(first)]));
        }
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [chatId, days, showArchived, reloadKey]);

  const keyOf = (t: TopicBucket): string =>
    t.messageThreadId == null ? "general" : String(t.messageThreadId);
  const toggle = (k: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const expandAll = () =>
    setExpanded(new Set(topics.map(keyOf)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl md:rounded-2xl w-full max-w-3xl flex flex-col h-[92dvh] md:h-auto md:max-h-[90vh]"
      >
        <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
          <div className="min-w-0 flex-1 text-center">
            <h2 className="text-base font-semibold mb-1">
              📨 پیام‌های دریافت‌شده به تفکیک تاپیک
            </h2>
            <p className="text-xs text-[var(--color-text-dim)]">
              {days === 0 ? "از ابتدا" : `${fa(days)} روز اخیر`} · {fa(totalMessages)}{" "}
              پیام · {fa(topics.length)} تاپیک
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="shrink-0 w-11 h-11 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <button onClick={expandAll} disabled={topics.length === 0} className={`${BTN_PLAIN} !px-2`}>
              باز کن همه
            </button>
            <button onClick={collapseAll} disabled={topics.length === 0} className={`${BTN_PLAIN} !px-2`}>
              ببند همه
            </button>
            <label className="min-h-11 text-sm flex items-center justify-center gap-1.5 px-2 rounded-xl border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-2)]">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              آرشیوشده‌ها
              {archivedHidden > 0 && !showArchived && (
                <span className="text-[var(--color-text-dim)]">
                  ({fa(archivedHidden)})
                </span>
              )}
            </label>
          </div>
          <button
            onClick={onAnalyze}
            disabled={running || totalMessages === 0}
            className={`${BTN_PRIMARY} w-full`}
            title="کش رو پاک کن و روی همین پیام‌ها از نو تحلیل بزن"
          >
            {running ? "..." : "🔁 تحلیل روی این پیام‌ها"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <p className="text-sm text-[var(--color-text-dim)] text-center py-6">
              در حال بارگذاری…
            </p>
          )}
          {err && (
            <div className="text-center py-6">
              <p className="text-sm text-red-300 mb-3">{err}</p>
              <button onClick={() => setReloadKey((k) => k + 1)} className={BTN_PRIMARY}>
                تلاش دوباره
              </button>
            </div>
          )}
          {!loading && !err && topics.length === 0 && (
            <p className="text-sm text-[var(--color-text-dim)] text-center py-6">
              هیچ پیامی توی این بازه ثبت نشده.
            </p>
          )}
          {topics.some((t) => t.name.startsWith("Topic #")) && (
            <div className="mb-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs leading-6 text-amber-200 text-center">
              ⚠️ بعضی تاپیک‌ها به اسم «Topic #N» نشون داده می‌شن چون ربات
              موقع ساخته شدنشون توی گروه نبود (Telegram Bot API امکان
              fetch retroactive تاپیک‌ها رو نمی‌ده). تاپیک رو باز کن و با «ویرایش نام»
              اسم واقعی‌اش رو دستی بزن — یا توی تلگرام تاپیک
              رو rename کن (می‌تونی بعداً اسم اصلیش رو برگردونی) تا ربات
              event رو دریافت کنه.
            </div>
          )}
          {topics.map((t) => {
            const k = keyOf(t);
            const open = expanded.has(k);
            return (
              <div
                key={k}
                className={`mb-2 border rounded-2xl overflow-hidden border-[var(--color-border)] ${
                  t.archived ? "opacity-60" : ""
                }`}
              >
                <button
                  onClick={() => toggle(k)}
                  aria-expanded={open}
                  className="w-full min-h-14 flex items-center gap-3 px-4 py-2 bg-[var(--color-surface-2)] active:bg-[var(--color-surface)]"
                >
                  <span
                    dir="auto"
                    className={`min-w-0 flex-1 text-center text-sm font-medium truncate ${
                      t.archived ? "line-through" : ""
                    }`}
                  >
                    🧵 {t.name}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-text-dim)]">
                    {fa(t.messages.length)} پیام {open ? "▾" : "▸"}
                  </span>
                </button>
                {open && (
                  <TopicNameEditor
                    chatId={chatId}
                    threadId={t.messageThreadId}
                    initialName={t.name}
                    archived={t.archived}
                    onRenamed={(newName) => {
                      setTopics((prev) =>
                        prev.map((tt) =>
                          keyOf(tt) === k ? { ...tt, name: newName } : tt,
                        ),
                      );
                    }}
                    onArchivedToggle={(archived) => {
                      setTopics((prev) => {
                        const next = prev.map((tt) =>
                          keyOf(tt) === k ? { ...tt, archived } : tt,
                        );
                        // When hiding archived topics is on and we
                        // just archived, drop it from view immediately.
                        return showArchived
                          ? next
                          : next.filter((tt) => !tt.archived);
                      });
                      // Bump the archived count so the toggle label
                      // stays accurate without a full reload.
                      setArchivedHidden((n) =>
                        Math.max(0, n + (archived ? 1 : -1)),
                      );
                    }}
                  />
                )}
                {open && t.messageThreadId != null && (
                  <TopicNotesEditor
                    chatId={chatId}
                    threadId={t.messageThreadId}
                    initialNotes={t.notes}
                    onSaved={(notes) => {
                      setTopics((prev) =>
                        prev.map((tt) =>
                          keyOf(tt) === k ? { ...tt, notes } : tt,
                        ),
                      );
                    }}
                  />
                )}
                {open && t.messages.length === 0 && (
                  <p className="text-xs text-center text-[var(--color-text-dim)] p-4">
                    این تاپیک توی این بازه پیامی نداشت.
                  </p>
                )}
                {open && t.messages.length > 0 && (
                  <ul className="flex flex-col gap-1.5 p-2">
                    {t.messages.map((m, i) => (
                      <li
                        key={i}
                        className={`text-sm rounded-xl px-3 py-2 ${
                          m.fromOwner
                            ? "bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40"
                            : "bg-[var(--color-surface-2)] border border-[var(--color-border)]"
                        }`}
                      >
                        <div className="text-xs text-[var(--color-text-dim)] mb-1">
                          {m.fromOwner ? "شما" : m.sender} ·{" "}
                          {new Date(m.at).toLocaleString("fa-IR")}
                        </div>
                        {/* Message text is user content: keep it start-aligned, not centred. */}
                        <div
                          dir="auto"
                          style={{
                            unicodeBidi: "plaintext",
                            textAlign: "start",
                          }}
                          className="whitespace-pre-wrap break-words leading-6"
                        >
                          {m.text}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TopicNameEditor({
  chatId,
  threadId,
  initialName,
  archived,
  onRenamed,
  onArchivedToggle,
}: {
  chatId: number;
  threadId: number | null;
  initialName: string;
  archived: boolean;
  onRenamed: (next: string) => void;
  onArchivedToggle: (archived: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const archive = async (next: boolean) => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/groups/${chatId}/topics/${threadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: next }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onArchivedToggle(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // The "General" pseudo-topic has no real thread id — Telegram's
  // bot API doesn't expose a rename hook for it. Nothing to edit.
  if (threadId == null) return null;

  const save = async () => {
    const next = value.trim();
    if (!next || next === initialName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/groups/${chatId}/topics/${threadId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onRenamed(next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="px-3 py-3 border-b border-[var(--color-border)] flex flex-col gap-2">
        <input
          autoFocus
          dir="auto"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setValue(initialName);
              setEditing(false);
            }
          }}
          disabled={saving}
          aria-label="نام تاپیک"
          className={`${FIELD} text-center`}
        />
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className={BTN_PRIMARY}>
            {saving ? "..." : "ذخیره"}
          </button>
          <button
            onClick={() => {
              setValue(initialName);
              setEditing(false);
              setErr(null);
            }}
            disabled={saving}
            className={BTN_PLAIN}
          >
            لغو
          </button>
        </div>
        {err && <span className="text-xs text-red-300 text-center">{err}</span>}
      </div>
    );
  }
  return (
    <div className="px-3 py-3 border-b border-[var(--color-border)] flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing(true)}
          className={BTN_PLAIN}
          title="ویرایش نام تاپیک"
        >
          ✎ ویرایش نام
        </button>
        {archived ? (
          <button
            onClick={() => archive(false)}
            disabled={saving}
            className={`${BTN} border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`}
            title="از آرشیو دربیار — دوباره توی تحلیل میاد"
          >
            ↩ بازگردانی
          </button>
        ) : (
          <button
            onClick={() => archive(true)}
            disabled={saving}
            className={`${BTN} border border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-rose-300 hover:bg-rose-500/10`}
            title="این تاپیک رو آرشیو کن — از تحلیل و این نمایش حذف می‌شه"
          >
            🗑 آرشیو
          </button>
        )}
      </div>
      {err && <span className="text-xs text-red-300 text-center">{err}</span>}
    </div>
  );
}

function TopicNotesEditor({
  chatId,
  threadId,
  initialNotes,
  onSaved,
}: {
  chatId: number;
  threadId: number;
  initialNotes: string | null;
  onSaved: (notes: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/groups/${chatId}/topics/${threadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { notes: string | null };
      onSaved(j.notes);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!editing && !initialNotes) {
    return (
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <button
          onClick={() => setEditing(true)}
          className="w-full min-h-11 rounded-xl text-sm text-[var(--color-text-dim)] hover:text-amber-200 hover:bg-amber-500/5"
          title="یه توضیح کوتاه بنویس تا AI موقع تحلیل این تاپیک متن رو بهتر بفهمه"
        >
          📝 شرح این تاپیک رو بنویس <span className="opacity-60">(کمک‌کننده برای AI)</span>
        </button>
      </div>
    );
  }
  if (!editing && initialNotes) {
    return (
      <div className="px-3 py-3 border-b border-[var(--color-border)] bg-amber-500/5">
        <div className="text-xs text-amber-200/80 mb-1 text-center">
          📝 شرح برای AI:
        </div>
        {/* User-written note: start-aligned for readability. */}
        <p
          dir="auto"
          style={{ unicodeBidi: "plaintext", textAlign: "start" }}
          className="text-sm leading-6 whitespace-pre-wrap break-words"
        >
          {initialNotes}
        </p>
        <div className="mt-2 flex">
          <button
            onClick={() => {
              setValue(initialNotes);
              setEditing(true);
            }}
            className={BTN_PLAIN}
          >
            ✎ ویرایش
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="px-3 py-3 border-b border-[var(--color-border)] bg-amber-500/5">
      <div className="text-xs leading-6 text-amber-200/80 mb-2 text-center">
        📝 شرح برای AI — مثلاً «این تاپیک فقط برای bug report هست» یا
        «هر پیام مشتری توی این تاپیک یک سفارش جدید است»
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        rows={3}
        dir="auto"
        aria-label="شرح تاپیک برای AI"
        style={{ unicodeBidi: "plaintext", textAlign: "start" }}
        className="w-full text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3 py-2"
      />
      <div className="flex gap-2 mt-2">
        <button onClick={save} disabled={saving} className={BTN_PRIMARY}>
          {saving ? "..." : "ذخیره"}
        </button>
        <button
          onClick={() => {
            setValue(initialNotes ?? "");
            setEditing(false);
            setErr(null);
          }}
          disabled={saving}
          className={BTN_PLAIN}
        >
          لغو
        </button>
      </div>
      {err && <span className="block mt-2 text-xs text-red-300 text-center">{err}</span>}
    </div>
  );
}
