import { Bot, GrammyError, HttpError } from "grammy";
import type { Message } from "grammy/types";
import { config } from "./config";
import {
  aiConversationReply,
  classify,
  extractActions,
  friendlyAutoReply,
} from "./classifier";
import { sttConfigured, transcribeAudio } from "./stt";
import {
  defaultSecretary,
  getSecretaries,
  type Secretary,
} from "./secretaries";
import { redisDelete, redisEnabled, redisGet, redisSet } from "./redis";
import { fireAlert } from "./alert";
import { getSettings, invalidateSettingsCache, updateSettings } from "./settings";
import {
  autoFillChatNames,
  consumeInvite,
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
  saveExtractedItems,
  touchSecretarySession,
  upsertBusinessConnection,
  audit,
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

async function getAutoReplyLast(key: string): Promise<number> {
  if (redisEnabled()) {
    const v = await redisGet<number>(`tgsb:autoreply:${key}`);
    if (typeof v === "number") return v;
  }
  return autoReplyCache.get(key) ?? 0;
}

async function setAutoReplyLast(key: string, ttlSeconds: number): Promise<void> {
  const now = Date.now();
  autoReplyCache.set(key, now);
  if (redisEnabled()) {
    await redisSet(`tgsb:autoreply:${key}`, now, Math.max(ttlSeconds, 60));
  }
}

function chatTitleOf(msg: Message): string | null {
  const chat = msg.chat as { title?: unknown };
  return typeof chat.title === "string" ? chat.title : null;
}

async function logOwnerSent(args: {
  bcId: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  ownerUserId: number | null;
  sentMessageId: number;
  text: string;
  source: string;
  ownerLabel: string;
  mediaKind?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  try {
    await logMessage({
      businessConnectionId: args.bcId,
      ownerUserId: args.ownerUserId,
      chatId: args.chatId,
      chatType: args.chatType,
      chatTitle: args.chatTitle,
      senderId: args.ownerUserId,
      senderUsername: null,
      senderName: args.ownerLabel,
      messageId: args.sentMessageId,
      messageText: args.text,
      importance: 0,
      urgent: false,
      concernsOwner: false,
      reason: `outgoing via ${args.source}`,
      alerted: false,
      autoReplied: false,
      fromOwner: true,
      mediaKind: args.mediaKind ?? null,
      source: args.source,
    });
  } catch (err) {
    console.error(`[db] logOwnerSent (${args.source}) failed:`, err);
  }
}

async function autoExtractAndSave(args: {
  text: string;
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  messageId: number;
  businessConnectionId: string;
}): Promise<void> {
  if (!hasDb()) return;
  const s = await getSettings();
  if ((s.autoExtractEnabled ?? "true").toLowerCase() === "false") return;
  try {
    const items = await extractActions({
      text: args.text,
      senderName: args.senderName,
      chatId: args.chatId,
      businessConnectionId: args.businessConnectionId,
    });
    const valid = items
      .filter((it) => it && typeof it.title === "string" && it.title.trim())
      .map((it) => ({
        messageId: null, // we don't have messages_log.id here; link via chat/message_id is enough
        tgMessageId: args.messageId,
        chatId: args.chatId,
        chatTitle: args.chatTitle,
        senderName: args.senderName,
        kind: typeof it.kind === "string" ? it.kind : "note",
        title: it.title.trim().slice(0, 200),
        description: it.description ?? null,
        dueAt: it.due_at ? safeDate(it.due_at) : null,
        location: it.location ?? null,
        participants:
          Array.isArray(it.participants) &&
          it.participants.every((p) => typeof p === "string")
            ? (it.participants as string[])
            : null,
        sourceText: args.text.slice(0, 4000),
      }));
    if (valid.length > 0) {
      await saveExtractedItems(valid);
      console.log(
        `[extract] auto-saved ${valid.length} item${valid.length === 1 ? "" : "s"} from chat=${args.chatId}`,
      );
    }
  } catch (err) {
    console.error("[extract] auto failed:", err);
  }
}

function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function markBusinessRead(
  bot: Bot,
  bcId: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  const s = await getSettings();
  if ((s.markMessagesAsRead ?? "true").toLowerCase() === "false") return;
  try {
    await bot.api.readBusinessMessage(bcId, chatId, messageId);
  } catch (err) {
    const e = err as { error_code?: number; description?: string };
    if (e?.error_code === 400 || e?.error_code === 403) {
      console.warn(
        `[read] cannot mark message read (likely missing can_read_messages right): ${e.description}`,
      );
    } else {
      console.error("[read] failed:", err);
    }
  }
}

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
    const from = ctx.from;
    const arg = ctx.match?.toString().trim() ?? "";

    if (arg.startsWith("inv") && from && hasDb()) {
      const invite = await consumeInvite(arg, from.id).catch(() => null);
      if (!invite || invite.purpose !== "secretary_invite") {
        await ctx.reply(
          "این لینک دعوت معتبر نیست یا منقضی شده. از صاحب اکانت لینک جدید بخواه.",
        );
        return;
      }
      const ownerName =
        (invite.payload as { ownerName?: string }).ownerName ?? "the owner";

      const settings = await getSettings();
      let list: Array<{ userId: number; name: string }> = [];
      try {
        const raw = settings.secretariesJson?.trim();
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            list = parsed
              .map((s) => {
                const o = s as { userId?: unknown; name?: unknown };
                const id = Number(o.userId);
                if (!Number.isFinite(id) || id <= 0) return null;
                return {
                  userId: id,
                  name:
                    typeof o.name === "string" && o.name
                      ? o.name
                      : `user ${id}`,
                };
              })
              .filter((x): x is { userId: number; name: string } => x !== null);
          }
        }
        // Migrate legacy single secretary into the list if it's still in use.
        const legacyId = Number(settings.secretaryUserId);
        if (
          list.length === 0 &&
          Number.isFinite(legacyId) &&
          legacyId > 0 &&
          legacyId !== from.id
        ) {
          list.push({
            userId: legacyId,
            name: settings.secretaryDisplayName || "Secretary",
          });
        }
      } catch (err) {
        console.error("[invite] parse secretaries failed:", err);
      }

      if (list.some((s) => s.userId === from.id)) {
        await ctx.reply(
          `سلام ${from.first_name ?? "دوست عزیز"} 👋\nشما از قبل به‌عنوان منشی ${ownerName} ثبت هستید. وقتی پیام فوری از طرف ایشون باشه براتون فروارد می‌کنم.`,
        );
        return;
      }
      const name =
        [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
        from.username ||
        `user ${from.id}`;
      list.push({ userId: from.id, name });

      try {
        await updateSettings(
          { secretariesJson: JSON.stringify(list) },
          (invite.payload as { invitedBy?: number }).invitedBy,
        );
      } catch (err) {
        console.error("[invite] updateSettings failed:", err);
        await ctx.reply(
          "ثبت موفق نبود. لطفاً به صاحب اکانت بگید تا دوباره لینک بفرسته.",
        );
        return;
      }
      invalidateSettingsCache();
      await audit({
        actorId: from.id,
        actorName: name,
        action: "secretary.joined",
        target: arg,
        details: { invitedBy: (invite.payload as { invitedBy?: number }).invitedBy },
      }).catch(() => {});
      await ctx.reply(
        `✅ خوش اومدی ${name}!\nاز این به بعد به‌عنوان منشی ${ownerName} ثبت شدی. وقتی پیام فوری براشون بیاد، اینجا براتون فروارد می‌کنم. روی پیام reply بزن تا از طرف ایشون جواب بفرستی.`,
      );
      return;
    }

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

  // When the bot itself sends a message via business_connection_id (e.g.
  // an ai_chat / auto_reply / friendly_reply / secretary relay), Telegram
  // echoes the message back as a business_message update with
  // sender_business_bot set. Without this guard we'd treat that echo as a
  // brand-new incoming message and reply again, looping forever.
  if (
    (msg as unknown as { sender_business_bot?: unknown }).sender_business_bot
  ) {
    if (hasDb()) {
      const senderName =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
        msg.from?.username ||
        "owner";
      try {
        await logMessage({
          businessConnectionId: bcId,
          ownerUserId: owner?.userId ?? null,
          chatId: msg.chat.id,
          chatType: msg.chat.type,
          chatTitle:
            "title" in msg.chat && typeof msg.chat.title === "string"
              ? msg.chat.title
              : null,
          senderId: msg.from?.id ?? null,
          senderUsername: msg.from?.username ?? null,
          senderName,
          messageId: msg.message_id,
          messageText: describeMessage(msg),
          importance: 0,
          urgent: false,
          concernsOwner: false,
          reason: "bot outgoing (business)",
          alerted: false,
          autoReplied: false,
          fromOwner: true,
          // Tag the source so lastOwnerMessageAt can tell this apart from
          // a message the owner actually typed — otherwise the bot's own
          // AI/auto reply would trigger the active-conversation grace
          // window and block the next reply.
          source: "bot_echo",
        });
      } catch (err) {
        console.error("[db] bot-outgoing-log failed:", err);
      }
    }
    return;
  }

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

  // Best-effort auto-fill of per-chat first/last name from the sender's
  // Telegram profile, only when the owner hasn't set them yet.
  if (msg.chat.type === "private" && msg.from) {
    autoFillChatNames({
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      firstName: msg.from.first_name ?? null,
      lastName: msg.from.last_name ?? null,
    }).catch((err) => console.error("[db] autoFillChatNames failed:", err));
  }

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
  // urgent-classification / alert flow is skipped — but ONLY when this
  // chat is still in 'secretary' mode. If the owner switched the chat to
  // another mode (auto_reply / friendly / ai_chat / off), any leftover
  // session is closed first so the new mode can run.
  const currentMode: ChatMode = rule?.mode ?? "off";
  const secEnabled =
    (settings.secretaryEnabled ?? "false").toLowerCase() === "true";
  const defaultSec = defaultSecretary(settings);
  if (
    secEnabled &&
    defaultSec !== null &&
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
      if (currentMode !== "secretary") {
        await endSecretarySession(openSession.id, `mode switched to ${currentMode}`).catch(
          () => {},
        );
        try {
          await bot.api.sendMessage(
            openSession.secretaryChatId,
            `🔚 Mode changed to "${currentMode}" for ${openSession.senderName ?? "this chat"}. Session closed; AI / auto-reply will handle from here.`,
            { reply_parameters: { message_id: openSession.headerMessageId } },
          );
        } catch (err) {
          console.error("[secretary] mode-switch notice failed:", err);
        }
      } else {
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
  }

  // Past this point we'd normally need text/caption to classify. But media
  // (voice, photo, sticker, GIF, video, …) without a caption is still real
  // content the owner should see in All Messages / chat detail, and in
  // secretary mode it should also reach the secretary's thread.
  if (!msg.text && !msg.caption) {
    let forwardedToSecretary = false;
    const secEnabled =
      (settings.secretaryEnabled ?? "false").toLowerCase() === "true";
    const mode: ChatMode = rule?.mode ?? "off";
    if (
      secEnabled &&
      mode === "secretary" &&
      msg.chat.type === "private" &&
      hasDb()
    ) {
      forwardedToSecretary = await maybeForwardToSecretary({
        msg,
        bcId,
        senderName,
        senderUsername,
        chatTitle,
        owner,
        settings,
        bot,
      });
    }
    // Always log so the message appears in All Messages / chat detail
    // regardless of mode.
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
          reason: forwardedToSecretary
            ? "media forwarded to secretary"
            : `media (${mediaKind ?? "no text"})`,
          alerted: false,
          autoReplied: forwardedToSecretary,
          skippedReason: forwardedToSecretary
            ? "secretary_relay"
            : "media_no_text",
          mediaFileId,
          mediaKind,
        });
      } catch (err) {
        console.error("[db] media-log failed:", err);
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
      // Owner explicitly clicked "Resume bot now" after their last message
      // — the grace window is dismissed until they speak again.
      const graceDismissed =
        !!rule?.graceSkippedAt && (!last || rule.graceSkippedAt > last);
      if (last && !graceDismissed) {
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

  // Auto-extract events / tasks / reminders for messages that look meaningful.
  const extractMin = Number(settings.autoExtractMinImportance) || 4;
  if (
    (msg.text || msg.caption) &&
    !msg.from?.is_bot &&
    verdict.importance >= extractMin
  ) {
    // Fire and forget — the AI call shouldn't delay other handlers, and a
    // failed extraction shouldn't break the reply path.
    void autoExtractAndSave({
      text: text,
      chatId: msg.chat.id,
      chatTitle,
      senderName,
      messageId: msg.message_id,
      businessConnectionId: bcId,
    });
  }

  let alerted = false;
  let autoReplied = false;
  const chatLabel = chatTitle ?? (msg.chat.type === "private" ? `DM from ${senderName}` : `chat ${msg.chat.id}`);

  const mode: ChatMode = rule?.mode ?? "off";
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
        nickname: rule?.nickname ?? null,
        relationship: rule?.relationship ?? null,
        bot,
      });
    } else if (mode === "ai_chat") {
      autoReplied = await sendAiConversation({
        msg,
        bcId,
        senderName,
        settings,
        nickname: rule?.nickname ?? null,
        relationship: rule?.relationship ?? null,
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
  const last = await getAutoReplyLast(key);
  if (cooldownMs > 0 && Date.now() - last < cooldownMs) {
    console.log(`[autoreply] cooldown chat=${msg.chat.id}`);
    return false;
  }

  try {
    const sent = await bot.api.sendMessage(msg.chat.id, text, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
    await setAutoReplyLast(key, Math.max(cooldownMin * 60, 60));
    await markBusinessRead(bot, bcId, msg.chat.id, msg.message_id);
    const chatTitle = chatTitleOf(msg);
    await logOwnerSent({
      bcId,
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      chatTitle,
      ownerUserId: null,
      sentMessageId: sent.message_id,
      text,
      source: "auto_reply",
      ownerLabel: s.ownerDisplayName || s.ownerName || "owner",
    });
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
  targetSecretary?: Secretary | null;
}): Promise<boolean> {
  const { msg, bcId, senderName, senderUsername, owner, settings, bot } = args;
  if (msg.chat.type !== "private") return false;
  const enabled = (settings.secretaryEnabled ?? "false").toLowerCase() === "true";
  if (!enabled && !args.targetSecretary) return false;
  // Per-chat override > explicit argument > default first-in-list secretary.
  let target: Secretary | null = args.targetSecretary ?? null;
  if (!target) {
    const rule = await getChatRule(msg.chat.id).catch(() => null);
    if (rule?.secretaryUserId) {
      const found = getSecretaries(settings).find(
        (s) => s.userId === rule.secretaryUserId,
      );
      if (found) target = found;
    }
  }
  if (!target) target = defaultSecretary(settings);
  if (!target) return false;
  const secId = target.userId;
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
      // Send last few messages so the secretary has context.
      try {
        const history = await recentConversation(msg.chat.id, 12);
        if (history.length > 0) {
          const lines = history
            .slice(0, -1) // skip the just-arrived message; relayAnyMessage sends it next
            .map((h) => {
              const who = h.from === "owner"
                ? settings.ownerDisplayName || settings.ownerName || "you"
                : h.senderName;
              return `[${relTime(h.at)}] ${who}: ${h.text.slice(0, 220)}`;
            })
            .join("\n");
          if (lines.trim()) {
            const ctxMsg = await bot.api.sendMessage(
              secId,
              `📜 Recent context:\n${lines}`.slice(0, 4096),
              { reply_parameters: { message_id: header.message_id } },
            );
            await recordSecretaryLink({
              sessionId: session.id,
              secretaryChatId: secId,
              secretaryMessageId: ctxMsg.message_id,
              direction: "inbound",
            });
          }
        }
      } catch (err) {
        console.error("[secretary] context send failed:", err);
      }
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
            language: settings.sttLanguage || "fa",
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
  const matchedSec = getSecretaries(settings).find(
    (s) => s.userId === msg.from!.id,
  );
  if (!matchedSec) return;
  const secId = matchedSec.userId;

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
    // Mark the original sender message (the one the secretary is replying
    // to) as read so the sender gets a "seen" tick now that we've answered.
    if (replyTo) {
      const linked = await findLinkWithSenderMessage(
        msg.chat.id,
        replyTo.message_id,
      ).catch(() => null);
      if (linked?.senderMessageIdLinked) {
        await markBusinessRead(
          bot,
          session.businessConnectionId,
          session.senderChatId,
          linked.senderMessageIdLinked,
        );
      }
    }
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
  const secList = getSecretaries(settings);
  if (secList.length === 0) return;
  const secIds = new Set(secList.map((s) => s.userId));

  // Direction A: reaction inside a business chat (the sender reacted to a
  // message). Relay it to the corresponding message in the secretary's chat
  // so the secretary can see what got reacted to.
  const bcId =
    (upd as unknown as { business_connection_id?: string })
      .business_connection_id ?? null;
  if (bcId) {
    if (secIds.has(upd.user.id)) return;
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

  // Direction B: reaction in the secretary's bot DM. Bot API's
  // setMessageReaction does NOT support business_connection_id, so we can't
  // mirror it as a real reaction on the sender's chat. Instead we send the
  // emoji string as a short text reply to the original message — same
  // visual effect from the sender's side.
  if (upd.chat.type !== "private") return;
  if (!secIds.has(upd.user.id)) return;

  const link = await findLinkWithSenderMessage(upd.chat.id, upd.message_id).catch(
    () => null,
  );
  if (!link) return;
  if (link.endedAt) return;
  if (!link.senderMessageIdLinked) return;

  const newReactions = (upd.new_reaction ?? []) as ReactionType[];
  const emojis = newReactions
    .filter((r) => r.type === "emoji")
    .map((r) => (r as { type: "emoji"; emoji: string }).emoji)
    .join(" ");
  if (!emojis) return; // removal — ignore

  try {
    await bot.api.sendMessage(link.senderChatId, emojis, {
      business_connection_id: link.businessConnectionId,
      reply_parameters: { message_id: link.senderMessageIdLinked },
    });
    await touchSecretarySession(link.id);
    console.log(
      `[reaction] relayed as text session=${link.id} to chat=${link.senderChatId} emojis=${emojis}`,
    );
  } catch (err) {
    console.error("[reaction] text relay failed:", err);
  }
}

async function sendFriendlyReply(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  customReply: string | null;
  nickname: string | null;
  relationship: import("./db").Relationship | null;
  bot: Bot;
}): Promise<boolean> {
  const { msg, bcId, senderName, settings, customReply, nickname, relationship, bot } = args;
  if (msg.chat.type !== "private") return false;
  const awayMessage = customReply || settings.autoReplyText;
  if (!awayMessage) return false;

  const key = `${bcId}:${msg.chat.id}`;
  const cooldownMin = Number(settings.autoReplyCooldownMinutes) || 0;
  const cooldownMs = Math.max(0, cooldownMin) * 60_000;
  const last = await getAutoReplyLast(key);
  if (cooldownMs > 0 && Date.now() - last < cooldownMs) return false;

  let history: Awaited<ReturnType<typeof recentConversation>> = [];
  try {
    history = await recentConversation(msg.chat.id, 20);
  } catch (err) {
    console.error("[friendly] history fetch failed:", err);
  }
  const triggerText = msg.text ?? msg.caption;
  if (triggerText) {
    history = [
      ...history,
      { from: "other" as const, senderName, text: triggerText, at: new Date() },
    ];
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
        nickname,
        relationship,
        chatId: msg.chat.id,
        businessConnectionId: bcId,
      })) || awayMessage;
  } catch (err) {
    console.error("[friendly] AI failed; falling back to literal:", err);
  }

  try {
    const sent = await bot.api.sendMessage(msg.chat.id, text, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
    await setAutoReplyLast(key, Math.max(cooldownMin * 60, 60));
    await markBusinessRead(bot, bcId, msg.chat.id, msg.message_id);
    const chatTitle = chatTitleOf(msg);
    await logOwnerSent({
      bcId,
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      chatTitle,
      ownerUserId: null,
      sentMessageId: sent.message_id,
      text,
      source: "friendly_reply",
      ownerLabel:
        settings.ownerDisplayName || settings.ownerName || "owner",
    });
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
  nickname: string | null;
  relationship: import("./db").Relationship | null;
  bot: Bot;
}): Promise<boolean> {
  const { msg, bcId, senderName, settings, nickname, relationship, bot } = args;
  if (msg.chat.type !== "private") return false;
  const userText = msg.text ?? msg.caption;
  if (!userText) return false;

  let history: Awaited<ReturnType<typeof recentConversation>> = [];
  try {
    history = await recentConversation(msg.chat.id, 40);
  } catch (err) {
    console.error("[ai_chat] history fetch failed:", err);
  }
  // The current incoming message isn't in messages_log yet (handleBusinessMessage
  // logs at the end, after this runs). Append it so the AI replies to the
  // latest input instead of the previous one.
  history = [
    ...history,
    { from: "other" as const, senderName, text: userText, at: new Date() },
  ];

  let reply = "";
  try {
    reply = await aiConversationReply({
      ownerName: settings.ownerName,
      ownerDisplayName: settings.ownerDisplayName,
      ownerContext: settings.ownerContext,
      senderName,
      history,
      nickname,
      relationship,
      chatId: msg.chat.id,
      businessConnectionId: bcId,
    });
  } catch (err) {
    console.error("[ai_chat] generation failed:", err);
    return false;
  }
  if (!reply) return false;

  try {
    const sent = await bot.api.sendMessage(msg.chat.id, reply, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
    await markBusinessRead(bot, bcId, msg.chat.id, msg.message_id);
    const chatTitle = chatTitleOf(msg);
    await logOwnerSent({
      bcId,
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      chatTitle,
      ownerUserId: null,
      sentMessageId: sent.message_id,
      text: reply,
      source: "ai_chat",
      ownerLabel:
        settings.ownerDisplayName || settings.ownerName || "owner",
    });
    return true;
  } catch (err) {
    console.error("[ai_chat] send failed:", err);
    return false;
  }
}
