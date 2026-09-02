"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
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
            <div className="flex gap-2 flex-wrap">
              {WINDOWS.map((w) => (
                <button
                  key={w.days}
                  onClick={() => setDays(w.days)}
                  disabled={running}
                  className={`text-xs px-3 py-1.5 rounded-md border ${
                    days === w.days
                      ? "bg-[var(--color-accent)] text-white border-transparent"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  } disabled:opacity-50`}
                >
                  {w.label}
                </button>
              ))}
              <button
                onClick={() => setDays(0)}
                disabled={running}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  days === 0
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                    : "bg-amber-500/5 border-amber-500/30 text-amber-200 hover:bg-amber-500/15"
                } disabled:opacity-50`}
                title="پردازش تمام تاریخچه‌ی گروه از ابتدا. سقف ۵۰۰۰ پیام."
              >
                🗂 از ابتدا
              </button>
              <button
                onClick={() => load(days, true)}
                disabled={running}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                {running ? "در حال پردازش…" : "↻ پردازش مجدد"}
              </button>
              <button
                onClick={() => setShowRawMessages(true)}
                disabled={running}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                title="نمایش همه پیام‌های دریافت‌شده در این بازه به تفکیک تاپیک — برای بررسی اینکه AI با چی کار می‌کرده"
              >
                👀 نمایش پیام‌ها به تفکیک تاپیک
              </button>
              <a
                href={`/api/groups/${chatId}/members?format=csv`}
                download={`group-${chatId}-members.csv`}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                title="فایل CSV با ID عددی، @username و اسم همه افرادی که توی این گروه پیام دادن"
              >
                👥 خروجی اعضا (CSV)
              </a>
              <button
                onClick={async () => {
                  if (
                    !confirm(
                      "همه گزارش‌های کش‌شده این گروه (همه بازه‌ها) پاک بشن؟ گزارش بعدی از اول ساخته می‌شه.",
                    )
                  )
                    return;
                  await fetch(`/api/groups/${chatId}/analytics`, {
                    method: "DELETE",
                  });
                  load(days, true);
                }}
                disabled={running}
                className="text-xs px-3 py-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                title="پاک کردن همه گزارش‌های کش‌شده تا گزارش بعدی از صفر ساخته بشه"
              >
                🗑 پاکسازی گزارش‌ها
              </button>
              <Link
                href="/groups"
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                ← گروه‌ها
              </Link>
            </div>
          }
        />

        <Card className="mb-4">
          <p className="text-[11px] text-[var(--color-text-dim)]">
            لینکِ اشتراک‌گذاری عمومی و فرکانسِ خلاصه‌سازیِ این گروه از{" "}
            <Link href="/groups" className="text-[var(--color-accent)] underline">
              صفحه‌ی گروه‌ها
            </Link>{" "}
            تنظیم می‌شود.
          </p>
        </Card>

        {err && (
          <Card className="mb-4 border-red-800">
            <p className="text-sm text-red-300">{err}</p>
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
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">
              هیچ پیامی در این بازه پیدا نشد.
            </p>
          </Card>
        )}

        {data?.analysis && (
          <>
            {data.cached && data.cachedAt && (
              <div className="text-[11px] text-[var(--color-text-dim)] mb-2">
                💾 از کش: {new Date(data.cachedAt).toLocaleString()} (برای داده‌ی تازه‌تر «پردازش مجدد» رو بزن)
              </div>
            )}
            {data.analysis.tasks.length === 0 && data.messageCount > 0 && (
              <EmptyAnalysisBanner
                messageCount={data.messageCount}
                debug={data.analysis.debug}
                running={running}
                onReprocess={() => load(days, true)}
                onClear={async () => {
                  await fetch(`/api/groups/${chatId}/analytics`, {
                    method: "DELETE",
                  });
                  load(days, true);
                }}
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
              await fetch(`/api/groups/${chatId}/analytics`, {
                method: "DELETE",
              });
              load(days, true);
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
      <p className="text-xs text-amber-200 mb-1">
        ⚠️ {messageCount} پیام پردازش شد ولی AI هیچ تسکی استخراج نکرد.
      </p>
      {statusHint && (
        <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
          {statusHint}
        </p>
      )}
      <div className="flex gap-2 flex-wrap mb-2">
        <button
          onClick={onReprocess}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/50 text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {running ? "..." : "↻ پردازش مجدد"}
        </button>
        <button
          onClick={onClear}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/40 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
        >
          🗑 پاک کن و از نو
        </button>
        {debug?.rawResponse && (
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            {showRaw ? "بستن" : "🔧 پاسخ خام AI"}
          </button>
        )}
      </div>
      {showRaw && debug?.rawResponse && (
        <pre
          dir="ltr"
          className="text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-80"
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
  }, [chatId, days, showArchived]);

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
      className="fixed inset-0 bg-black/70 flex items-stretch justify-center z-50 p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl w-full max-w-3xl my-4 flex flex-col max-h-[95vh]"
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--color-border)]">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold mb-1">
              📨 پیام‌های دریافت‌شده به تفکیک تاپیک
            </h2>
            <p className="text-[11px] text-[var(--color-text-dim)]">
              {days === 0 ? "از ابتدا" : `${days} روز اخیر`} · {totalMessages}{" "}
              پیام · {topics.length} تاپیک
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-2 border-b border-[var(--color-border)] flex flex-wrap gap-2 items-center">
          <button
            onClick={expandAll}
            disabled={topics.length === 0}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            باز کن همه
          </button>
          <button
            onClick={collapseAll}
            disabled={topics.length === 0}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            ببند همه
          </button>
          <label className="text-[11px] flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-2)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            آرشیوشده‌ها
            {archivedHidden > 0 && !showArchived && (
              <span className="text-[var(--color-text-dim)]">
                ({archivedHidden})
              </span>
            )}
          </label>
          <div className="flex-1" />
          <button
            onClick={onAnalyze}
            disabled={running || totalMessages === 0}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
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
            <p className="text-sm text-red-300 text-center py-6">{err}</p>
          )}
          {!loading && !err && topics.length === 0 && (
            <p className="text-sm text-[var(--color-text-dim)] text-center py-6">
              هیچ پیامی توی این بازه ثبت نشده.
            </p>
          )}
          {topics.some((t) => t.name.startsWith("Topic #")) && (
            <div className="mb-3 p-2 rounded-md bg-amber-500/5 border border-amber-500/30 text-[11px] text-amber-200">
              ⚠️ بعضی تاپیک‌ها به اسم «Topic #N» نشون داده می‌شن چون ربات
              موقع ساخته شدنشون توی گروه نبود (Telegram Bot API امکان
              fetch retroactive تاپیک‌ها رو نمی‌ده). روی اسم هر تاپیک
              کلیک کن تا اسم واقعی‌اش رو دستی بزنی — یا توی تلگرام تاپیک
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
                className={`mb-2 border rounded-md overflow-hidden ${
                  t.archived
                    ? "border-[var(--color-border)] opacity-50"
                    : "border-[var(--color-border)]"
                }`}
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)]">
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
                  <button
                    onClick={() => toggle(k)}
                    className="text-[10px] text-[var(--color-text-dim)] shrink-0 hover:text-white"
                  >
                    {t.messages.length} پیام {open ? "▾" : "▸"}
                  </button>
                </div>
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
                  <p className="text-[11px] text-[var(--color-text-dim)] p-3">
                    این تاپیک توی این بازه پیامی نداشت.
                  </p>
                )}
                {open && t.messages.length > 0 && (
                  <ul className="flex flex-col gap-1 p-2">
                    {t.messages.map((m, i) => (
                      <li
                        key={i}
                        className={`text-[12px] rounded-md px-2 py-1.5 ${
                          m.fromOwner
                            ? "bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40"
                            : "bg-[var(--color-surface-2)] border border-[var(--color-border)]"
                        }`}
                      >
                        <div className="text-[10px] text-[var(--color-text-dim)] mb-0.5">
                          {m.fromOwner ? "شما" : m.sender} ·{" "}
                          {new Date(m.at).toLocaleString()}
                        </div>
                        <div
                          dir="auto"
                          style={{
                            unicodeBidi: "plaintext",
                            textAlign: "start",
                          }}
                          className="whitespace-pre-wrap break-words"
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
  // bot API doesn't expose a rename hook for it. Show it read-only.
  if (threadId == null) {
    return (
      <span className="text-sm font-medium truncate flex-1">
        🧵 {initialName}
      </span>
    );
  }

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
      <div className="flex-1 flex items-center gap-1 min-w-0">
        <input
          autoFocus
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
          className="flex-1 min-w-0 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1"
        />
        <button
          onClick={save}
          disabled={saving}
          className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {saving ? "..." : "ذخیره"}
        </button>
        <button
          onClick={() => {
            setValue(initialName);
            setEditing(false);
            setErr(null);
          }}
          disabled={saving}
          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)]"
        >
          لغو
        </button>
        {err && <span className="text-[10px] text-red-300 ml-2">{err}</span>}
      </div>
    );
  }
  return (
    <div className="flex-1 flex items-center gap-1 min-w-0">
      <button
        onClick={() => setEditing(true)}
        className={`flex-1 min-w-0 flex items-center gap-1.5 text-sm font-medium text-right hover:text-amber-200 ${
          archived ? "line-through opacity-60" : ""
        }`}
        title="ویرایش نام تاپیک"
      >
        <span className="truncate">🧵 {initialName}</span>
        <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-dim)]">
          ✎ ویرایش
        </span>
      </button>
      {archived ? (
        <button
          onClick={() => archive(false)}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded-md text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 shrink-0"
          title="از آرشیو دربیار — دوباره توی تحلیل میاد"
        >
          ↩ بازگردانی
        </button>
      ) : (
        <button
          onClick={() => archive(true)}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded-md text-[var(--color-text-dim)] hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"
          title="این تاپیک رو آرشیو کن — از تحلیل و این نمایش حذف می‌شه"
        >
          🗑 آرشیو
        </button>
      )}
      {err && (
        <span className="text-[10px] text-red-300 shrink-0">{err}</span>
      )}
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
          className="text-[11px] text-[var(--color-text-dim)] hover:text-amber-200"
          title="یه توضیح کوتاه بنویس تا AI موقع تحلیل این تاپیک متن رو بهتر بفهمه"
        >
          📝 شرح این تاپیک رو بنویس <span className="opacity-50">(کمک‌کننده برای AI)</span>
        </button>
      </div>
    );
  }
  if (!editing && initialNotes) {
    return (
      <div className="px-3 py-2 border-b border-[var(--color-border)] bg-amber-500/5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-amber-200/70 mb-1">
              📝 شرح برای AI:
            </div>
            <p
              dir="auto"
              style={{ unicodeBidi: "plaintext", textAlign: "start" }}
              className="text-[12px] whitespace-pre-wrap break-words"
            >
              {initialNotes}
            </p>
          </div>
          <button
            onClick={() => {
              setValue(initialNotes);
              setEditing(true);
            }}
            className="text-[10px] px-1.5 py-0.5 rounded-md text-[var(--color-text-dim)] hover:text-amber-200 shrink-0"
          >
            ✎ ویرایش
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="px-3 py-2 border-b border-[var(--color-border)] bg-amber-500/5">
      <div className="text-[10px] text-amber-200/70 mb-1">
        📝 شرح برای AI — مثلاً «این تاپیک فقط برای bug report هست» یا
        «هر پیام مشتری توی این تاپیک یک سفارش جدید است»
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        rows={3}
        dir="auto"
        style={{ unicodeBidi: "plaintext", textAlign: "start" }}
        className="w-full text-[12px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
      />
      <div className="flex items-center gap-1.5 mt-1.5">
        <button
          onClick={save}
          disabled={saving}
          className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {saving ? "..." : "ذخیره"}
        </button>
        <button
          onClick={() => {
            setValue(initialNotes ?? "");
            setEditing(false);
            setErr(null);
          }}
          disabled={saving}
          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)]"
        >
          لغو
        </button>
        {err && <span className="text-[10px] text-red-300">{err}</span>}
      </div>
    </div>
  );
}
