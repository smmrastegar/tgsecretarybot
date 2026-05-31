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
  request: Request,
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
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "10"), 1),
    100,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const [rule, messages, stats] = await Promise.all([
    getChatRule(chatId),
    listMessages({ chatId, limit, offset }),
    getSenderStats(chatId),
  ]);
  return NextResponse.json({
    rule,
    messages,
    stats,
    hasMore: messages.length === limit,
  });
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
    secretaryUserId?: number | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  const existing = await getChatRule(chatId);
  const mode: ChatMode =
    body.mode && CHAT_MODES.includes(body.mode)
      ? body.mode
      : existing?.mode ?? "secretary";
  const secretaryUserId =
    body.secretaryUserId === undefined
      ? existing?.secretaryUserId ?? null
      : body.secretaryUserId;
  const normName = (v: string | null | undefined): string | null => {
    if (v === undefined) return undefined as unknown as null;
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };
  const firstName =
    body.firstName === undefined
      ? existing?.firstName ?? null
      : normName(body.firstName);
  const lastName =
    body.lastName === undefined
      ? existing?.lastName ?? null
      : normName(body.lastName);
  await upsertChatRule({
    chatId,
    chatType: body.chatType ?? existing?.chatType ?? "private",
    chatTitle: body.chatTitle ?? existing?.chatTitle ?? null,
    vip: body.vip ?? existing?.vip ?? false,
    muted: body.muted ?? existing?.muted ?? false,
    customReply: body.customReply ?? existing?.customReply ?? null,
    notes: body.notes ?? existing?.notes ?? null,
    mode,
    secretaryUserId,
    firstName,
    lastName,
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
