import { Bot, GrammyError, HttpError } from "grammy";
import type { Message } from "grammy/types";
import { config } from "./config.js";
import { classify } from "./classifier.js";
import { fireAlert } from "./alert.js";

export const bot = new Bot(config.telegramBotToken);

type Connection = { userId: number; userChatId: number };
const connections = new Map<string, Connection>();

async function resolveOwnerId(bcId: string): Promise<number | undefined> {
  const cached = connections.get(bcId);
  if (cached) return cached.userId;
  try {
    const bc = await bot.api.getBusinessConnection(bcId);
    connections.set(bc.id, { userId: bc.user.id, userChatId: bc.user_chat_id });
    return bc.user.id;
  } catch (err) {
    console.error(`[connection] lookup failed for ${bcId}:`, err);
    return undefined;
  }
}

bot.on("business_connection", async (ctx) => {
  const bc = ctx.update.business_connection;
  if (bc.is_enabled) {
    connections.set(bc.id, { userId: bc.user.id, userChatId: bc.user_chat_id });
    console.log(
      `[connection] enabled id=${bc.id} user=@${bc.user.username ?? bc.user.id} can_reply=${Boolean(bc.rights?.can_reply)}`,
    );
  } else {
    connections.delete(bc.id);
    console.log(`[connection] disabled id=${bc.id}`);
  }
});

bot.on("business_message", async (ctx) => {
  await handleBusinessMessage(ctx.update.business_message);
});

bot.on("edited_business_message", async (ctx) => {
  await handleBusinessMessage(ctx.update.edited_business_message);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hi. I'm your Telegram secretary bot.\n\n" +
      "To use me: open Telegram Settings -> Telegram Business -> Chatbots, " +
      "and add this bot. I'll then screen your incoming DMs and group messages " +
      "and ping your alert device when something urgent and personal comes in.",
  );
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("[bot] Telegram API error:", e.description);
  } else if (e instanceof HttpError) {
    console.error("[bot] network error:", e);
  } else {
    console.error("[bot] uncaught:", e);
  }
});

async function handleBusinessMessage(msg: Message): Promise<void> {
  const bcId = msg.business_connection_id;
  if (!bcId) return;

  const ownerId = await resolveOwnerId(bcId);
  if (ownerId && msg.from && msg.from.id === ownerId) return;

  const text = msg.text ?? msg.caption;
  if (!text) return;

  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
    msg.from?.username ||
    "unknown sender";

  const chatTitle =
    "title" in msg.chat && typeof msg.chat.title === "string"
      ? msg.chat.title
      : undefined;

  let verdict;
  try {
    verdict = await classify({
      chatType: msg.chat.type,
      chatTitle,
      senderName,
      text,
    });
  } catch (err) {
    console.error("[classify] failed:", err);
    return;
  }

  console.log(
    `[classify] importance=${verdict.importance} urgent=${verdict.urgent} concerns_owner=${verdict.concernsOwner} chat=${msg.chat.type} from=${senderName} | ${verdict.reason}`,
  );

  const shouldAlert =
    verdict.urgent &&
    verdict.concernsOwner &&
    verdict.importance >= config.importanceThreshold;

  if (!shouldAlert) return;

  const chatLabel =
    chatTitle ?? (msg.chat.type === "private" ? `DM from ${senderName}` : `chat ${msg.chat.id}`);

  try {
    await fireAlert({
      text,
      sender: senderName,
      chat: chatLabel,
      importance: verdict.importance,
      reason: verdict.reason,
      timestamp: new Date().toISOString(),
    });
    console.log("[alert] fired");
  } catch (err) {
    console.error("[alert] failed:", err);
  }

  if (config.ownerNotifyChatId) {
    try {
      await bot.api.sendMessage(
        config.ownerNotifyChatId,
        `🚨 Urgent message flagged\n` +
          `From: ${senderName}\n` +
          `In: ${chatLabel}\n` +
          `Importance: ${verdict.importance}/10\n` +
          `Reason: ${verdict.reason}\n\n` +
          text.slice(0, 500),
      );
    } catch (err) {
      console.error("[notify] failed:", err);
    }
  }
}

export const ALLOWED_UPDATES = [
  "message",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
] as const;
