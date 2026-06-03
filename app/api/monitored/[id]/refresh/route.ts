import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import { audit, getMonitoredAccount } from "@/lib/db";
import { getActiveKey, HikerOutOfCreditsError } from "@/lib/hikerapi";
import { HikerApprovalNeededError } from "@/lib/hikerapi-budget";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";
import { requireTenant } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  const { key } = await getActiveKey();
  if (!key) {
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
  const account = await getMonitoredAccount(n, tenant.id);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    stories?: boolean;
    posts?: boolean;
    reels?: boolean;
    mentioned?: boolean;
    countStories?: number;
    countPosts?: number;
    countReels?: number;
    countMentioned?: number;
  };
  const hasExplicit =
    body.stories !== undefined ||
    body.posts !== undefined ||
    body.reels !== undefined ||
    body.mentioned !== undefined;
  const clamp = (n: unknown, def = 3) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.max(1, Math.min(20, Math.round(v)));
  };

  return runWithTenant(tenant.id, async () => {
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
    let result;
    try {
      result = await processAccount({
        account,
        target,
        bot: getBot(),
        kindOverrides: hasExplicit
          ? {
              story: Boolean(body.stories),
              post: Boolean(body.posts),
              reel: Boolean(body.reels),
              mentioned: Boolean(body.mentioned),
            }
          : undefined,
        storiesLimit: clamp(body.countStories),
        postsLimit: clamp(body.countPosts),
        reelsLimit: clamp(body.countReels),
        mentionedLimit: clamp(body.countMentioned),
      });
    } catch (err) {
      if (err instanceof HikerOutOfCreditsError) {
        return NextResponse.json(
          {
            ok: false,
            outOfCredits: true,
            error: `HikerAPI out of credits: ${err.message}`,
            billingUrl: err.billingUrl,
          },
          { status: 402 },
        );
      }
      if (err instanceof HikerApprovalNeededError) {
        return NextResponse.json(
          {
            ok: false,
            approvalNeeded: true,
            error: err.message,
            spentUsd: err.spentUsd,
            approvedUsd: err.approvedUsd,
            nextThresholdUsd: err.nextThresholdUsd,
            budgetUsd: err.budgetUsd,
            reason: err.reason,
          },
          { status: 402 },
        );
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "monitor.refresh",
      target: String(n),
      details: {
        tenantId: tenant.id,
        detected: result.detected,
        forwarded: result.forwarded,
        errorCount: result.errors.length,
        kinds: body,
      },
    });
    return NextResponse.json({
      ok: true,
      detected: result.detected,
      forwarded: result.forwarded,
      errors: result.errors.slice(0, 5),
    });
  });
}
