import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import {
  attachBusinessConnectionToTenant,
  requireAdmin,
} from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH {tenantId: number} → move this business_connection to the
// given tenant. Used by the /admin "Connections" tab to migrate
// owners between workspaces.
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    tenantId?: number;
  };
  const tenantId = Number(body.tenantId);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }
  await attachBusinessConnectionToTenant({
    businessConnectionId: id,
    tenantId,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.connection_reassign",
    target: id,
    details: { tenantId },
  });
  return NextResponse.json({ ok: true });
}
