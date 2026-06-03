import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { invalidateBudgetCache } from "@/lib/hikerapi-budget";
import { requireAdmin, resetTenantSpend } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wipe local cost log for a tenant. Used after an out-of-band
// top-up or to give a fresh ledger.
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
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const deleted = await resetTenantSpend(n);
  invalidateBudgetCache(n);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.tenant_reset_spend",
    target: String(n),
    details: { deleted },
  });
  return NextResponse.json({ ok: true, deleted });
}
