import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import {
  audit,
  CHAT_MODES,
  hasDb,
  markMessageHandled,
  sql,
  upsertChatRule,
  type ChatMode,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

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
  if (!hasDb()) {
    return NextResponse.json({ error: "db not configured" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    text?: string;
    markHandled?: boolean;
    setMode?: ChatMode;
  };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty text" }, { status: 400 });
  }

  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, message_id, business_connection_id
    FROM messages_log WHERE id = ${messageId} LIMIT 1`;
  const row = rows[0] as
    | {
        chat_id: number;
        chat_type: string;
        chat_title: string | null;
        message_id: number;
        business_connection_id: string;
      }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const bot = getBot();
  try {
    await bot.api.sendMessage(Number(row.chat_id), text, {
      business_connection_id: row.business_connection_id,
      reply_parameters: { message_id: Number(row.message_id) },
    });
    try {
      await bot.api.readBusinessMessage(
        row.business_connection_id,
        Number(row.chat_id),
        Number(row.message_id),
      );
    } catch (err) {
      console.warn("[send] mark-read failed:", err);
    }
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 400) },
      { status: 500 },
    );
  }

  if (body.markHandled !== false) {
    await markMessageHandled(messageId, session.userId, "replied via dashboard");
  }

  if (body.setMode && CHAT_MODES.includes(body.setMode)) {
    try {
      await upsertChatRule({
        chatId: Number(row.chat_id),
        chatType: row.chat_type,
        chatTitle: row.chat_title,
        vip: false,
        muted: false,
        customReply: null,
        notes: null,
        mode: body.setMode,
      });
    } catch (err) {
      console.error("[send] mode update failed:", err);
    }
  }

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "message.send_reply",
    target: String(messageId),
    details: { length: text.length },
  });

  return NextResponse.json({ ok: true });
}
