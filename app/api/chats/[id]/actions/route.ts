import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, getChatRule, saveExtractedItems } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    title?: string;
    kind?: string;
    description?: string;
    dueAt?: string;
  };
  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const rule = await getChatRule(chatId).catch(() => null);
  const senderName = rule
    ? rule.nickname ||
      [rule.firstName, rule.lastName].filter(Boolean).join(" ").trim() ||
      rule.chatTitle ||
      null
    : null;
  const dueAt =
    body.dueAt && Number.isFinite(new Date(body.dueAt).getTime())
      ? new Date(body.dueAt)
      : null;
  const kind = body.kind?.trim() || "action";
  const n = await saveExtractedItems([
    {
      messageId: null,
      tgMessageId: null,
      chatId,
      chatTitle: rule?.chatTitle ?? null,
      senderName,
      kind,
      title: title.slice(0, 200),
      description: body.description ?? null,
      dueAt,
    },
  ]);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "action.create",
    target: String(chatId),
    details: { title, kind, fromSummary: true },
  });
  return NextResponse.json({ ok: true, saved: n });
}
