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
    forwardHeader?: string | null;
    requestTrigger?: string | null;
    requestWindowSeconds?: number | null;
    sourceChatIds?: string | null;
    sourceThreadIds?: string | null;
    matchAllFromSource?: boolean;
    showRulePrefix?: boolean;
    formatAsOtp?: boolean;
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
  if (body.forwardHeader !== undefined) {
    patch.forwardHeader =
      typeof body.forwardHeader === "string" && body.forwardHeader.trim()
        ? body.forwardHeader.trim()
        : null;
  }
  if (body.requestTrigger !== undefined) {
    patch.requestTrigger =
      typeof body.requestTrigger === "string" && body.requestTrigger.trim()
        ? body.requestTrigger.trim()
        : null;
  }
  if (body.requestWindowSeconds !== undefined) {
    const n = Number(body.requestWindowSeconds);
    patch.requestWindowSeconds =
      Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  if (body.sourceChatIds !== undefined) {
    // Normalise: keep only valid numeric ids, comma-joined; empty → NULL.
    const cleaned =
      typeof body.sourceChatIds === "string"
        ? body.sourceChatIds
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter((s) => s && Number.isFinite(Number(s)) && Number(s) !== 0)
            .join(",")
        : "";
    patch.sourceChatIds = cleaned || null;
  }
  if (body.sourceThreadIds !== undefined) {
    // Forum topic ids are positive small ints; same normalisation.
    const cleaned =
      typeof body.sourceThreadIds === "string"
        ? body.sourceThreadIds
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter((s) => s && Number.isFinite(Number(s)) && Number(s) > 0)
            .join(",")
        : "";
    patch.sourceThreadIds = cleaned || null;
  }
  if (body.matchAllFromSource != null)
    patch.matchAllFromSource = Boolean(body.matchAllFromSource);
  if (body.showRulePrefix != null)
    patch.showRulePrefix = Boolean(body.showRulePrefix);
  if (body.formatAsOtp != null)
    patch.formatAsOtp = Boolean(body.formatAsOtp);
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
