import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import {
  deleteTenant,
  getTenant,
  requireAdmin,
  setTenantApiKeys,
  updateTenant,
} from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    plan?: string;
    hikerBudgetUsd?: number;
    hikerApprovedUsd?: number;
    hikerApprovalStepUsd?: number;
    monitoredCap?: number;
    isEnabled?: boolean;
    notes?: string | null;
    hikerApiKey?: string | null;
    hikerApiKeyName?: string | null;
    openrouterApiKey?: string | null;
    groqApiKey?: string | null;
  };
  // Keys go through the setter that distinguishes "leave alone" from
  // "clear"; everything else uses the COALESCE updater.
  const keyPatch: {
    hikerApiKey?: string | null;
    hikerApiKeyName?: string | null;
    openrouterApiKey?: string | null;
    groqApiKey?: string | null;
  } = {};
  if (body.hikerApiKey !== undefined) keyPatch.hikerApiKey = body.hikerApiKey;
  if (body.hikerApiKeyName !== undefined)
    keyPatch.hikerApiKeyName = body.hikerApiKeyName;
  if (body.openrouterApiKey !== undefined)
    keyPatch.openrouterApiKey = body.openrouterApiKey;
  if (body.groqApiKey !== undefined) keyPatch.groqApiKey = body.groqApiKey;
  if (Object.keys(keyPatch).length > 0) {
    await setTenantApiKeys(n, keyPatch);
  }
  const updated = await updateTenant(n, {
    name: body.name,
    plan: body.plan,
    hikerBudgetUsd: body.hikerBudgetUsd,
    hikerApprovedUsd: body.hikerApprovedUsd,
    hikerApprovalStepUsd: body.hikerApprovalStepUsd,
    monitoredCap: body.monitoredCap,
    isEnabled: body.isEnabled,
    notes: body.notes,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.tenant_update",
    target: String(n),
    details: {
      ...body,
      hikerApiKey: body.hikerApiKey !== undefined ? "<changed>" : undefined,
      openrouterApiKey:
        body.openrouterApiKey !== undefined ? "<changed>" : undefined,
      groqApiKey: body.groqApiKey !== undefined ? "<changed>" : undefined,
    },
  });
  return NextResponse.json({ ok: true, tenant: updated });
}

export async function DELETE(
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
  const t = await getTenant(n);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (t.name === "Default") {
    return NextResponse.json(
      { error: "can't delete the Default tenant" },
      { status: 400 },
    );
  }
  await deleteTenant(n);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.tenant_delete",
    target: String(n),
    details: { name: t.name },
  });
  return NextResponse.json({ ok: true });
}

export async function GET(
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
  const t = await getTenant(n);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    tenant: {
      ...t,
      hikerApiKey: undefined,
      openrouterApiKey: undefined,
      hikerKeyPrefix: t.hikerApiKey
        ? `${t.hikerApiKey.slice(0, 5)}…${t.hikerApiKey.slice(-3)} (${t.hikerApiKey.length} chars)`
        : null,
      openrouterKeyPrefix: t.openrouterApiKey
        ? `${t.openrouterApiKey.slice(0, 4)}…${t.openrouterApiKey.slice(-3)} (${t.openrouterApiKey.length} chars)`
        : null,
    },
  });
}
