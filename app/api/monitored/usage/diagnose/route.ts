import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { diagnoseUsage } from "@/lib/hikerapi";
import { requireTenant } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  // Diagnose with the tenant's effective key (their override if
  // present, otherwise the global override, otherwise env).
  return runWithTenant(tenant.id, async () => {
    const result = await diagnoseUsage();
    return NextResponse.json({ ok: true, ...result });
  });
}
