import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  deleteMessageRule,
  getMessageRule,
  listRuleRecipients,
  updateMessageRule,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const rule = await getMessageRule(ruleId);
  if (!rule) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const recipients = await listRuleRecipients(ruleId);
  return NextResponse.json({ rule, recipients });
}

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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    forwardFormat?: string | null;
    enabled?: boolean;
  };
  const patch: Parameters<typeof updateMessageRule>[1] = {};
  if (body.name != null) patch.name = body.name.trim();
  if (body.description != null) patch.description = body.description.trim();
  if (body.forwardFormat !== undefined) {
    patch.forwardFormat =
      typeof body.forwardFormat === "string" && body.forwardFormat.trim()
        ? body.forwardFormat.trim()
        : null;
  }
  if (body.enabled != null) patch.enabled = Boolean(body.enabled);
  const rule = await updateMessageRule(ruleId, patch);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.update",
    target: String(ruleId),
    details: { keys: Object.keys(patch) },
  });
  return NextResponse.json({ ok: true, rule });
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteMessageRule(ruleId);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.delete",
    target: String(ruleId),
    details: {},
  });
  return NextResponse.json({ ok: true });
}
