import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { invalidateBudgetCache } from "@/lib/hikerapi-budget";
import {
  applyPlanToTenant,
  PLAN_PRESETS,
  requireAdmin,
} from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const body = (await request.json().catch(() => ({}))) as { plan?: string };
  const planKey = (body.plan ?? "").trim();
  if (!planKey) {
    return NextResponse.json(
      {
        error: "plan required",
        available: PLAN_PRESETS.map((p) => p.key),
      },
      { status: 400 },
    );
  }
  const updated = await applyPlanToTenant(n, planKey);
  invalidateBudgetCache(n);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.tenant_apply_plan",
    target: String(n),
    details: { plan: planKey },
  });
  return NextResponse.json({ ok: true, tenant: updated });
}

export async function GET(): Promise<NextResponse> {
  // Public list of preset plans — used by the admin UI for the dropdown.
  return NextResponse.json({ ok: true, presets: PLAN_PRESETS });
}
