import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  CHAT_MODES,
  getChatRule,
  getSenderStats,
  listMessages,
  upsertChatRule,
  type ChatMode,
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
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const [rule, messages, stats] = await Promise.all([
    getChatRule(chatId),
    listMessages({ chatId, limit: 10 }),
    getSenderStats(chatId),
  ]);
  return NextResponse.json({ rule, messages, stats });
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
    mode?: ChatMode;
  };
  const existing = await getChatRule(chatId);
  const mode: ChatMode =
    body.mode && CHAT_MODES.includes(body.mode)
      ? body.mode
      : existing?.mode ?? "secretary";
  await upsertChatRule({
    chatId,
    chatType: body.chatType ?? existing?.chatType ?? "private",
    chatTitle: body.chatTitle ?? existing?.chatTitle ?? null,
    vip: body.vip ?? existing?.vip ?? false,
    muted: body.muted ?? existing?.muted ?? false,
    customReply: body.customReply ?? existing?.customReply ?? null,
    notes: body.notes ?? existing?.notes ?? null,
    mode,
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
