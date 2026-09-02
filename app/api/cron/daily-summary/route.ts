import { NextResponse } from "next/server";
import { reportError, reportWarn } from "@/lib/report";
import { config } from "@/lib/config";
import { getCurrentSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import {
  audit,
  getChatRule,
  groupActivityForPeriod,
  hasDb,
  markChatSummaryRun,
  upsertGroupSummary,
} from "@/lib/db";
import { summarizeGroup } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_INTERVAL_HOURS = 24;

async function authorized(request: Request): Promise<boolean> {
  // Logged-in operators hitting this from the /groups dashboard
  // shouldn't need the cron secret. Middleware exempts /api/cron
  // wholesale (so the actual cron can hit it without a session), so
  // we check the session ourselves here as an alternative path.
  const session = await getCurrentSession().catch(() => null);
  if (session) return true;
  const secret = config.cronSecret;
  if (!secret) return false; // fail closed: unset secret = locked, not open
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}

async function run(request: Request): Promise<NextResponse> {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const s = await getSettings();
  if (s.groupAnalysisEnabled.toLowerCase() === "false") {
    return NextResponse.json({ skipped: "group analysis disabled" });
  }
  const url = new URL(request.url);
  // `force=1` (used by the dashboard "Summarize now" button) processes
  // every chat with a forced lookback window — ignores per-chat
  // intervals and the "ran recently" gate.
  const force = url.searchParams.get("force") === "1";
  // When force-mode, allow ?hours=N to override the lookback. In normal
  // cron-driven mode the per-chat summary_interval_hours wins.
  const forcedHours = force
    ? Math.min(Math.max(Number(url.searchParams.get("hours") ?? "24"), 1), 168)
    : null;

  // Widest possible end-of-window — we pull messages for the maximum
  // interval anyone could have set, then per-chat trim the slice
  // before summarising.
  const end = new Date();
  const MAX_INTERVAL_HOURS = 168; // a week
  const widestStart = new Date(
    end.getTime() - MAX_INTERVAL_HOURS * 3600_000,
  );
  // Optional single-chat scope, for the per-group "summarise now" button.
  // Without it the dashboard could only ever run every group at once,
  // which is slow and burns tokens on groups nobody asked about.
  const onlyRaw = url.searchParams.get("chat_id");
  const onlyChatId = onlyRaw ? Number(onlyRaw) : null;
  const allActivities = await groupActivityForPeriod({
    start: widestStart,
    end,
  });
  const activities =
    onlyChatId != null && Number.isFinite(onlyChatId)
      ? allActivities.filter((a) => a.chatId === onlyChatId)
      : allActivities;
  let summarized = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  for (const a of activities) {
    if (a.messages.length < 3) {
      skipped++;
      skipReasons.thin = (skipReasons.thin ?? 0) + 1;
      continue;
    }
    try {
      const rule = await getChatRule(a.chatId).catch(() => null);
      const intervalHours =
        forcedHours ??
        rule?.summaryIntervalHours ??
        DEFAULT_INTERVAL_HOURS;
      const start = new Date(end.getTime() - intervalHours * 3600_000);
      const lastRun = rule?.lastSummaryRunAt ?? null;
      // Skip per-chat if the previous run is newer than the interval
      // and we're not in force mode. Compare against ~90% of the
      // interval so an hour-scale cron that fires a few seconds late
      // still triggers on schedule.
      if (!force && lastRun) {
        const elapsedMs = end.getTime() - lastRun.getTime();
        const requiredMs = intervalHours * 3600_000 * 0.9;
        if (elapsedMs < requiredMs) {
          skipped++;
          skipReasons.not_due = (skipReasons.not_due ?? 0) + 1;
          continue;
        }
      }
      const windowMsgs = a.messages.filter(
        (m) => m.at.getTime() >= start.getTime(),
      );
      if (windowMsgs.length < 3) {
        skipped++;
        skipReasons.thin_window = (skipReasons.thin_window ?? 0) + 1;
        continue;
      }
      const summary = await summarizeGroup({
        chatTitle: a.chatTitle,
        ownerName: s.ownerName,
        ownerContext: s.ownerContext,
        chatNotes: rule?.notes ?? null,
        outputLanguage: "Persian (فارسی)",
        messages: windowMsgs,
      });
      const senders = new Set(windowMsgs.map((m) => m.sender));
      await upsertGroupSummary({
        chatId: a.chatId,
        chatTitle: a.chatTitle,
        businessConnectionId: a.businessConnectionId,
        periodStart: start,
        periodEnd: end,
        messageCount: windowMsgs.length,
        activeSenders: senders.size,
        summary: summary.summary,
        topics: summary.topics,
        actionItems: summary.actionItems,
        mentionsOwner: summary.mentionsOwner,
      });
      await markChatSummaryRun(a.chatId).catch(() => {});
      summarized++;
    } catch (err) {
      reportError("cron:daily-summary", `[summary] chat=${a.chatId} failed:`, err);
    }
  }
  await audit({
    actorId: null,
    actorName: "cron",
    action: "groups.summary",
    details: { summarized, skipped, force, skipReasons },
  });
  return NextResponse.json({
    ok: true,
    summarized,
    skipped,
    skipReasons,
    chats: activities.length,
    force,
  });
}
