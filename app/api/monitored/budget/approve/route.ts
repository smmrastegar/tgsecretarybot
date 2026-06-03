import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import {
  getBudgetState,
  invalidateBudgetCache,
} from "@/lib/hikerapi-budget";
import { updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {} → approve the next $stepUsd slice (capped at budget).
// POST {approvedUsd: <abs>} → set the approved-up-to value directly.
// POST {extendBudget: true} → if the next step would exceed the
//   absolute budget cap, raise the cap by stepUsd (or by however
//   much is needed to fit `approvedUsd` if also passed). Lets the
//   owner roll over from $50 → $60 → … without leaving the page.
// POST {budgetUsd: <abs>} → raise/lower the cap directly.
export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    approvedUsd?: number;
    budgetUsd?: number;
    extendBudget?: boolean;
  };
  const state = await getBudgetState();
  let nextBudget = state.budgetUsd;
  let nextApproved: number;

  if (typeof body.budgetUsd === "number" && Number.isFinite(body.budgetUsd)) {
    nextBudget = Math.max(0, body.budgetUsd);
  }

  if (typeof body.approvedUsd === "number" && Number.isFinite(body.approvedUsd)) {
    nextApproved = Math.max(0, body.approvedUsd);
  } else {
    // Default: bump by one step.
    nextApproved = state.approvedUsd + state.stepUsd;
  }

  // If extend-mode is on and the requested approval exceeds the cap,
  // raise the cap to fit. Otherwise clamp to the cap.
  if (body.extendBudget && nextApproved > nextBudget) {
    nextBudget = nextApproved;
  } else if (nextApproved > nextBudget) {
    nextApproved = nextBudget;
  }

  const patch: Record<string, string> = {
    hikerApprovedUsd: String(nextApproved),
  };
  if (nextBudget !== state.budgetUsd) {
    patch.hikerBudgetUsd = String(nextBudget);
  }
  await updateSettings(patch, session.userId);
  invalidateBudgetCache();
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "hiker.budget_approve",
    details: {
      previousApprovedUsd: state.approvedUsd,
      newApprovedUsd: nextApproved,
      previousBudgetUsd: state.budgetUsd,
      newBudgetUsd: nextBudget,
      spentUsd: state.spentUsd,
      extended: body.extendBudget === true && nextBudget !== state.budgetUsd,
    },
  });
  return NextResponse.json({
    ok: true,
    state: await getBudgetState(),
  });
}
