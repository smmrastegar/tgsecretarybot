import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, getChatRule, upsertChatRule } from "@/lib/db";

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
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    chatType?: string;
    chatTitle?: string | null;
    vip?: boolean;
    muted?: boolean;
    customReply?: string | null;
    notes?: string | null;
  };
  const existing = await getChatRule(chatId);
  await upsertChatRule({
    chatId,
    chatType: body.chatType ?? existing?.chatType ?? "private",
    chatTitle: body.chatTitle ?? existing?.chatTitle ?? null,
    vip: body.vip ?? existing?.vip ?? false,
    muted: body.muted ?? existing?.muted ?? false,
    customReply: body.customReply ?? existing?.customReply ?? null,
    notes: body.notes ?? existing?.notes ?? null,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chatrule.update",
    target: String(chatId),
    details: body,
  });
  return NextResponse.json({ ok: true });
}
