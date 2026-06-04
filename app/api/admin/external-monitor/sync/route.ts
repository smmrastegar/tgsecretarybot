import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { syncAllAccounts } from "@/lib/external-monitor";
import { requireAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Admin-triggered full sync — pushes every enabled monitored
// username to the external service. Idempotent; safe to re-run.
export async function POST(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await syncAllAccounts();
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.external_monitor_sync",
    details: {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    },
  });
  return NextResponse.json({ ok: true, ...result });
}
