import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import {
  audit,
  getChatRule,
  hasDb,
  logMessage,
  markMessageHandled,
  recentConversation,
  sql,
  upsertChatRule,
} from "@/lib/db";
import { aiConversationReply } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  _request: Request,
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

  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, message_id, business_connection_id,
           sender_name
    FROM messages_log WHERE id = ${messageId} LIMIT 1`;
  const row = rows[0] as
    | {
        chat_id: number;
        chat_type: string;
        chat_title: string | null;
        message_id: number;
        business_connection_id: string;
        sender_name: string;
      }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const settings = await getSettings();
  const [history, rule] = await Promise.all([
    recentConversation(Number(row.chat_id), 40),
    getChatRule(Number(row.chat_id)).catch(() => null),
  ]);

  let reply: string;
  try {
    reply = await aiConversationReply({
      ownerName: settings.ownerName,
      ownerDisplayName: settings.ownerDisplayName,
      ownerContext: settings.ownerContext,
      senderName: row.sender_name,
      history,
      nickname: rule?.nickname ?? null,
      relationship: rule?.relationship ?? null,
      chatId: Number(row.chat_id),
      businessConnectionId: row.business_connection_id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 500) },
      { status: 500 },
    );
  }
  if (!reply || !reply.trim()) {
    return NextResponse.json(
      { error: "AI returned an empty reply; try AI suggest manually." },
      { status: 500 },
    );
  }

  const bot = getBot();
  try {
    const sent = await bot.api.sendMessage(Number(row.chat_id), reply.trim(), {
      business_connection_id: row.business_connection_id,
      reply_parameters: { message_id: Number(row.message_id) },
    });
    try {
      if ((settings.markMessagesAsRead ?? "true").toLowerCase() !== "false") {
        await bot.api.readBusinessMessage(
          row.business_connection_id,
          Number(row.chat_id),
          Number(row.message_id),
        );
      }
    } catch (err) {
      console.warn("[ai-handle] mark-read failed:", err);
    }
    try {
      await logMessage({
        businessConnectionId: row.business_connection_id,
        ownerUserId: session.userId,
        chatId: Number(row.chat_id),
        chatType: row.chat_type,
        chatTitle: row.chat_title,
        senderId: session.userId,
        senderUsername: session.username ?? null,
        senderName:
          settings.ownerDisplayName || settings.ownerName || "owner",
        messageId: sent.message_id,
        messageText: reply.trim(),
        importance: 0,
        urgent: false,
        concernsOwner: false,
        reason: "AI handle via dashboard",
        alerted: false,
        autoReplied: false,
        fromOwner: true,
        source: "ai_dashboard",
      });
    } catch (err) {
      console.error("[ai-handle] log failed:", err);
    }
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 400) },
      { status: 500 },
    );
  }

  // Switch the chat to ai_chat mode so future messages keep getting AI replies.
  // Preserve every other rule field — only mode flips.
  try {
    await upsertChatRule({
      chatId: Number(row.chat_id),
      chatType: row.chat_type,
      chatTitle: row.chat_title ?? rule?.chatTitle ?? null,
      vip: rule?.vip ?? false,
      muted: rule?.muted ?? false,
      customReply: rule?.customReply ?? null,
      notes: rule?.notes ?? null,
      mode: "ai_chat",
      secretaryUserId: rule?.secretaryUserId ?? null,
      firstName: rule?.firstName ?? null,
      lastName: rule?.lastName ?? null,
      nickname: rule?.nickname ?? null,
      relationship: rule?.relationship ?? null,
    });
  } catch (err) {
    console.error("[ai-handle] mode update failed:", err);
  }

  await markMessageHandled(messageId, session.userId, "AI handled via dashboard");
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "message.ai_handle",
    target: String(messageId),
    details: { length: reply.length },
  });

  return NextResponse.json({ ok: true, reply: reply.trim() });
}
