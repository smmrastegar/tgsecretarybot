import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  addRuleRecipient,
  audit,
  listRulesForRecipient,
  removeRuleRecipient,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → rules where this chat is a recipient.
// POST { ruleId, label? } → add this chat as a recipient for that rule.
// DELETE ?ruleId → remove this chat from that rule.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const rules = await listRulesForRecipient(chatId);
  return NextResponse.json({ rules });
}

export async function POST(
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
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    ruleId?: number;
    label?: string;
  };
  const ruleId = Number(body.ruleId);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "ruleId required" }, { status: 400 });
  }
  await addRuleRecipient({
    ruleId,
    recipientChatId: chatId,
    recipientLabel: body.label ?? null,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.rule_add",
    target: String(chatId),
    details: { ruleId, label: body.label ?? null },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
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
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const ruleId = Number(url.searchParams.get("ruleId"));
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "?ruleId required" }, { status: 400 });
  }
  await removeRuleRecipient({ ruleId, recipientChatId: chatId });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.rule_remove",
    target: String(chatId),
    details: { ruleId },
  });
  return NextResponse.json({ ok: true });
}
