import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import {
  audit,
  groupActivityForPeriod,
  hasDb,
  upsertGroupSummary,
} from "@/lib/db";
import { summarizeGroup } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return true;
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
  if (!authorized(request)) {
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
  const hoursBack = Math.min(
    Math.max(Number(url.searchParams.get("hours") ?? "24"), 1),
    168,
  );
  const end = new Date();
  const start = new Date(end.getTime() - hoursBack * 3600_000);

  const activities = await groupActivityForPeriod({ start, end });
  let summarized = 0;
  let skipped = 0;
  for (const a of activities) {
    if (a.messages.length < 3) {
      skipped++;
      continue;
    }
    try {
      const summary = await summarizeGroup({
        chatTitle: a.chatTitle,
        ownerName: s.ownerName,
        ownerContext: s.ownerContext,
        messages: a.messages,
      });
      const senders = new Set(a.messages.map((m) => m.sender));
      await upsertGroupSummary({
        chatId: a.chatId,
        chatTitle: a.chatTitle,
        businessConnectionId: a.businessConnectionId,
        periodStart: start,
        periodEnd: end,
        messageCount: a.messages.length,
        activeSenders: senders.size,
        summary: summary.summary,
        topics: summary.topics,
        actionItems: summary.actionItems,
        mentionsOwner: summary.mentionsOwner,
      });
      summarized++;
    } catch (err) {
      console.error(`[summary] chat=${a.chatId} failed:`, err);
    }
  }
  await audit({
    actorId: null,
    actorName: "cron",
    action: "groups.summary",
    details: { summarized, skipped, hoursBack },
  });
  return NextResponse.json({
    ok: true,
    summarized,
    skipped,
    chats: activities.length,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  });
}
