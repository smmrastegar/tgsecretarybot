import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { dueMonitoredAccounts, hasDb } from "@/lib/db";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";
import { HikerOutOfCreditsError } from "@/lib/hikerapi";
import { HikerApprovalNeededError } from "@/lib/hikerapi-budget";
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
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  if (!config.hikerApiKey) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured" },
      { status: 503 },
    );
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

  const due = await dueMonitoredAccounts(30);
  const bot = getBot();
  let checked = 0;
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];

  for (const acc of due) {
    checked++;
    try {
      const result = await processAccount({ account: acc, target, bot });
      detected += result.detected;
      forwarded += result.forwarded;
      errors.push(...result.errors);
    } catch (err) {
      if (err instanceof HikerOutOfCreditsError) {
        // Don't stamp every remaining account with the same 402 —
        // bail out and let the next cron pick up where we left off
        // once the operator tops up.
        return NextResponse.json({
          ok: false,
          checked,
          detected,
          forwarded,
          errors: [`HikerAPI out of credits: ${err.message}`],
          billingUrl: err.billingUrl,
        }, { status: 402 });
      }
      if (err instanceof HikerApprovalNeededError) {
        // Same logic — once we hit the local approval ceiling, every
        // remaining account would just throw the same thing. Stop
        // and surface the state so the UI flips into "approve next
        // $10" mode.
        return NextResponse.json({
          ok: false,
          approvalNeeded: true,
          checked,
          detected,
          forwarded,
          errors: [err.message],
          spentUsd: err.spentUsd,
          approvedUsd: err.approvedUsd,
          nextThresholdUsd: err.nextThresholdUsd,
          budgetUsd: err.budgetUsd,
          reason: err.reason,
        }, { status: 402 });
      }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${acc.username}: ${msg.slice(0, 200)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    checked,
    detected,
    forwarded,
    target: target.chatId,
    errors: errors.slice(0, 20),
  });
}
