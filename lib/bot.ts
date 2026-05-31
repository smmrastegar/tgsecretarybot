import { Bot, GrammyError, HttpError } from "grammy";
import type { Message } from "grammy/types";
import { config } from "./config";
import { aiConversationReply, classify, friendlyAutoReply } from "./classifier";
import { sttConfigured, transcribeAudio } from "./stt";
import { fireAlert } from "./alert";
import { getSettings } from "./settings";
import {
  endSecretarySession,
  findActiveSecretarySessionForSender,
  findLinkWithSenderMessage,
  findOnlyActiveSessionForSecretary,
  findSecretaryLinkForSenderMessage,
  findSessionByLinkedMessage,
  getBusinessConnection,
  getChatMode,
  getChatRule,
  getSenderStats,
  hasDb,
  isAllowedUser,
  lastOwnerMessageAt,
  logMessage,
  openSecretarySession,
  recentConversation,
  recordSecretaryLink,
  touchSecretarySession,
  upsertBusinessConnection,
  type ChatMode,
  type SecretarySession,
} from "./db";
import type { MessageReactionUpdated, ReactionType } from "grammy/types";
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
  "message_reaction",
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

  bot.on("message", async (ctx) => {
    await handleSecretaryReply(ctx.update.message, bot).catch((err) =>
      console.error("[secretary] handler error:", err),
    );
  });

  bot.on("message_reaction", async (ctx) => {
    await handleSecretaryReaction(ctx.update.message_reaction, bot).catch(
      (err) => console.error("[secretary] reaction error:", err),
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
  const text = describeMessage(msg);
  const hasContent = Boolean(
    msg.text ||
      msg.caption ||
      msg.photo ||
      msg.video ||
      msg.voice ||
      msg.audio ||
      msg.document ||
      msg.animation ||
      msg.sticker ||
      msg.video_note,
  );
  if (!hasContent) return;

  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
    msg.from?.username ||
    "unknown sender";
  const senderUsername = msg.from?.username ?? null;
  const chatTitle =
    "title" in msg.chat && typeof msg.chat.title === "string" ? msg.chat.title : null;

  const media = extractMedia(msg);
  const mediaFileId = media?.fileId ?? null;
  const mediaKind = media?.kind ?? null;

  // Owner sent this themselves: record their activity, close any open
  // secretary session for this chat, then bail.
  if (owner && msg.from && msg.from.id === owner.userId) {
    const active = await findActiveSecretarySessionForSender({
      bcId,
      senderChatId: msg.chat.id,
      idleMinutes: 24 * 60,
    }).catch(() => null);
    if (active) {
      await endSecretarySession(active.id, "owner took over").catch(() => {});
      try {
        await bot.api.sendMessage(
          active.secretaryChatId,
          `🔚 Owner stepped in for ${active.senderName ?? "this thread"}. Session closed.`,
          { reply_parameters: { message_id: active.headerMessageId } },
        );
      } catch (err) {
        console.error("[secretary] takeover notice failed:", err);
      }
    }
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
          mediaFileId,
          mediaKind,
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
          mediaFileId,
          mediaKind,
        });
      } catch (err) {
        console.error("[db] mute-log failed:", err);
      }
    }
    return;
  }

  // If a secretary session is already open for this sender, every message
  // (text or media, urgent-classified or not) gets relayed through, and the
  // urgent-classification / alert flow is skipped.
  const secEnabled =
    (settings.secretaryEnabled ?? "false").toLowerCase() === "true";
  const secId = Number(settings.secretaryUserId);
  if (
    secEnabled &&
    Number.isFinite(secId) &&
    secId > 0 &&
    hasDb() &&
    msg.chat.type === "private"
  ) {
    const idleMin = Math.max(
      Number(settings.secretarySessionMinutes) || 120,
      1,
    );
    const openSession = await findActiveSecretarySessionForSender({
      bcId,
      senderChatId: msg.chat.id,
      idleMinutes: idleMin,
    }).catch(() => null);
    if (openSession) {
      await maybeForwardToSecretary({
        msg,
        bcId,
        senderName,
        senderUsername,
        chatTitle,
        owner,
        settings,
        bot,
        knownSession: openSession,
      });
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
          reason: "secretary session active",
          alerted: false,
          autoReplied: false,
          skippedReason: "secretary_relay",
          mediaFileId,
          mediaKind,
        });
      } catch (err) {
        console.error("[db] relay-log failed:", err);
      }
      return;
    }
  }

  // Past this point the classify+alert path requires actual text.
  if (!msg.text && !msg.caption) {
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
                mediaFileId,
                mediaKind,
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

  const mode: ChatMode = rule?.mode ?? "secretary";
  const isDmPrivate = msg.chat.type === "private";

  // Alerts fire on urgent regardless of mode (except "off").
  if (shouldAlert && mode !== "off") {
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
          `🚨 Urgent (mode: ${mode})\n` +
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

  // Mode-based response path (DMs only; groups stay log-only).
  if (isDmPrivate) {
    if (mode === "secretary" && shouldAlert) {
      const secretaryHandled = await maybeForwardToSecretary({
        msg,
        bcId,
        senderName,
        senderUsername,
        chatTitle,
        owner,
        settings,
        bot,
      });
      const suppressAuto =
        secretaryHandled &&
        (settings.secretarySuppressAutoReply ?? "true").toLowerCase() !== "false";
      if (!suppressAuto) {
        autoReplied = await maybeAutoReply(
          msg,
          bcId,
          rule?.customReply ?? null,
          bot,
        );
      }
    } else if (mode === "auto_reply") {
      autoReplied = await maybeAutoReply(
        msg,
        bcId,
        rule?.customReply ?? null,
        bot,
      );
    } else if (mode === "friendly_reply") {
      autoReplied = await sendFriendlyReply({
        msg,
        bcId,
        senderName,
        settings,
        customReply: rule?.customReply ?? null,
        bot,
      });
    } else if (mode === "ai_chat") {
      autoReplied = await sendAiConversation({
        msg,
        bcId,
        senderName,
        settings,
        bot,
      });
    }
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
        mediaFileId,
        mediaKind,
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

function relTime(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toISOString().slice(0, 10);
}

async function buildSecretaryHeader(args: {
  senderName: string;
  senderUsername: string | null;
  senderId: number | null;
  chatId: number;
  ownerName: string;
}): Promise<string> {
  const handle = args.senderUsername ? ` (@${args.senderUsername})` : "";
  const title = `👤 ${args.senderName}${handle}`;

  const tags: string[] = [];
  let footer = "";
  try {
    const [rule, stats] = await Promise.all([
      getChatRule(args.chatId).catch(() => null),
      getSenderStats(args.chatId).catch(() => null),
    ]);

    if (rule?.vip) tags.push("⭐ VIP");
    if (rule?.muted) tags.push("🔕 muted");
    if (stats) {
      if (stats.priorCount > 1) {
        tags.push(`${stats.priorCount} prior msg${stats.priorCount === 1 ? "" : "s"}`);
      }
      if (stats.urgentCount > 0) {
        tags.push(`${stats.urgentCount}× urgent`);
      }
      if (stats.firstSeen) {
        tags.push(`known since ${relTime(stats.firstSeen)}`);
      }
    }
    if (rule?.notes) {
      footer += `\n📝 ${rule.notes}`;
    }
    if (rule?.customReply) {
      footer += `\n💬 custom reply set for this chat`;
    }
  } catch {
    // best-effort header enrichment; ignore failures
  }

  const idLine = args.senderId
    ? `\n🆔 user ${args.senderId}`
    : `\n🆔 chat ${args.chatId}`;
  const meta = tags.length > 0 ? `\n${tags.join(" · ")}` : "";
  const instructions =
    `\n\n↩️ Reply to any message in this thread to respond as ${args.ownerName}.`;

  return title + idLine + meta + footer + instructions;
}

function extractMedia(
  msg: Message,
): { fileId: string; kind: string } | null {
  if (msg.voice) return { fileId: msg.voice.file_id, kind: "voice" };
  if (msg.audio) return { fileId: msg.audio.file_id, kind: "audio" };
  if (msg.video_note)
    return { fileId: msg.video_note.file_id, kind: "video_note" };
  if (msg.video) return { fileId: msg.video.file_id, kind: "video" };
  if (msg.document)
    return { fileId: msg.document.file_id, kind: "document" };
  if (msg.photo && msg.photo.length > 0) {
    const biggest = msg.photo[msg.photo.length - 1];
    if (biggest) return { fileId: biggest.file_id, kind: "photo" };
  }
  if (msg.animation)
    return { fileId: msg.animation.file_id, kind: "animation" };
  if (msg.sticker) return { fileId: msg.sticker.file_id, kind: "sticker" };
  return null;
}

function describeMessage(msg: Message): string {
  if (msg.text) return msg.text;
  if (msg.caption) return msg.caption;
  if (msg.photo) return "[photo]";
  if (msg.video) return "[video]";
  if (msg.voice) return "[voice]";
  if (msg.audio) return "[audio]";
  if (msg.document) return `[document: ${msg.document.file_name ?? "file"}]`;
  if (msg.animation) return "[animation]";
  if (msg.sticker)
    return `[sticker${msg.sticker.emoji ? " " + msg.sticker.emoji : ""}]`;
  if (msg.video_note) return "[video note]";
  if (msg.location) return "[location]";
  if (msg.contact) return "[contact]";
  if (msg.venue) return `[venue: ${msg.venue.title}]`;
  if (msg.dice) return `[dice ${msg.dice.emoji}]`;
  if (msg.poll) return `[poll: ${msg.poll.question.slice(0, 60)}]`;
  if (msg.story) return "[story]";
  if (msg.paid_media) return "[paid media]";
  return "[media]";
}

type SendCommon = {
  business_connection_id?: string;
  reply_parameters?: { message_id: number };
};

async function relayAnyMessage(args: {
  bot: Bot;
  source: Message;
  toChatId: number;
  captionPrefix?: string;
  businessConnectionId?: string;
  replyToMessageId?: number;
}): Promise<number[]> {
  const { bot, source, toChatId, captionPrefix, businessConnectionId, replyToMessageId } = args;
  const opts: SendCommon = {};
  if (businessConnectionId) opts.business_connection_id = businessConnectionId;
  if (replyToMessageId !== undefined) opts.reply_parameters = { message_id: replyToMessageId };

  const prefix = captionPrefix ?? "";
  const captionWith = (raw?: string | null): string | undefined => {
    const text = prefix + (raw ?? "");
    return text ? text.slice(0, 1024) : undefined;
  };

  const sent: number[] = [];

  if (source.text) {
    const text = (prefix + source.text).slice(0, 4096);
    const m = await bot.api.sendMessage(toChatId, text, opts);
    sent.push(m.message_id);
    return sent;
  }
  if (source.photo && source.photo.length > 0) {
    const biggest = source.photo[source.photo.length - 1];
    if (biggest) {
      const m = await bot.api.sendPhoto(toChatId, biggest.file_id, {
        ...opts,
        caption: captionWith(source.caption),
      });
      sent.push(m.message_id);
    }
    return sent;
  }
  if (source.video) {
    const m = await bot.api.sendVideo(toChatId, source.video.file_id, {
      ...opts,
      caption: captionWith(source.caption),
    });
    sent.push(m.message_id);
    return sent;
  }
  if (source.voice) {
    const m = await bot.api.sendVoice(toChatId, source.voice.file_id, {
      ...opts,
      caption: captionWith(source.caption),
    });
    sent.push(m.message_id);
    return sent;
  }
  if (source.audio) {
    const m = await bot.api.sendAudio(toChatId, source.audio.file_id, {
      ...opts,
      caption: captionWith(source.caption),
    });
    sent.push(m.message_id);
    return sent;
  }
  if (source.document) {
    const m = await bot.api.sendDocument(toChatId, source.document.file_id, {
      ...opts,
      caption: captionWith(source.caption),
    });
    sent.push(m.message_id);
    return sent;
  }
  if (source.animation) {
    const m = await bot.api.sendAnimation(toChatId, source.animation.file_id, {
      ...opts,
      caption: captionWith(source.caption),
    });
    sent.push(m.message_id);
    return sent;
  }
  if (source.sticker) {
    if (prefix.trim()) {
      const header = await bot.api.sendMessage(
        toChatId,
        `${prefix}[sticker${source.sticker.emoji ? " " + source.sticker.emoji : ""}]`,
        opts,
      );
      sent.push(header.message_id);
    }
    const m = await bot.api.sendSticker(toChatId, source.sticker.file_id, opts);
    sent.push(m.message_id);
    return sent;
  }
  if (source.video_note) {
    if (prefix.trim()) {
      const header = await bot.api.sendMessage(toChatId, `${prefix}[video note]`, opts);
      sent.push(header.message_id);
    }
    const m = await bot.api.sendVideoNote(toChatId, source.video_note.file_id, opts);
    sent.push(m.message_id);
    return sent;
  }
  if (source.location) {
    const m = await bot.api.sendLocation(
      toChatId,
      source.location.latitude,
      source.location.longitude,
      opts,
    );
    sent.push(m.message_id);
    return sent;
  }
  if (source.contact) {
    const m = await bot.api.sendContact(
      toChatId,
      source.contact.phone_number,
      source.contact.first_name,
      {
        ...opts,
        last_name: source.contact.last_name,
        vcard: source.contact.vcard,
      },
    );
    sent.push(m.message_id);
    return sent;
  }
  if (source.dice) {
    const m = await bot.api.sendDice(toChatId, source.dice.emoji, opts);
    sent.push(m.message_id);
    return sent;
  }
  if (source.venue) {
    const v = source.venue;
    const m = await bot.api.sendVenue(
      toChatId,
      v.location.latitude,
      v.location.longitude,
      v.title,
      v.address,
      opts,
    );
    sent.push(m.message_id);
    return sent;
  }
  if (source.poll) {
    const text = `${prefix}[poll] ${source.poll.question}`.slice(0, 4096);
    const m = await bot.api.sendMessage(toChatId, text, opts);
    sent.push(m.message_id);
    return sent;
  }
  // Unknown / unhandled type: log and stay silent (no noisy placeholder).
  const keys = Object.keys(source).filter(
    (k) =>
      ![
        "message_id",
        "date",
        "chat",
        "from",
        "business_connection_id",
        "reply_to_message",
        "edit_date",
      ].includes(k),
  );
  console.warn(
    `[relay] no handler for message type; payload keys: ${keys.join(", ")}`,
  );
  return sent;
}

async function maybeForwardToSecretary(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  senderUsername: string | null;
  chatTitle: string | null;
  owner: OwnerCacheEntry | null;
  settings: Awaited<ReturnType<typeof getSettings>>;
  bot: Bot;
  knownSession?: SecretarySession | null;
}): Promise<boolean> {
  const { msg, bcId, senderName, senderUsername, owner, settings, bot } = args;
  if (msg.chat.type !== "private") return false;
  const enabled = (settings.secretaryEnabled ?? "false").toLowerCase() === "true";
  if (!enabled) return false;
  const secId = Number(settings.secretaryUserId);
  if (!Number.isFinite(secId) || secId <= 0) return false;
  if (!hasDb()) return false;
  if (owner && secId === owner.userId) return false;

  const idleMin = Math.max(Number(settings.secretarySessionMinutes) || 120, 1);
  let session =
    args.knownSession ??
    (await findActiveSecretarySessionForSender({
      bcId,
      senderChatId: msg.chat.id,
      idleMinutes: idleMin,
    }).catch(() => null));

  try {
    if (!session) {
      const headerText = await buildSecretaryHeader({
        senderName,
        senderUsername,
        senderId: msg.from?.id ?? null,
        chatId: msg.chat.id,
        ownerName: settings.ownerName || "the owner",
      });
      const header = await bot.api.sendMessage(secId, headerText);
      session = await openSecretarySession({
        businessConnectionId: bcId,
        senderChatId: msg.chat.id,
        senderName,
        senderUsername,
        secretaryUserId: secId,
        secretaryChatId: secId,
        headerMessageId: header.message_id,
        ownerUserId: owner?.userId ?? null,
      });
      await recordSecretaryLink({
        sessionId: session.id,
        secretaryChatId: secId,
        secretaryMessageId: header.message_id,
        direction: "inbound",
      });
    }

    const ids = await relayAnyMessage({
      bot,
      source: msg,
      toChatId: secId,
      captionPrefix: `📩 ${senderName}: `,
      replyToMessageId: session.headerMessageId,
    });
    for (const id of ids) {
      await recordSecretaryLink({
        sessionId: session.id,
        secretaryChatId: secId,
        secretaryMessageId: id,
        direction: "inbound",
        senderMessageId: msg.message_id,
      });
    }
    await touchSecretarySession(session.id);
    console.log(
      `[secretary] forwarded sender=${msg.chat.id} session=${session.id} parts=${ids.length}`,
    );

    // Auto-transcribe voice/audio/video_note so the secretary doesn't have
    // to play them. Best-effort; failures are logged but don't break the
    // forward.
    const autoTranscribe =
      (settings.secretaryAutoTranscribe ?? "true").toLowerCase() !== "false";
    if (autoTranscribe && sttConfigured()) {
      const audioFileId =
        msg.voice?.file_id ??
        msg.audio?.file_id ??
        msg.video_note?.file_id ??
        null;
      if (audioFileId) {
        const lastSecretaryMsgId = ids[ids.length - 1] ?? session.headerMessageId;
        try {
          const tr = await transcribeAudio({
            botToken: config.telegramBotToken,
            fileId: audioFileId,
            chatId: msg.chat.id,
            businessConnectionId: bcId,
          });
          if (tr.text) {
            const sent = await bot.api.sendMessage(
              secId,
              `📝 transcript:\n${tr.text}`.slice(0, 4096),
              { reply_parameters: { message_id: lastSecretaryMsgId } },
            );
            await recordSecretaryLink({
              sessionId: session.id,
              secretaryChatId: secId,
              secretaryMessageId: sent.message_id,
              direction: "inbound",
              senderMessageId: msg.message_id,
            });
          }
        } catch (err) {
          console.error("[secretary] auto-transcribe failed:", err);
        }
      }
    }

    return true;
  } catch (err) {
    const e = err as { error_code?: number; description?: string };
    if (e?.error_code === 403) {
      console.error(
        `[secretary] cannot DM secretary ${secId}: bot is blocked or /start was never sent.`,
      );
    } else {
      console.error("[secretary] forward failed:", err);
    }
    return false;
  }
}

async function handleSecretaryReply(msg: Message, bot: Bot): Promise<void> {
  if (msg.chat.type !== "private") return;
  if (!msg.from) return;
  if (msg.text && msg.text.startsWith("/")) return;
  if (!hasDb()) return;

  const settings = await getSettings();
  const enabled = (settings.secretaryEnabled ?? "false").toLowerCase() === "true";
  if (!enabled) return;
  const secId = Number(settings.secretaryUserId);
  if (!Number.isFinite(secId) || secId <= 0) return;
  if (msg.from.id !== secId) return;

  const idleMin = Math.max(Number(settings.secretarySessionMinutes) || 120, 1);
  let session: SecretarySession | null = null;
  const replyTo = msg.reply_to_message;
  if (replyTo) {
    session = await findSessionByLinkedMessage(msg.chat.id, replyTo.message_id).catch(
      () => null,
    );
  }
  if (!session) {
    session = await findOnlyActiveSessionForSecretary(secId, idleMin).catch(() => null);
  }
  if (!session) {
    await bot.api.sendMessage(
      msg.chat.id,
      "No active thread to relay to. Reply to a forwarded message to respond.",
      { reply_parameters: { message_id: msg.message_id } },
    );
    return;
  }
  if (session.endedAt) {
    await bot.api.sendMessage(
      msg.chat.id,
      "That thread is closed (owner took over or it expired).",
      { reply_parameters: { message_id: msg.message_id } },
    );
    return;
  }

  try {
    const sentIds = await relayAnyMessage({
      bot,
      source: msg,
      toChatId: session.senderChatId,
      businessConnectionId: session.businessConnectionId,
    });
    await recordSecretaryLink({
      sessionId: session.id,
      secretaryChatId: msg.chat.id,
      secretaryMessageId: msg.message_id,
      direction: "outbound",
      senderMessageId: sentIds[0] ?? null,
    });
    await touchSecretarySession(session.id);
    try {
      await bot.api.setMessageReaction(msg.chat.id, msg.message_id, [
        { type: "emoji", emoji: "👍" },
      ]);
    } catch {
      // older clients may reject; ignore
    }
    console.log(
      `[secretary] relayed session=${session.id} to chat=${session.senderChatId} parts=${sentIds.length}`,
    );
  } catch (err) {
    console.error("[secretary] relay failed:", err);
    await bot.api
      .sendMessage(
        msg.chat.id,
        `❌ Failed to relay: ${String(err).slice(0, 200)}`,
        { reply_parameters: { message_id: msg.message_id } },
      )
      .catch(() => {});
  }
}

async function handleSecretaryReaction(
  upd: MessageReactionUpdated,
  bot: Bot,
): Promise<void> {
  if (!upd.user) return;
  if (!hasDb()) return;

  const settings = await getSettings();
  if ((settings.secretaryEnabled ?? "false").toLowerCase() !== "true") return;
  const secId = Number(settings.secretaryUserId);
  if (!Number.isFinite(secId) || secId <= 0) return;

  // Direction A: reaction inside a business chat (the sender reacted to a
  // message). Relay it to the corresponding message in the secretary's chat
  // so the secretary can see what got reacted to.
  const bcId =
    (upd as unknown as { business_connection_id?: string })
      .business_connection_id ?? null;
  if (bcId) {
    if (upd.user.id === secId) return;
    const link = await findSecretaryLinkForSenderMessage(
      bcId,
      upd.chat.id,
      upd.message_id,
    ).catch(() => null);
    if (!link) return;
    try {
      await bot.api.setMessageReaction(
        link.session.secretaryChatId,
        link.secretaryMessageId,
        (upd.new_reaction ?? []) as ReactionType[],
      );
      console.log(
        `[reaction] sender→secretary session=${link.session.id} msg=${link.secretaryMessageId}`,
      );
    } catch (err) {
      console.error("[reaction] sender→secretary failed:", err);
    }
    return;
  }

  // Direction B: reaction in the secretary's bot DM. Relay it to the original
  // sender's message in the business chat.
  if (upd.chat.type !== "private") return;
  if (upd.user.id !== secId) return;

  const link = await findLinkWithSenderMessage(upd.chat.id, upd.message_id).catch(
    () => null,
  );
  if (!link) return;
  if (link.endedAt) return;
  if (!link.senderMessageIdLinked) return;

  const newReactions = (upd.new_reaction ?? []) as ReactionType[];

  try {
    await bot.api.setMessageReaction(
      link.senderChatId,
      link.senderMessageIdLinked,
      newReactions,
      { business_connection_id: link.businessConnectionId } as Parameters<
        typeof bot.api.setMessageReaction
      >[3],
    );
    await touchSecretarySession(link.id);
    console.log(
      `[reaction] relayed session=${link.id} to chat=${link.senderChatId} msg=${link.senderMessageIdLinked} count=${newReactions.length}`,
    );
    return;
  } catch (err) {
    console.warn(
      "[reaction] setMessageReaction via business failed, trying text fallback:",
      err,
    );
  }

  const emojis = newReactions
    .filter((r) => r.type === "emoji")
    .map((r) => (r as { type: "emoji"; emoji: string }).emoji)
    .join(" ");
  if (!emojis) return;
  try {
    await bot.api.sendMessage(link.senderChatId, emojis, {
      business_connection_id: link.businessConnectionId,
      reply_parameters: { message_id: link.senderMessageIdLinked },
    });
    await touchSecretarySession(link.id);
    console.log(
      `[reaction] relayed as text session=${link.id} to chat=${link.senderChatId}`,
    );
  } catch (err) {
    console.error("[reaction] text fallback failed:", err);
  }
}

async function sendFriendlyReply(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  customReply: string | null;
  bot: Bot;
}): Promise<boolean> {
  const { msg, bcId, senderName, settings, customReply, bot } = args;
  if (msg.chat.type !== "private") return false;
  const awayMessage = customReply || settings.autoReplyText;
  if (!awayMessage) return false;

  const key = `${bcId}:${msg.chat.id}`;
  const cooldownMs =
    Math.max(0, Number(settings.autoReplyCooldownMinutes) || 0) * 60_000;
  const last = autoReplyCache.get(key) ?? 0;
  if (cooldownMs > 0 && Date.now() - last < cooldownMs) return false;

  let history: Awaited<ReturnType<typeof recentConversation>> = [];
  try {
    history = await recentConversation(msg.chat.id, 20);
  } catch (err) {
    console.error("[friendly] history fetch failed:", err);
  }

  let text = awayMessage;
  try {
    text =
      (await friendlyAutoReply({
        ownerName: settings.ownerName,
        ownerDisplayName: settings.ownerDisplayName,
        ownerContext: settings.ownerContext,
        senderName,
        awayMessage,
        history,
        chatId: msg.chat.id,
        businessConnectionId: bcId,
      })) || awayMessage;
  } catch (err) {
    console.error("[friendly] AI failed; falling back to literal:", err);
  }

  try {
    await bot.api.sendMessage(msg.chat.id, text, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
    autoReplyCache.set(key, Date.now());
    return true;
  } catch (err) {
    console.error("[friendly] send failed:", err);
    return false;
  }
}

async function sendAiConversation(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  bot: Bot;
}): Promise<boolean> {
  const { msg, bcId, senderName, settings, bot } = args;
  if (msg.chat.type !== "private") return false;
  const userText = msg.text ?? msg.caption;
  if (!userText) return false;

  let history: Awaited<ReturnType<typeof recentConversation>> = [];
  try {
    history = await recentConversation(msg.chat.id, 40);
  } catch (err) {
    console.error("[ai_chat] history fetch failed:", err);
  }

  let reply = "";
  try {
    reply = await aiConversationReply({
      ownerName: settings.ownerName,
      ownerDisplayName: settings.ownerDisplayName,
      ownerContext: settings.ownerContext,
      senderName,
      history,
      chatId: msg.chat.id,
      businessConnectionId: bcId,
    });
  } catch (err) {
    console.error("[ai_chat] generation failed:", err);
    return false;
  }
  if (!reply) return false;

  try {
    await bot.api.sendMessage(msg.chat.id, reply, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
    return true;
  } catch (err) {
    console.error("[ai_chat] send failed:", err);
    return false;
  }
}
