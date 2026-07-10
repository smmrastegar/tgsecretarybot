"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type Check = { ok: boolean; detail?: string; ms: number };

type HealthResponse = {
  ok: boolean;
  checks: Record<string, Check>;
  activity: Record<string, string | number | null>;
  updates?: {
    total: number;
    byType: Record<string, number>;
    recent: Array<{
      updateId: number;
      updateType: string | null;
      chatId: number | null;
      preview: string | null;
      processedAt: string;
    }>;
  };
};

const CHECK_LABELS: Record<string, string> = {
  database: "Database (Neon)",
  telegram: "Telegram Bot API",
  openrouter: "OpenRouter (AI)",
  activity: "کوئری فعالیت DB",
};

const CHECK_HINT: Record<string, string> = {
  database: "اگه این قرمز باشه، هیچ‌چیز دیگه کار نمی‌کنه.",
  telegram: "اگه قرمز: BOT_TOKEN اشتباهه یا Telegram در دسترس نیست. ربات نمی‌تونه ارسال/دریافت کنه.",
  openrouter:
    "اگه قرمز: کلید AI نامعتبره یا اعتبار تمومه. AI suggest / Full AI / پاسخ خودکار دوستانه همه fail می‌شن.",
  activity: "شمارنده‌های message_log/ai_usage رو برای داشبوردهای پایین می‌خونه.",
};

function fmtTimestamp(v: unknown): string {
  if (!v) return "—";
  try {
    return `${relTime(String(v))} (${new Date(String(v)).toLocaleString()})`;
  } catch {
    return String(v);
  }
}

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [refreshingWebhook, setRefreshingWebhook] = useState(false);

  async function refreshWebhook() {
    setRefreshingWebhook(true);
    try {
      const r = await fetch("/api/health/refresh-webhook", { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`Refresh failed: ${j.error ?? r.status}`);
      }
    } catch (err) {
      alert(`Refresh failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRefreshingWebhook(false);
      await load();
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      const j = (await r.json()) as HealthResponse;
      setData(j);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell>
      <PageTitle
        title="سلامت"
        subtitle="وضعیت زنده‌ی همه‌ی وابستگی‌های خارجی. اگه ربات «یهو از کار افتاد»، معمولاً چراغ قرمز اینجاست."
        actions={
          <div className="flex gap-2">
            <button
              onClick={refreshWebhook}
              disabled={refreshingWebhook}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              title="دوباره به همه‌ی نوع‌های update تلگرام subscribe کن (اگه رویدادهای حذف/ویرایش دریافت نمی‌شن از این استفاده کن)"
            >
              {refreshingWebhook ? "در حال رفرش…" : "ثبت دوباره‌ی webhook"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {loading ? "در حال بررسی…" : "بررسی دوباره"}
            </button>
          </div>
        }
      />

      {error && (
        <Card className="mb-4 border-red-800">
          <div className="text-red-300 text-sm font-medium mb-1">
            خود endpoint سلامت خطا داد
          </div>
          <div className="text-xs text-[var(--color-text-dim)] break-all">
            {error}
          </div>
        </Card>
      )}

      {data && (
        <>
          <Card className="mb-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  data.ok ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {data.ok
                    ? "همه‌ی سیستم‌ها سالم"
                    : "یه چیزی خرابه — پایین رو ببین"}
                </div>
                {lastChecked && (
                  <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                    آخرین بررسی {lastChecked.toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            {Object.entries(data.checks).map(([key, c]) => (
              <Card key={key} className="!p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {CHECK_LABELS[key] ?? key}
                    </div>
                    {CHECK_HINT[key] && (
                      <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                        {CHECK_HINT[key]}
                      </div>
                    )}
                  </div>
                  <Badge tone={c.ok ? "success" : "danger"}>
                    {c.ok ? "سالم" : "خطا"}
                  </Badge>
                </div>
                {c.detail && (
                  <div
                    className={`text-xs mt-2 break-all ${
                      c.ok
                        ? "text-[var(--color-text-dim)]"
                        : "text-red-300"
                    }`}
                  >
                    {c.detail}
                  </div>
                )}
                <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                  {c.ms} ms
                </div>
              </Card>
            ))}
          </div>

          {data.activity && Object.keys(data.activity).length > 0 && (
            <Card>
              <div className="text-sm font-medium mb-3">فعالیت اخیر</div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    آخرین پیام ورودی
                  </dt>
                  <dd>{fmtTimestamp(data.activity.last_msg_at)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">آخرین call به AI</dt>
                  <dd>{fmtTimestamp(data.activity.last_ai_at)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Messages last 1h
                  </dt>
                  <dd>{data.activity.msgs_1h ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    AI calls last 1h
                  </dt>
                  <dd>{data.activity.ai_1h ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    AI cost last 24h
                  </dt>
                  <dd>
                    ${Number(data.activity.ai_cost_24h ?? 0).toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Updates last 1h
                  </dt>
                  <dd>{data.activity.updates_1h ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-dim)]">
                    Active business connections
                  </dt>
                  <dd>{data.activity.bcs_enabled ?? 0}</dd>
                </div>
              </dl>
            </Card>
          )}

          {data.updates && (
            <Card className="mt-4">
              <div className="text-sm font-medium mb-1">
                Telegram updates received (last 1h)
              </div>
              <div className="text-[11px] text-[var(--color-text-dim)] mb-3">
                If this list doesn&apos;t include channel_post but the bot
                IS in a channel, the bot probably isn&apos;t an
                administrator there. Telegram only delivers channel
                posts to admin bots.
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {Object.keys(data.updates.byType).length === 0 ? (
                  <span className="text-xs text-[var(--color-text-dim)]">
                    no Telegram updates in the last hour
                  </span>
                ) : (
                  Object.entries(data.updates.byType).map(([t, n]) => (
                    <span
                      key={t}
                      className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                    >
                      {t}: <strong>{n}</strong>
                    </span>
                  ))
                )}
              </div>
              {data.updates.recent.length > 0 && (
                <details>
                  <summary className="text-[11px] text-[var(--color-text-dim)] cursor-pointer">
                    آخرین ۵۰ update — برای دیباگ
                  </summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {data.updates.recent.map((u) => (
                      <div
                        key={u.updateId}
                        className="text-[11px] flex items-center gap-2 flex-wrap p-1.5 border border-[var(--color-border)] rounded-md"
                      >
                        <span className="text-[var(--color-text-dim)]">
                          {new Date(u.processedAt).toLocaleTimeString()}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-2)]">
                          {u.updateType ?? "(unknown)"}
                        </span>
                        {u.chatId != null && (
                          <span className="text-[var(--color-text-dim)]">
                            chat {u.chatId}
                          </span>
                        )}
                        {u.preview && (
                          <span
                            dir="auto"
                            className="truncate min-w-0 flex-1"
                          >
                            {u.preview}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          )}
        </>
      )}

      {loading && !data && <Card>Checking…</Card>}
    </Shell>
  );
}
