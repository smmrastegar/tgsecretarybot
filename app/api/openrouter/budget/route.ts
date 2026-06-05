import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getOpenrouterBudgetState } from "@/lib/openrouter-budget";
import { getOpenrouterCredits } from "@/lib/openrouter-credits";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the per-tenant OpenRouter budget state (spent / approved /
// cap, mirrors the HikerAPI budget endpoint) AND the actual upstream
// balance from /api/v1/credits when we can read it. Credits are
// fetched best-effort — a missing OPENROUTER_API_KEY or transient
// network blip shouldn't blank the whole card.
export async function GET(): Promise<NextResponse> {
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
  const state = await getOpenrouterBudgetState(tenant.id);
  let credits: Awaited<ReturnType<typeof getOpenrouterCredits>> | null = null;
  let creditsError: string | null = null;
  try {
    credits = await getOpenrouterCredits();
  } catch (err) {
    creditsError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json({ ok: true, state, credits, creditsError });
}
