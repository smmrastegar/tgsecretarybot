import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  bulkDeleteMonitoredAccounts,
  bulkUpdateMonitoredAccounts,
} from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
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
  const body = (await request.json().catch(() => ({}))) as {
    op?: "update" | "delete";
    ids?: number[];
    patch?: {
      enabled?: boolean;
      checkStories?: boolean;
      checkPosts?: boolean;
      checkReels?: boolean;
      checkProfile?: boolean;
      checkMentioned?: boolean;
      intervalMinutes?: number;
      resetError?: boolean;
    };
  };
  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n) => Number.isFinite(n))
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids[] required" }, { status: 400 });
  }
  let affected = 0;
  if (body.op === "delete") {
    affected = await bulkDeleteMonitoredAccounts(ids, tenant.id);
  } else {
    const patch = body.patch ?? {};
    if (patch.intervalMinutes !== undefined) {
      patch.intervalMinutes = Math.max(
        5,
        Math.min(Number(patch.intervalMinutes), 24 * 60),
      );
    }
    affected = await bulkUpdateMonitoredAccounts(ids, patch, tenant.id);
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: `monitor.bulk_${body.op ?? "update"}`,
    details: {
      tenantId: tenant.id,
      count: ids.length,
      affected,
      patch: body.patch,
    },
  });
  return NextResponse.json({ ok: true, affected });
}
