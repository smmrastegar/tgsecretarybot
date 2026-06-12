import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { getBot } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { chatId } → sends a test ping to the chat. Returns the actual
// Message.message_id from Telegram (or the error) so the operator can
// confirm whether the bot can really reach this chat — useful when the
// rule history shows ✓ delivered but the recipient swears nothing
// landed.
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
  const body = (await request.json().catch(() => ({}))) as {
    chatId?: number;
  };
  const chatId = Number(body.chatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  const bot = getBot();
  try {
    const me = await bot.api.getMe();
    const sent = await bot.api.sendMessage(
      chatId,
      `🧪 تست از rule (#${ruleId})\nاگه این پیام رو دریافت کردی، چت‌اِی‌دی ${chatId} قابل دسترسی هست برای bot @${me.username}.`,
    );
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "rule.recipient_test_send",
      target: String(ruleId),
      details: {
        chatId,
        sentMessageId: sent.message_id,
        botUsername: me.username,
      },
    });
    return NextResponse.json({
      ok: true,
      sentMessageId: sent.message_id,
      botUsername: me.username,
      botId: me.id,
      chatId: sent.chat.id,
      chatType: sent.chat.type,
      chatTitle:
        "title" in sent.chat ? (sent.chat.title as string | undefined) : null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: reason, chatId },
      { status: 200 },
    );
  }
}
