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

// POST {} → approve the next $stepUsd slice.
// POST {approvedUsd: <abs>} → set the approved-up-to value directly
//   (used by the settings dialog when the owner adjusts manually).
export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    approvedUsd?: number;
  };
  const state = await getBudgetState();
  let nextApproved: number;
  if (typeof body.approvedUsd === "number" && Number.isFinite(body.approvedUsd)) {
    nextApproved = Math.max(0, Math.min(state.budgetUsd, body.approvedUsd));
  } else {
    nextApproved = Math.min(state.budgetUsd, state.approvedUsd + state.stepUsd);
  }
  await updateSettings(
    { hikerApprovedUsd: String(nextApproved) },
    session.userId,
  );
  invalidateBudgetCache();
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "hiker.budget_approve",
    details: {
      previousApprovedUsd: state.approvedUsd,
      newApprovedUsd: nextApproved,
      spentUsd: state.spentUsd,
      budgetUsd: state.budgetUsd,
    },
  });
  return NextResponse.json({
    ok: true,
    state: await getBudgetState(),
  });
}
