"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import GroupAnalyticsView, { type Analysis } from "@/components/GroupAnalyticsView";

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
  error?: string;
};

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: "۳ روز", days: 3 },
  { label: "۷ روز", days: 7 },
  { label: "۱۴ روز", days: 14 },
  { label: "۳۰ روز", days: 30 },
];

const INTERVAL_OPTIONS: Array<{ label: string; hours: number | null }> = [
  { label: "هر ۱ ساعت", hours: 1 },
  { label: "هر ۳ ساعت", hours: 3 },
  { label: "هر ۶ ساعت", hours: 6 },
  { label: "هر ۱۲ ساعت", hours: 12 },
  { label: "هر ۲۴ ساعت (پیش‌فرض)", hours: 24 },
  { label: "هر ۴۸ ساعت", hours: 48 },
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
  const [intervalHours, setIntervalHours] = useState<number | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

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
        if (j.shareToken !== undefined) setShareToken(j.shareToken);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [chatId],
  );

  const loadInterval = useCallback(async () => {
    const r = await fetch(`/api/groups/${chatId}/interval`);
    if (r.ok) {
      const j = (await r.json()) as { hours: number | null };
      setIntervalHours(j.hours);
    }
  }, [chatId]);

  const saveInterval = useCallback(
    async (hours: number | null) => {
      const r = await fetch(`/api/groups/${chatId}/interval`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      if (r.ok) setIntervalHours(hours);
    },
    [chatId],
  );

  const generateShare = useCallback(async () => {
    const r = await fetch(`/api/groups/${chatId}/share`, { method: "POST" });
    if (r.ok) {
      const j = (await r.json()) as { token: string };
      setShareToken(j.token);
    }
  }, [chatId]);

  const revokeShare = useCallback(async () => {
    if (!confirm("لینک عمومی فعلی پاک می‌شه و دسترسی کسی که لینک رو داشته قطع می‌شه. ادامه؟"))
      return;
    const r = await fetch(`/api/groups/${chatId}/share`, { method: "DELETE" });
    if (r.ok) setShareToken(null);
  }, [chatId]);

  useEffect(() => {
    if (Number.isFinite(chatId)) {
      load(days);
      loadInterval();
    }
  }, [chatId, days, load, loadInterval]);

  const shareUrl = shareToken
    ? `${origin}/share/groups/${shareToken}?days=${days}`
    : "";

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
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
                ← خلاصه‌ها
              </Link>
            </div>
          }
        />

        <Card className="mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium mb-1">⏱ فرکانس خلاصه‌سازی این گروه</div>
              <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
                cron هر ساعت اجرا می‌شه و فقط گروه‌هایی که زمان جدید رسیده پردازش می‌کنه.
              </p>
              <div className="flex gap-2 flex-wrap">
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.hours)}
                    onClick={() => saveInterval(opt.hours)}
                    className={`text-[11px] px-2.5 py-1 rounded-md border ${
                      (intervalHours ?? 24) === opt.hours
                        ? "bg-[var(--color-accent)] text-white border-transparent"
                        : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium mb-1">🔗 لینک اشتراک‌گذاری عمومی</div>
              <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
                هر کسی این لینک رو داشته باشه فقط می‌تونه گزارش رو ببینه (read-only).
              </p>
              {shareToken ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <code
                    dir="ltr"
                    className="flex-1 min-w-0 text-[10px] tabular-nums break-all bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
                  >
                    {shareUrl}
                  </code>
                  <button
                    onClick={copy}
                    className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white"
                  >
                    {copied ? "✓ کپی شد" : "📋 کپی"}
                  </button>
                  <button
                    onClick={revokeShare}
                    className="text-[11px] px-2 py-1 rounded-md border border-red-900/40 text-red-300 hover:bg-red-900/30"
                  >
                    🗑 لغو
                  </button>
                </div>
              ) : (
                <button
                  onClick={generateShare}
                  className="text-[11px] px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
                >
                  + ساخت لینک
                </button>
              )}
            </div>
          </div>
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
            />
          </>
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
