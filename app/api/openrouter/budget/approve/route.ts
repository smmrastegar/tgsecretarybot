import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import {
  approveOpenrouterBudget,
  getOpenrouterBudgetState,
} from "@/lib/openrouter-budget";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {} → bump approved by stepUsd. POST {approvedUsd, budgetUsd,
// stepUsd, extendBudget} → fine-grained. Same shape as the HikerAPI
// approve endpoint so the UI logic carries over.
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
  const before = await getOpenrouterBudgetState(tenant.id);
  const updated = await approveOpenrouterBudget({
    tenantId: tenant.id,
    approvedUsd: body.approvedUsd,
    budgetUsd: body.budgetUsd,
    stepUsd: body.stepUsd,
    extendBudget: body.extendBudget,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "openrouter.budget_approve",
    details: {
      tenantId: tenant.id,
      previousApprovedUsd: before.approvedUsd,
      newApprovedUsd: updated?.openrouterApprovedUsd,
      previousBudgetUsd: before.budgetUsd,
      newBudgetUsd: updated?.openrouterBudgetUsd,
      stepUsd: updated?.openrouterApprovalStepUsd,
      spentUsd: before.spentUsd,
      extended: body.extendBudget === true,
    },
  });
  return NextResponse.json({
    ok: true,
    state: await getOpenrouterBudgetState(tenant.id),
  });
}
