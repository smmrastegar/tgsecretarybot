import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  deleteMonitoredAccount,
  resetMonitoredAccountError,
  setMonitoredAccountEnabled,
  updateMonitoredAccountConfig,
} from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

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
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
    intervalMinutes?: number;
    resetError?: boolean;
  };
  if (body.resetError === true) {
    await resetMonitoredAccountError(n, tenant.id);
  }
  if (body.enabled !== undefined) {
    await setMonitoredAccountEnabled(n, Boolean(body.enabled), tenant.id);
  }
  if (
    body.checkStories !== undefined ||
    body.checkPosts !== undefined ||
    body.checkReels !== undefined ||
    body.checkProfile !== undefined ||
    body.checkMentioned !== undefined ||
    body.intervalMinutes !== undefined
  ) {
    const interval =
      body.intervalMinutes !== undefined
        ? Math.max(5, Math.min(Number(body.intervalMinutes), 24 * 60))
        : undefined;
    await updateMonitoredAccountConfig(
      n,
      {
        checkStories: body.checkStories,
        checkPosts: body.checkPosts,
        checkReels: body.checkReels,
        checkProfile: body.checkProfile,
        checkMentioned: body.checkMentioned,
        intervalMinutes: interval,
      },
      tenant.id,
    );
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.update",
    target: String(n),
    details: { ...body, tenantId: tenant.id } as Record<string, unknown>,
  });
  return NextResponse.json({ ok: true });
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
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteMonitoredAccount(n, tenant.id);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.delete",
    target: String(n),
    details: { tenantId: tenant.id },
  });
  return NextResponse.json({ ok: true });
}
