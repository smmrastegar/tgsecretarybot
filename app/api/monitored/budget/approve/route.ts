import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import {
  approveTenantBudget,
  getBudgetState,
} from "@/lib/hikerapi-budget";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {} → approve next $stepUsd slice for the caller's tenant.
// POST {approvedUsd, budgetUsd, stepUsd, extendBudget} → fine-grained
// control. The tenant.hiker_* columns are the source of truth — the
// global settings table no longer carries these.
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
    approvedUsd?: number;
    budgetUsd?: number;
    stepUsd?: number;
    extendBudget?: boolean;
  };
  const before = await getBudgetState(tenant.id);
  const updated = await approveTenantBudget({
    tenantId: tenant.id,
    approvedUsd: body.approvedUsd,
    budgetUsd: body.budgetUsd,
    stepUsd: body.stepUsd,
    extendBudget: body.extendBudget,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "hiker.budget_approve",
    details: {
      tenantId: tenant.id,
      previousApprovedUsd: before.approvedUsd,
      newApprovedUsd: updated?.hikerApprovedUsd,
      previousBudgetUsd: before.budgetUsd,
      newBudgetUsd: updated?.hikerBudgetUsd,
      stepUsd: updated?.hikerApprovalStepUsd,
      spentUsd: before.spentUsd,
      extended: body.extendBudget === true,
    },
  });
  return NextResponse.json({
    ok: true,
    state: await getBudgetState(tenant.id),
  });
}
