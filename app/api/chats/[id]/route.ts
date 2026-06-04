import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  CHAT_MODES,
  getChatFunctionRoles,
  getChatRule,
  getSenderStats,
  lastOwnerMessageAt,
  listMessages,
  RELATIONSHIPS,
  upsertChatRule,
  type ChatMode,
  type Relationship,
} from "@/lib/db";
import { getSettings } from "@/lib/settings";

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
  const [rule, messages, stats, lastOwnerSentAt, settings, functionRoles] =
    await Promise.all([
      getChatRule(chatId),
      listMessages({ chatId, limit, offset }),
      getSenderStats(chatId),
      lastOwnerMessageAt(chatId).catch(() => null),
      getSettings(),
      getChatFunctionRoles(chatId),
    ]);
  const isDm = (rule?.chatType ?? "private") === "private";
  const graceMinutes = Math.max(
    Number(
      isDm ? settings.dmActiveGraceMinutes : settings.groupActiveGraceMinutes,
    ) || 0,
    0,
  );
  return NextResponse.json({
    rule,
    functionRoles,
    messages,
    stats,
    hasMore: messages.length === limit,
    grace: {
      minutes: graceMinutes,
      lastOwnerSentAt: lastOwnerSentAt
        ? lastOwnerSentAt.toISOString()
        : null,
    },
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
    nickname?: string | null;
    relationship?: Relationship | null;
    relationshipNotes?: string | null;
    talkStyleNotes?: string | null;
    aiProcessVoice?: boolean;
    aiProcessStickers?: boolean;
    aiProcessGifs?: boolean;
  };
  const existing = await getChatRule(chatId);
  const mode: ChatMode =
    body.mode && CHAT_MODES.includes(body.mode)
      ? body.mode
      : existing?.mode ?? "off";
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
  const nickname =
    body.nickname === undefined
      ? existing?.nickname ?? null
      : normName(body.nickname);
  const relationship: Relationship | null =
    body.relationship === undefined
      ? existing?.relationship ?? null
      : body.relationship &&
          (RELATIONSHIPS as readonly string[]).includes(body.relationship)
        ? body.relationship
        : null;
  const relationshipNotes =
    body.relationshipNotes === undefined
      ? existing?.relationshipNotes ?? null
      : normName(body.relationshipNotes);
  const talkStyleNotes =
    body.talkStyleNotes === undefined
      ? existing?.talkStyleNotes ?? null
      : normName(body.talkStyleNotes);
  const aiProcessVoice =
    body.aiProcessVoice === undefined
      ? existing?.aiProcessVoice ?? false
      : Boolean(body.aiProcessVoice);
  const aiProcessStickers =
    body.aiProcessStickers === undefined
      ? existing?.aiProcessStickers ?? false
      : Boolean(body.aiProcessStickers);
  const aiProcessGifs =
    body.aiProcessGifs === undefined
      ? existing?.aiProcessGifs ?? false
      : Boolean(body.aiProcessGifs);
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
    nickname,
    relationship,
    relationshipNotes,
    talkStyleNotes,
    aiProcessVoice,
    aiProcessStickers,
    aiProcessGifs,
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
