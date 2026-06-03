import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { requireTenant, setTenantApiKeys } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {key: "<new-key>", name?: "smmr"} → writes onto the caller's
// tenant. Empty string clears the per-tenant override, falling back
// to the global settings override and then env. The previous version
// of this endpoint wrote to global settings; that path is now reserved
// for admin via /api/admin/tenants/[id]/keys.
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
    key?: string;
    name?: string;
  };
  const key = (body.key ?? "").trim();
  const name = (body.name ?? "").trim();
  await setTenantApiKeys(tenant.id, {
    hikerApiKey: key,
    hikerApiKeyName: name,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: key ? "hiker.tenant_key_set" : "hiker.tenant_key_clear",
    details: {
      tenantId: tenant.id,
      length: key.length,
      hasName: !!name,
    },
  });
  return NextResponse.json({
    ok: true,
    set: !!key,
    masked: key
      ? `${key.slice(0, 5)}…${key.slice(-3)} (${key.length} chars)`
      : null,
    name: name || null,
  });
}
