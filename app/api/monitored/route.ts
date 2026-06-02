import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import { config } from "@/lib/config";
import {
  addMonitoredAccount,
  audit,
  listMonitoredAccounts,
  listRecentMonitorEvents,
} from "@/lib/db";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [accounts, events] = await Promise.all([
    listMonitoredAccounts({ platform: "instagram" }),
    listRecentMonitorEvents(100),
  ]);
  return NextResponse.json({ accounts, events });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
  };
  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username || !/^[a-z0-9._]+$/.test(username)) {
    return NextResponse.json(
      { error: "username invalid" },
      { status: 400 },
    );
  }
  const account = await addMonitoredAccount({
    platform: "instagram",
    username,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.add",
    target: account ? String(account.id) : null,
    details: { username },
  });
  // Immediate on-add fetch: pull the last 3 posts + current stories
  // (regardless of the per-account flags — owner expects to see
  // something right away to confirm the account is reachable). The
  // cron continues normal duty afterwards.
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];
  if (account && config.hikerApiKey) {
    const target = await resolveTargetChat();
    if (target) {
      try {
        const result = await processAccount({
          account,
          target,
          bot: getBot(),
          forceAllKinds: true,
          postsLimit: 3,
          reelsLimit: 0,
        });
        detected = result.detected;
        forwarded = result.forwarded;
        errors.push(...result.errors);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  return NextResponse.json({
    ok: true,
    account,
    detected,
    forwarded,
    errors: errors.slice(0, 5),
  });
}
