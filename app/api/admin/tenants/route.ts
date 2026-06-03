import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, getHikerTotalSpent } from "@/lib/db";
import {
  createTenant,
  listTenants,
  requireAdmin,
} from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only — list every tenant + their spend snapshot. Used by
// the /admin page.
export async function GET(): Promise<NextResponse> {
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
  const tenants = await listTenants();
  // Snapshot spent for each tenant in parallel. We hide secret keys
  // — return only their masked prefix + name so the admin sees that
  // a key is set without us round-tripping the secret.
  const enriched = await Promise.all(
    tenants.map(async (t) => {
      const spent = await getHikerTotalSpent(t.id);
      const tenantKeyPrefix = t.hikerApiKey
        ? `${t.hikerApiKey.slice(0, 5)}…${t.hikerApiKey.slice(-3)} (${t.hikerApiKey.length} chars)`
        : null;
      const orKeyPrefix = t.openrouterApiKey
        ? `${t.openrouterApiKey.slice(0, 4)}…${t.openrouterApiKey.slice(-3)} (${t.openrouterApiKey.length} chars)`
        : null;
      return {
        id: t.id,
        name: t.name,
        plan: t.plan,
        hikerBudgetUsd: t.hikerBudgetUsd,
        hikerApprovedUsd: t.hikerApprovedUsd,
        hikerApprovalStepUsd: t.hikerApprovalStepUsd,
        monitoredCap: t.monitoredCap,
        isEnabled: t.isEnabled,
        notes: t.notes,
        hikerKeyName: t.hikerApiKeyName,
        hikerKeyPrefix: tenantKeyPrefix,
        openrouterKeyPrefix: orKeyPrefix,
        spentUsd: spent,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    }),
  );
  return NextResponse.json({ ok: true, tenants: enriched });
}

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
    name?: string;
    plan?: string;
    hikerBudgetUsd?: number;
    hikerApprovedUsd?: number;
    hikerApprovalStepUsd?: number;
    monitoredCap?: number;
    notes?: string | null;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const t = await createTenant({
    name,
    plan: body.plan,
    hikerBudgetUsd: body.hikerBudgetUsd,
    hikerApprovedUsd: body.hikerApprovedUsd,
    hikerApprovalStepUsd: body.hikerApprovalStepUsd,
    monitoredCap: body.monitoredCap,
    notes: body.notes ?? null,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.tenant_create",
    target: String(t.id),
    details: { name, plan: t.plan, budgetUsd: t.hikerBudgetUsd },
  });
  return NextResponse.json({ ok: true, tenant: t });
}
