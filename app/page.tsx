import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle, StatCard, Badge } from "@/components/Card";
import { listMessages, overviewStats } from "@/lib/db";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireSession();
  const [stats, latestUrgent, latest] = await Promise.all([
    overviewStats().catch(() => null),
    listMessages({ urgentOnly: true, limit: 5 }).catch(() => []),
    listMessages({ limit: 8 }).catch(() => []),
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
