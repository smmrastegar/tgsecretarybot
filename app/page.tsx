import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle, StatCard, Badge } from "@/components/Card";
import {
  aiUsageOverview,
  chatModeCounts,
  listBusinessConnections,
  listExtractedItems,
  listMessages,
  overviewStats,
  upcomingReminderCount,
} from "@/lib/db";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function ModePill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "success" | "warn" | "info" | "neutral";
}) {
  const toneCls = {
    success: "border-emerald-700 text-emerald-300",
    warn: "border-amber-700 text-amber-300",
    info: "border-blue-700 text-blue-300",
    neutral: "border-[var(--color-border)] text-[var(--color-text-dim)]",
  }[tone];
  return (
    <Link
      href="/chats"
      className={`flex flex-col items-center justify-center p-3 rounded-md border ${toneCls} hover:bg-[var(--color-surface-2)]`}
    >
      <span className="text-xl font-semibold">{count}</span>
      <span className="text-[11px] mt-1">{label}</span>
    </Link>
  );
}

export default async function OverviewPage() {
  await requireSession();
  const [stats, latestUrgent, latest, ai, connections, modes, reminders, dueCount] =
    await Promise.all([
      overviewStats().catch(() => null),
      listMessages({ urgentOnly: true, limit: 5 }).catch(() => []),
      listMessages({ limit: 8 }).catch(() => []),
      aiUsageOverview().catch(() => null),
      listBusinessConnections().catch(() => []),
      chatModeCounts().catch(() => null),
      listExtractedItems({ upcoming: true, limit: 4 }).catch(() => []),
      upcomingReminderCount().catch(() => 0),
    ]);

  return (
    <Shell>
      <PageTitle
        title="نمای کلی"
        subtitle="چه اتفاقاتی توی چت‌هات افتاده."
      />

      {!stats && (
        <Card className="mb-6">
          <p className="text-sm text-amber-300">
            دیتابیس پیکربندی نشده. برای فعال شدن ذخیره‌سازی و تحلیل‌ها،
            DATABASE_URL رو تنظیم کن.
          </p>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <StatCard
            label="فوری رسیدگی‌نشده"
            value={stats.urgentUnhandled}
            hint={`از ${stats.urgentTotal} علامت‌خورده`}
          />
          <StatCard
            label="هشدارها (۲۴ ساعت)"
            value={stats.alertsLast24h}
            hint="به webhook فرستاده شد"
          />
          <StatCard
            label="پاسخ‌های خودکار (۲۴ ساعت)"
            value={stats.autoRepliesLast24h}
          />
          <StatCard
            label="اتصال‌ها"
            value={stats.connections}
            hint="اکانت‌های business"
          />
        </div>
      )}

      {ai && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <StatCard
            label="هزینه کل AI"
            value={`$${ai.totalCostUsd.toFixed(4)}`}
            hint={`${ai.totalCalls} فراخوانی · ${(ai.totalTokens / 1000).toFixed(1)}k توکن`}
          />
          <StatCard
            label="هزینه AI (۲۴ ساعت)"
            value={`$${ai.last24hCostUsd.toFixed(4)}`}
          />
        </div>
      )}

      {reminders.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
              یادآوری‌های پیش‌رو ({dueCount})
            </div>
            <Link
              href="/reminders"
              className="text-xs text-[var(--color-text-dim)] hover:text-white"
            >
              دیدن همه →
            </Link>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {reminders.slice(0, 4).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 flex-wrap"
              >
                <span className="truncate">{r.title}</span>
                <span className="text-[11px] text-[var(--color-text-dim)] shrink-0">
                  {r.kind} ·{" "}
                  {r.dueAt
                    ? new Date(r.dueAt).toLocaleString()
                    : "بدون تاریخ"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modes && (
        <Card className="mb-6">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            چت‌ها بر اساس حالت
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <ModePill label="منشی" count={modes.secretary} tone="warn" />
            <ModePill label="چت AI" count={modes.ai_chat} tone="success" />
            <ModePill
              label="AI صمیمی"
              count={modes.friendly_reply}
              tone="info"
            />
            <ModePill
              label="پاسخ خودکار"
              count={modes.auto_reply}
              tone="info"
            />
            <ModePill label="خاموش" count={modes.off} tone="neutral" />
          </div>
        </Card>
      )}

      {connections.length > 0 && (
        <Card className="mb-6">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            اکانت‌های تلگرام وصل‌شده
          </div>
          <div className="flex flex-col gap-2">
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 text-sm flex-wrap"
              >
                <div className="min-w-0">
                  <span className="font-medium">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                      c.username ||
                      `user ${c.userId}`}
                  </span>
                  {c.username && (
                    <span className="text-xs text-[var(--color-text-dim)] ml-2">
                      @{c.username}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-text-dim)] ml-2">
                    id {c.userId}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  {c.canReply ? (
                    <span className="text-emerald-400">امکان پاسخ ✓</span>
                  ) : (
                    <span className="text-amber-400">بدون حق پاسخ</span>
                  )}
                  {c.isEnabled ? (
                    <span className="text-emerald-400">فعال</span>
                  ) : (
                    <span className="text-[var(--color-text-dim)]">غیرفعال</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-text-dim)] mt-3">
            چند کاربر تلگرام می‌تونن از طریق Settings → Telegram Business →
            Chatbots این ربات رو وصل کنن. ربات برای هر اکانت یه session جدا نگه
            می‌داره.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">آخرین موارد فوری</h2>
            <Link
              href="/urgent"
              className="text-xs text-[var(--color-text-dim)] hover:text-white"
            >
              دیدن همه →
            </Link>
          </div>
          {latestUrgent.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">
              هنوز چیز فوری‌ای نیست.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {latestUrgent.map((m) => (
                <li
                  key={m.id}
                  className="p-3 rounded-md bg-[var(--color-surface-2)]"
                >
                  <div className="flex items-center justify-between text-xs text-[var(--color-text-dim)] mb-1">
                    <span>
                      {m.senderName} · {chatTypeLabel(m.chatType)}
                      {m.chatTitle ? ` · ${m.chatTitle}` : ""}
                    </span>
                    <span>{relTime(m.createdAt)}</span>
                  </div>
                  <div className="text-sm">{truncate(m.messageText, 200)}</div>
                  <div className="mt-2 flex gap-2 items-center">
                    <Badge tone="danger">اهمیت {m.importance}</Badge>
                    {m.alerted && <Badge tone="warn">هشدار داده شد</Badge>}
                    {m.autoReplied && <Badge tone="info">پاسخ خودکار</Badge>}
                    {m.handledAt && <Badge tone="success">رسیدگی شد</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">فعالیت اخیر</h2>
            <Link
              href="/messages"
              className="text-xs text-[var(--color-text-dim)] hover:text-white"
            >
              دیدن همه →
            </Link>
          </div>
          {latest.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">
              هنوز پیامی نیست.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {latest.map((m) => (
                <li
                  key={m.id}
                  className="p-2 rounded-md hover:bg-[var(--color-surface-2)] text-sm"
                >
                  <div className="flex items-center justify-between text-xs text-[var(--color-text-dim)]">
                    <span>
                      {m.senderName} · {chatTypeLabel(m.chatType)}
                    </span>
                    <span>{relTime(m.createdAt)}</span>
                  </div>
                  <div className="mt-1">{truncate(m.messageText, 110)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
