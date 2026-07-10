import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addRuleRecipient,
  audit,
  listRuleRecipients,
  removeRuleRecipient,
  setRuleRecipientPaused,
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    recipientChatId?: number;
    paused?: boolean;
  };
  const chatId = Number(body.recipientChatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json(
      { error: "recipientChatId required" },
      { status: 400 },
    );
  }
  await setRuleRecipientPaused({
    ruleId,
    recipientChatId: chatId,
    paused: Boolean(body.paused),
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: body.paused ? "rule.recipient_pause" : "rule.recipient_resume",
    target: String(ruleId),
    details: { recipientChatId: chatId },
  });
  return NextResponse.json({ ok: true });
}

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
  const recipients = await listRuleRecipients(ruleId);
  return NextResponse.json({ recipients });
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    recipientChatId?: number;
    recipientLabel?: string;
  };
  const chatId = Number(body.recipientChatId);
  if (!Number.isFinite(chatId) || chatId === 0) {
    return NextResponse.json(
      { error: "recipientChatId required (number)" },
      { status: 400 },
    );
  }
  await addRuleRecipient({
    ruleId,
    recipientChatId: chatId,
    recipientLabel: body.recipientLabel ?? null,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.recipient_add",
    target: String(ruleId),
    details: { recipientChatId: chatId, label: body.recipientLabel ?? null },
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("recipientChatId"));
  if (!Number.isFinite(chatId)) {
    return NextResponse.json(
      { error: "?recipientChatId required" },
      { status: 400 },
    );
  }
  await removeRuleRecipient({ ruleId, recipientChatId: chatId });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.recipient_remove",
    target: String(ruleId),
    details: { recipientChatId: chatId },
  });
  return NextResponse.json({ ok: true });
}
