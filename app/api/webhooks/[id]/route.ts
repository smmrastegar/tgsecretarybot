import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, deleteSmsWebhook, updateSmsWebhook } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
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
  const idN = Number(id);
  if (!Number.isFinite(idN)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    enabled?: boolean;
    redactPrivate?: boolean;
  };
  const patch: Parameters<typeof updateSmsWebhook>[1] = {};
  if (body.name != null) patch.name = body.name.trim();
  if (body.enabled != null) patch.enabled = Boolean(body.enabled);
  if (body.redactPrivate != null)
    patch.redactPrivate = Boolean(body.redactPrivate);
  const webhook = await updateSmsWebhook(idN, patch);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "webhook.update",
    target: String(idN),
    details: { keys: Object.keys(patch) },
  });
  return NextResponse.json({ ok: true, webhook });
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
  const idN = Number(id);
  if (!Number.isFinite(idN)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteSmsWebhook(idN);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "webhook.delete",
    target: String(idN),
    details: {},
  });
  return NextResponse.json({ ok: true });
}
