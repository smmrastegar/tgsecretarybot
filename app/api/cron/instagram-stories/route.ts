import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  dueMonitoredAccounts,
  hasDb,
  listChatsByFunction,
  markMonitoredChecked,
  markMonitorEventForwarded,
  recordMonitorEvent,
  type MonitoredAccount,
} from "@/lib/db";
import { detectInstagramStories } from "@/lib/instagram";
import { getBot } from "@/lib/bot";

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
    return NextResponse.json(
      { error: "DATABASE_URL not set" },
      { status: 500 },
    );
  }
  // Pick whichever chat the owner tagged as "downloader" — that's
  // the bot we'll forward story URLs to. We use the most recently
  // updated one if there are multiple.
  const downloaders = await listChatsByFunction("downloader");
  const downloader = downloaders[0] ?? null;

  // Poll the oldest 30 accounts whose last_checked_at is older than
  // 4 minutes (cron runs every 5 → small buffer to not double-check).
  const due = await dueMonitoredAccounts(4, 30);
  const bot = getBot();

  let checked = 0;
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];

  for (const acc of due) {
    checked++;
    let stories: Awaited<ReturnType<typeof detectInstagramStories>>;
    try {
      stories = await detectInstagramStories(acc.username);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${acc.username}: ${errMsg.slice(0, 200)}`);
      await markMonitoredChecked({ id: acc.id, error: errMsg.slice(0, 500) });
      continue;
    }

    let latestStoryAt: Date | null = null;
    for (const s of stories) {
      if (!latestStoryAt || s.takenAt > latestStoryAt) latestStoryAt = s.takenAt;
      const ev = await recordMonitorEvent({
        accountId: acc.id,
        storyId: s.id,
        storyUrl: s.url,
      });
      if (!ev) continue; // duplicate
      detected++;
      if (downloader && s.url) {
        try {
          const sent = await bot.api.sendMessage(downloader.chatId, s.url);
          await markMonitorEventForwarded({
            id: ev.id,
            chatId: downloader.chatId,
            messageId: sent.message_id,
          });
          forwarded++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push(`forward ${acc.username}: ${errMsg.slice(0, 200)}`);
        }
      }
    }

    await markMonitoredChecked({
      id: acc.id,
      lastStoryAt: latestStoryAt,
      error: null,
    });
  }

  return NextResponse.json({
    ok: true,
    checked,
    detected,
    forwarded,
    downloader: downloader ? downloader.chatId : null,
    errors: errors.slice(0, 20),
  });
}
