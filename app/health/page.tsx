"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import Section from "@/components/ui/Section";
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

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Controls are >= 40 px tall.
const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const btnPrimary = "min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50";

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
  const [webhookError, setWebhookError] = useState<string | null>(null);

  async function refreshWebhook() {
    setRefreshingWebhook(true);
    setWebhookError(null);
    try {
      const r = await fetch("/api/health/refresh-webhook", { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setWebhookError(`Refresh failed: ${j.error ?? r.status}`);
      }
    } catch (err) {
      setWebhookError(`Refresh failed: ${err instanceof Error ? err.message : err}`);
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
      // 503 is a valid "something is down" answer; anything without the checks block is a real failure.
      if (!j.checks) throw new Error(`HTTP ${r.status}`);
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

  const activity = data?.activity ?? {};
  const num = (v: unknown) => fa(String(v ?? 0));

  return (
    <Shell>
      <PageTitle
        title="سلامت"
        subtitle="وضعیت زنده‌ی همه‌ی وابستگی‌های خارجی. اگه ربات «یهو از کار افتاد»، معمولاً چراغ قرمز اینجاست."
        actions={
          <>
            <button onClick={load} disabled={loading} className={btnPrimary}>
              {loading ? "در حال بررسی…" : "بررسی دوباره"}
            </button>
            <button
              onClick={refreshWebhook}
              disabled={refreshingWebhook}
              className={btn}
              title="دوباره به همه‌ی نوع‌های update تلگرام subscribe کن (اگه رویدادهای حذف/ویرایش دریافت نمی‌شن از این استفاده کن)"
            >
              {refreshingWebhook ? "در حال رفرش…" : "ثبت دوباره‌ی webhook"}
            </button>
          </>
        }
      />

      {webhookError && (
        <Card className="mb-4 !border-red-800">
          <div className="text-sm text-red-300 break-all">{webhookError}</div>
        </Card>
      )}

      {error && (
        <Card className="mb-4 !border-red-800 !bg-red-900/20">
          <div className="text-red-300 text-sm font-medium mb-1">
            خود endpoint سلامت خطا داد
          </div>
          <div className="text-xs leading-6 text-[var(--color-text-dim)] break-all">
            {error}
          </div>
          <button onClick={load} disabled={loading} className={`${btn} mt-3`}>تلاش دوباره</button>
        </Card>
      )}

      {data && (
        <>
          <Card className="mb-4">
            <div className="flex items-center justify-center gap-3">
              <div
                aria-hidden
                className={`w-3.5 h-3.5 shrink-0 rounded-full ${
                  data.ok ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <div className="text-base font-semibold leading-7">
                {data.ok
                  ? "همه‌ی سیستم‌ها سالم"
                  : "یه چیزی خرابه — پایین رو ببین"}
              </div>
            </div>
            {lastChecked && (
              <div className="text-xs text-[var(--color-text-dim)] mt-1">
                آخرین بررسی {lastChecked.toLocaleTimeString()}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {Object.entries(data.checks).map(([key, c]) => (
              <Card key={key} className="!p-3">
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" dir="auto">
                    {CHECK_LABELS[key] ?? key}
                  </span>
                  <Badge tone={c.ok ? "success" : "danger"}>
                    {c.ok ? "سالم" : "خطا"}
                  </Badge>
                </div>
                {CHECK_HINT[key] && (
                  <div className="text-xs leading-6 text-[var(--color-text-dim)] mt-1">
                    {CHECK_HINT[key]}
                  </div>
                )}
                {c.detail && (
                  <div
                    className={`text-xs leading-6 mt-2 break-all ${
                      c.ok
                        ? "text-[var(--color-text-dim)]"
                        : "text-red-300"
                    }`}
                  >
                    {c.detail}
                  </div>
                )}
                <div className="text-xs text-[var(--color-text-dim)] mt-1 tabular-nums">
                  <span dir="ltr">{fa(c.ms)} ms</span>
                </div>
              </Card>
            ))}
          </div>

          {data.activity && Object.keys(data.activity).length > 0 && (
            <Card className="mb-4">
              <div className="text-sm font-medium mb-3">فعالیت اخیر</div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(
                  [
                    ["آخرین پیام ورودی", fmtTimestamp(activity.last_msg_at)],
                    ["آخرین call به AI", fmtTimestamp(activity.last_ai_at)],
                    ["پیام‌های ۱ ساعت اخیر", num(activity.msgs_1h)],
                    ["call‌های AI در ۱ ساعت اخیر", num(activity.ai_1h)],
                    ["هزینه AI در ۲۴ ساعت اخیر", <bdi key="c" dir="ltr">${Number(activity.ai_cost_24h ?? 0).toFixed(4)}</bdi>],
                    ["Updateهای ۱ ساعت اخیر", num(activity.updates_1h)],
                    ["business connectionهای فعال", num(activity.bcs_enabled)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-[var(--color-border)] px-3 py-2.5">
                    <dt className="text-xs text-[var(--color-text-dim)]">{label}</dt>
                    <dd className="text-sm font-medium mt-0.5 [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {data.updates && (
            <>
              <Card className="mb-3">
                <div className="text-sm font-medium mb-1">
                  Updateهای Telegram دریافت‌شده (۱ ساعت اخیر)
                </div>
                <div className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
                  اگه توی این لیست channel_post نیست ولی ربات توی یه کانال
                  هست، احتمالاً ربات اونجا administrator نیست. تلگرام
                  پست‌های کانال رو فقط به بات‌های ادمین می‌فرسته.
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {Object.keys(data.updates.byType).length === 0 ? (
                    <span className="text-sm text-[var(--color-text-dim)]">
                      هیچ update ای از Telegram توی یک ساعت اخیر نیست
                    </span>
                  ) : (
                    Object.entries(data.updates.byType).map(([t, n]) => (
                      <span
                        key={t}
                        className="text-xs px-3 py-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      >
                        <span dir="ltr">{t}</span>: <strong>{fa(n)}</strong>
                      </span>
                    ))
                  )}
                </div>
              </Card>
              {data.updates.recent.length > 0 && (
                <Section icon="🧾" title="آخرین ۵۰ update — برای دیباگ" summary={`${fa(data.updates.recent.length)} مورد`}>
                  <div className="-mx-4 -mb-4">
                    {data.updates.recent.map((u) => (
                      <div key={u.updateId} className="min-h-14 px-4 py-2 border-t first:border-t-0 border-[var(--color-border)]">
                        <div className="flex items-center justify-center gap-2 flex-wrap text-xs">
                          <span className="px-2 py-0.5 rounded-lg bg-[var(--color-surface-2)]">
                            {u.updateType ?? "(unknown)"}
                          </span>
                          <span className="text-[var(--color-text-dim)]">
                            {new Date(u.processedAt).toLocaleTimeString()}
                          </span>
                          {u.chatId != null && (
                            <span className="text-[var(--color-text-dim)]">chat {u.chatId}</span>
                          )}
                        </div>
                        {u.preview && (
                          <div dir="auto" className="mt-1 text-xs leading-6 line-clamp-2 [overflow-wrap:anywhere]">
                            {u.preview}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </>
      )}

      {loading && !data && !error && <Card>در حال بررسی…</Card>}
    </Shell>
  );
}
