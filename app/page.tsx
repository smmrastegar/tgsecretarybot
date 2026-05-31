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
        title="Overview"
        subtitle="What's been happening in your chats."
      />

      {!stats && (
        <Card className="mb-6">
          <p className="text-sm text-amber-300">
            Database is not configured. Set DATABASE_URL to enable persistence
            and analytics.
          </p>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <StatCard
            label="Urgent unhandled"
            value={stats.urgentUnhandled}
            hint={`of ${stats.urgentTotal} total flagged`}
          />
          <StatCard
            label="Alerts (24h)"
            value={stats.alertsLast24h}
            hint="fired to webhook"
          />
          <StatCard
            label="Auto-replies (24h)"
            value={stats.autoRepliesLast24h}
          />
          <StatCard
            label="Connections"
            value={stats.connections}
            hint="business accounts"
          />
        </div>
      )}

      {ai && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <StatCard
            label="AI cost total"
            value={`$${ai.totalCostUsd.toFixed(4)}`}
            hint={`${ai.totalCalls} calls · ${(ai.totalTokens / 1000).toFixed(1)}k tokens`}
          />
          <StatCard
            label="AI cost (24h)"
            value={`$${ai.last24hCostUsd.toFixed(4)}`}
          />
        </div>
      )}

      {reminders.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
              Upcoming reminders ({dueCount})
            </div>
            <Link
              href="/reminders"
              className="text-xs text-[var(--color-text-dim)] hover:text-white"
            >
              See all →
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
                    : "no date"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modes && (
        <Card className="mb-6">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            Chats by mode
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <ModePill label="Secretary" count={modes.secretary} tone="warn" />
            <ModePill label="AI chat" count={modes.ai_chat} tone="success" />
            <ModePill
              label="Friendly AI"
              count={modes.friendly_reply}
              tone="info"
            />
            <ModePill
              label="Auto-reply"
              count={modes.auto_reply}
              tone="info"
            />
            <ModePill label="Off" count={modes.off} tone="neutral" />
          </div>
        </Card>
      )}

      {connections.length > 0 && (
        <Card className="mb-6">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
            Connected Telegram accounts
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
                    <span className="text-emerald-400">can reply ✓</span>
                  ) : (
                    <span className="text-amber-400">no reply right</span>
                  )}
                  {c.isEnabled ? (
                    <span className="text-emerald-400">active</span>
                  ) : (
                    <span className="text-[var(--color-text-dim)]">disabled</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-text-dim)] mt-3">
            Multiple Telegram users can connect this bot via Settings → Telegram
            Business → Chatbots. The bot keeps a separate session per account.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Latest urgent</h2>
            <Link
              href="/urgent"
              className="text-xs text-[var(--color-text-dim)] hover:text-white"
            >
              See all →
            </Link>
          </div>
          {latestUrgent.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">
              Nothing urgent yet.
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
                    <Badge tone="danger">imp {m.importance}</Badge>
                    {m.alerted && <Badge tone="warn">alerted</Badge>}
                    {m.autoReplied && <Badge tone="info">auto-replied</Badge>}
                    {m.handledAt && <Badge tone="success">handled</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Link
              href="/messages"
              className="text-xs text-[var(--color-text-dim)] hover:text-white"
            >
              See all →
            </Link>
          </div>
          {latest.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">
              No messages yet.
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
