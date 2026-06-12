import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { getBot } from "@/lib/bot";
import { sendRuleForward } from "@/lib/rule-delivery";

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
    // Fetch the chat info FIRST so we can show first/last name even
    // if sendMessage fails afterwards (e.g. blocked). For DMs the
    // first/last name reveal whether the operator is sending to
    // themselves, the wrong person, or the intended recipient.
    let destInfo: {
      firstName?: string | null;
      lastName?: string | null;
      username?: string | null;
      title?: string | null;
    } = {};
    try {
      const c = await bot.api.getChat(chatId);
      destInfo = {
        firstName: ("first_name" in c ? c.first_name : null) ?? null,
        lastName: ("last_name" in c ? c.last_name : null) ?? null,
        username: ("username" in c ? c.username : null) ?? null,
        title: ("title" in c ? c.title : null) ?? null,
      };
    } catch {}
    const out = await sendRuleForward({
      bot,
      chatId,
      text: `🧪 تست از rule (#${ruleId})\nاگه این پیام رو دریافت کردی، chat_id ${chatId} قابل دسترسی هست از طریق bot @${me.username}.`,
    });
    if (!out.ok) {
      throw new Error(out.error);
    }
    const usedMode = out.mode;
    const destChatId = chatId;
    const destChatType = (destInfo.title ? "group" : "private") as
      | "group"
      | "private";
    const destChatTitle = destInfo.title ?? null;
    const isSelfSend = me.id === destChatId;
    let warning: string | null = null;
    if (isSelfSend) {
      warning =
        "chat_id برابر id خود bot هست — این یعنی پیام به جای دیگری نمی‌ره.";
    } else if (destChatType === "private" && destChatTitle == null) {
      warning =
        "این یه DM خصوصی هست. اگه فکر می‌کنی به یه فرد دیگه می‌ره ولی خودِت پیام تست رو می‌بینی، یعنی chat_id خودِ توئه نه گیرنده مدنظرت.";
    }
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "rule.recipient_test_send",
      target: String(ruleId),
      details: {
        chatId,
        destChatId,
        destChatType,
        sentMessageId: out.sentMessageId,
        mode: usedMode,
        botUsername: me.username,
        botId: me.id,
      },
    });
    return NextResponse.json({
      ok: true,
      sentMessageId: out.sentMessageId,
      mode: usedMode,
      botUsername: me.username,
      botId: me.id,
      destChatId,
      destChatType,
      destChatTitle,
      destFirstName: destInfo.firstName ?? null,
      destLastName: destInfo.lastName ?? null,
      destUsername: destInfo.username ?? null,
      isSelfSend,
      warning,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: reason, chatId },
      { status: 200 },
    );
  }
}
