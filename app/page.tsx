import Shell from "@/components/Shell";
import { PageTitle } from "@/components/Card";
import HomeView from "@/components/home/HomeView";
import {
  aiUsageOverview,
  chatModeCounts,
  listBusinessConnections,
  listExtractedItems,
  listMessages,
  overviewStats,
  upcomingReminderCount,
} from "@/lib/db";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
      <HomeView
        stats={stats}
        latestUrgent={latestUrgent}
        latest={latest}
        ai={ai}
        connections={connections}
        modes={modes}
        reminders={reminders}
        dueCount={dueCount}
      />
    </Shell>
  );
}
