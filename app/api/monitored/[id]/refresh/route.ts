import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import { config } from "@/lib/config";
import { audit, getMonitoredAccount } from "@/lib/db";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On-demand "fetch now" for a single account. Re-runs the same
// pipeline the cron uses (respecting the per-account check_*
// flags) and grabs the most recent 3 posts / 3 reels on top of
// whatever stories are live. Used by the 🔄 button on /monitored.
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!config.hikerApiKey) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured" },
      { status: 503 },
    );
  }
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const account = await getMonitoredAccount(n);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  const target = await resolveTargetChat();
  if (!target) {
    return NextResponse.json(
      {
        error:
          "No chat tagged as 'storage' or 'downloader'. Set one on /chats/[id] → Function role.",
      },
      { status: 412 },
    );
  }
  const result = await processAccount({
    account,
    target,
    bot: getBot(),
    postsLimit: 3,
    reelsLimit: 3,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.refresh",
    target: String(n),
    details: {
      detected: result.detected,
      forwarded: result.forwarded,
      errorCount: result.errors.length,
    },
  });
  return NextResponse.json({
    ok: true,
    detected: result.detected,
    forwarded: result.forwarded,
    errors: result.errors.slice(0, 5),
  });
}
