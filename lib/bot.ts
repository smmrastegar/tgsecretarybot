import { Bot, GrammyError, HttpError } from "grammy";
import type { Message } from "grammy/types";
import { config } from "./config";
import { classify } from "./classifier";
import { fireAlert } from "./alert";
import { getSettings } from "./settings";
import {
  getBusinessConnection,
  getChatRule,
  hasDb,
  isAllowedUser,
  lastOwnerMessageAt,
  logMessage,
  upsertBusinessConnection,
} from "./db";
import { createMagicToken } from "./magic";

let _bot: Bot | null = null;
export function getBot(): Bot {
  if (!_bot) _bot = buildBot();
  return _bot;
}

export const ALLOWED_UPDATES = [
  "message",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
] as const;

type OwnerCacheEntry = { userId: number; userChatId: number; canReply: boolean };
const ownerCache = new Map<string, OwnerCacheEntry>();
const autoReplyCache = new Map<string, number>();

function buildBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.on("business_connection", async (ctx) => {
    const bc = ctx.update.business_connection;
    const entry: OwnerCacheEntry = {
      userId: bc.user.id,
      userChatId: bc.user_chat_id,
      canReply: Boolean(bc.rights?.can_reply),
    };
    if (bc.is_enabled) {
      ownerCache.set(bc.id, entry);
    } else {
      ownerCache.delete(bc.id);
    }
    if (hasDb()) {
      try {
        await upsertBusinessConnection({
          id: bc.id,
          userId: bc.user.id,
          userChatId: bc.user_chat_id,
          username: bc.user.username ?? null,
          firstName: bc.user.first_name ?? null,
          lastName: bc.user.last_name ?? null,
          canReply: Boolean(bc.rights?.can_reply),
          isEnabled: bc.is_enabled,
        });
      } catch (err) {
        console.error("[connection] persist failed:", err);
      }
    }
    console.log(
      `[connection] ${bc.is_enabled ? "enabled" : "disabled"} id=${bc.id} user=@${bc.user.username ?? bc.user.id}`,
    );
  });

  bot.on("business_message", async (ctx) => {
    await handleBusinessMessage(ctx.update.business_message, bot);
  });
  bot.on("edited_business_message", async (ctx) => {
    await handleBusinessMessage(ctx.update.edited_business_message, bot);
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hi. I'm your Telegram secretary bot.\n\n" +
        "Open Telegram Settings → Telegram Business → Chatbots and add me, then send /login to get a dashboard link.",
    );
  });

  bot.command("login", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    if (!hasDb()) {
      await ctx.reply(
        "Dashboard is not configured (DATABASE_URL missing on the server).",
      );
      return;
    }
    const allowed = await isAllowedUser(from.id).catch(() => false);
    if (!allowed) {
      await ctx.reply(
        "ابتدا توی Telegram Settings → Telegram Business → Chatbots این بات رو وصل کن، بعد دوباره /login بزن.",
      );
      return;
    }
    const token = await createMagicToken({
      userId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      photoUrl: null,
    });
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://tgsecretarybot.vercel.app");
    const url = `${base}/login/magic?token=${encodeURIComponent(token)}`;
    await ctx.reply(
      `🔐 لینک ورود به داشبورد (۵ دقیقه اعتبار داره، یک بار مصرف):\n${url}`,
      { link_preview_options: { is_disabled: true } },
    );
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("[bot] Telegram API:", e.description);
    } else if (e instanceof HttpError) {
      console.error("[bot] network:", e);
    } else {
      console.error("[bot] uncaught:", e);
    }
  });

  return bot;
}

async function resolveOwner(bcId: string, bot: Bot): Promise<OwnerCacheEntry | null> {
  const cached = ownerCache.get(bcId);
  if (cached) return cached;

  const db = await getBusinessConnection(bcId).catch(() => null);
  if (db) {
    ownerCache.set(bcId, db);
    return db;
  }

  try {
    const bc = await bot.api.getBusinessConnection(bcId);
    const entry: OwnerCacheEntry = {
      userId: bc.user.id,
      userChatId: bc.user_chat_id,
      canReply: Boolean(bc.rights?.can_reply),
    };
    ownerCache.set(bcId, entry);
    if (hasDb()) {
      await upsertBusinessConnection({
        id: bc.id,
        userId: bc.user.id,
        userChatId: bc.user_chat_id,
        username: bc.user.username ?? null,
        firstName: bc.user.first_name ?? null,
        lastName: bc.user.last_name ?? null,
        canReply: Boolean(bc.rights?.can_reply),
        isEnabled: bc.is_enabled,
      }).catch(() => {});
    }
    return entry;
  } catch (err) {
    console.error(`[connection] api lookup failed for ${bcId}:`, err);
    return null;
  }
}

async function handleBusinessMessage(msg: Message, bot: Bot): Promise<void> {
  const bcId = msg.business_connection_id;
  if (!bcId) return;

  const owner = await resolveOwner(bcId, bot);
  const text = msg.text ?? msg.caption;
  if (!text) return;

  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
    msg.from?.username ||
    "unknown sender";
  const senderUsername = msg.from?.username ?? null;
  const chatTitle =
    "title" in msg.chat && typeof msg.chat.title === "string" ? msg.chat.title : null;

  // Owner sent this themselves: record their activity, then bail.
  if (owner && msg.from && msg.from.id === owner.userId) {
    if (hasDb()) {
      try {
        await logMessage({
          businessConnectionId: bcId,
          ownerUserId: owner.userId,
          chatId: msg.chat.id,
          chatType: msg.chat.type,
          chatTitle,
          senderId: msg.from.id,
          senderUsername,
          senderName,
          messageId: msg.message_id,
          messageText: text,
          importance: 0,
          urgent: false,
          concernsOwner: false,
          reason: "owner outgoing",
          alerted: false,
          autoReplied: false,
          fromOwner: true,
        });
      } catch (err) {
        console.error("[db] owner-log failed:", err);
      }
    }
    return;
  }

  const rule = await getChatRule(msg.chat.id).catch(() => null);
  const settings = await getSettings();

  if (rule?.muted) {
    console.log(`[mute] chat=${msg.chat.id} skipping`);
    if (hasDb()) {
      try {
        await logMessage({
          businessConnectionId: bcId,
          ownerUserId: owner?.userId ?? null,
          chatId: msg.chat.id,
          chatType: msg.chat.type,
          chatTitle,
          senderId: msg.from?.id ?? null,
          senderUsername,
          senderName,
          messageId: msg.message_id,
          messageText: text,
          importance: 0,
          urgent: false,
          concernsOwner: false,
          reason: "muted chat",
          alerted: false,
          autoReplied: false,
          skippedReason: "muted",
        });
      } catch (err) {
        console.error("[db] mute-log failed:", err);
      }
    }
    return;
  }

  // VIP bypasses the active-conversation grace period.
  if (!rule?.vip) {
    const isDm = msg.chat.type === "private";
    const graceMinutes = Number(
      isDm
        ? settings.dmActiveGraceMinutes
        : settings.groupActiveGraceMinutes,
    );
    if (graceMinutes > 0) {
      const last = await lastOwnerMessageAt(msg.chat.id).catch(() => null);
      if (last) {
        const ageMin = (Date.now() - last.getTime()) / 60_000;
        if (ageMin < graceMinutes) {
          const reason = `owner active here ${ageMin.toFixed(0)}m ago (< ${graceMinutes}m grace)`;
          console.log(`[grace] chat=${msg.chat.id} ${reason}`);
          if (hasDb()) {
            try {
              await logMessage({
                businessConnectionId: bcId,
                ownerUserId: owner?.userId ?? null,
                chatId: msg.chat.id,
                chatType: msg.chat.type,
                chatTitle,
                senderId: msg.from?.id ?? null,
                senderUsername,
                senderName,
                messageId: msg.message_id,
                messageText: text,
                importance: 0,
                urgent: false,
                concernsOwner: false,
                reason,
                alerted: false,
                autoReplied: false,
                skippedReason: "active_grace",
              });
            } catch (err) {
              console.error("[db] grace-log failed:", err);
            }
          }
          return;
        }
      }
    }
  }

  let verdict;
  try {
    verdict = await classify({
      chatType: msg.chat.type,
      chatTitle: chatTitle ?? undefined,
      senderName,
      text,
    });
  } catch (err) {
    console.error("[classify] failed:", err);
    verdict = { importance: 0, urgent: false, concernsOwner: false, reason: "classifier failed" };
  }

  if (rule?.vip) {
    verdict = {
      ...verdict,
      urgent: true,
      concernsOwner: true,
      importance: Math.max(verdict.importance, 8),
      reason: verdict.reason ? `[VIP] ${verdict.reason}` : "VIP sender",
    };
  }

  const threshold = Number(settings.importanceThreshold) || 7;
  const shouldAlert =
    verdict.urgent && verdict.concernsOwner && verdict.importance >= threshold;

  console.log(
    `[classify] imp=${verdict.importance} urg=${verdict.urgent} owner=${verdict.concernsOwner} chat=${msg.chat.type}:${msg.chat.id} from=${senderName} alert=${shouldAlert} | ${verdict.reason}`,
  );

  let alerted = false;
  let autoReplied = false;
  const chatLabel = chatTitle ?? (msg.chat.type === "private" ? `DM from ${senderName}` : `chat ${msg.chat.id}`);

  if (shouldAlert) {
    try {
      alerted = await fireAlert({
        text,
        sender: senderName,
        chat: chatLabel,
        importance: verdict.importance,
        reason: verdict.reason,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[alert] failed:", err);
    }

    const notifyChat = settings.ownerNotifyChatId;
    if (notifyChat) {
      try {
        await bot.api.sendMessage(
          notifyChat,
          `🚨 Urgent message\n` +
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

    autoReplied = await maybeAutoReply(msg, bcId, rule?.customReply ?? null, bot);
  }

  if (hasDb()) {
    try {
      await logMessage({
        businessConnectionId: bcId,
        ownerUserId: owner?.userId ?? null,
        chatId: msg.chat.id,
        chatType: msg.chat.type,
        chatTitle,
        senderId: msg.from?.id ?? null,
        senderUsername,
        senderName,
        messageId: msg.message_id,
        messageText: text,
        importance: verdict.importance,
        urgent: verdict.urgent,
        concernsOwner: verdict.concernsOwner,
        reason: verdict.reason,
        alerted,
        autoReplied,
      });
    } catch (err) {
      console.error("[db] log failed:", err);
    }
  }
}

async function maybeAutoReply(
  msg: Message,
  bcId: string,
  customReply: string | null,
  bot: Bot,
): Promise<boolean> {
  const s = await getSettings();
  if (s.autoReplyEnabled.toLowerCase() === "false") return false;
  if (msg.chat.type !== "private") return false;
  const text = customReply || s.autoReplyText;
  if (!text) return false;

  const key = `${bcId}:${msg.chat.id}`;
  const cooldownMin = Number(s.autoReplyCooldownMinutes) || 0;
  const cooldownMs = Math.max(0, cooldownMin) * 60_000;
  const last = autoReplyCache.get(key) ?? 0;
  if (cooldownMs > 0 && Date.now() - last < cooldownMs) {
    console.log(`[autoreply] cooldown chat=${msg.chat.id}`);
    return false;
  }

  try {
    await bot.api.sendMessage(msg.chat.id, text, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
    autoReplyCache.set(key, Date.now());
    console.log(`[autoreply] sent chat=${msg.chat.id}`);
    return true;
  } catch (err) {
    console.error("[autoreply] failed:", err);
    return false;
  }
}
