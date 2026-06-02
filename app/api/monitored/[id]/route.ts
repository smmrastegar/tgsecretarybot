import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  deleteMonitoredAccount,
  setMonitoredAccountEnabled,
} from "@/lib/db";

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
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
  };
  await setMonitoredAccountEnabled(n, Boolean(body.enabled));
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.set_enabled",
    target: String(n),
    details: { enabled: Boolean(body.enabled) },
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
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteMonitoredAccount(n);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.delete",
    target: String(n),
  });
  return NextResponse.json({ ok: true });
}
