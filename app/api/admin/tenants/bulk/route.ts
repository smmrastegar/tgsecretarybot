import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { invalidateBudgetCache } from "@/lib/hikerapi-budget";
import {
  applyPlanToTenant,
  deleteTenant,
  getTenant,
  requireAdmin,
  resetTenantSpend,
  updateTenant,
} from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Op =
  | "enable"
  | "disable"
  | "delete"
  | "apply-plan"
  | "reset-spend";

export async function POST(request: Request): Promise<NextResponse> {
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
  const body = (await request.json().catch(() => ({}))) as {
    op?: Op;
    ids?: number[];
    plan?: string;
  };
  const op = body.op;
  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!op || ids.length === 0) {
    return NextResponse.json(
      { error: "op + ids[] required" },
      { status: 400 },
    );
  }
  let succeeded = 0;
  const errors: Array<{ id: number; error: string }> = [];
  for (const id of ids) {
    try {
      if (op === "enable") {
        await updateTenant(id, { isEnabled: true });
      } else if (op === "disable") {
        await updateTenant(id, { isEnabled: false });
      } else if (op === "delete") {
        const t = await getTenant(id);
        if (t?.name === "Default") {
          errors.push({ id, error: "can't delete Default" });
          continue;
        }
        await deleteTenant(id);
      } else if (op === "apply-plan") {
        if (!body.plan) {
          errors.push({ id, error: "plan required" });
          continue;
        }
        await applyPlanToTenant(id, body.plan);
        invalidateBudgetCache(id);
      } else if (op === "reset-spend") {
        await resetTenantSpend(id);
        invalidateBudgetCache(id);
      } else {
        errors.push({ id, error: `unknown op ${op}` });
        continue;
      }
      succeeded++;
    } catch (err) {
      errors.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: `admin.tenant_bulk_${op}`,
    details: {
      count: ids.length,
      succeeded,
      errors: errors.length,
      plan: body.plan,
    },
  });
  return NextResponse.json({
    ok: errors.length === 0,
    succeeded,
    errors,
  });
}
