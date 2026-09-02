// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot, GrammyError, HttpError, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { config, IS_BUILD_PHASE } from "../config";
import { getSecretaries, type Secretary } from "../secretaries";
import { getSettings, invalidateSettingsCache, updateSettings } from "../settings";
import { consumeInvite, createInvite, getBusinessConnection, hasDb, isAllowedUser, getChatIdByShareToken, requestBoardAccess, logMessage, markMessagesDeleted, upsertBusinessConnection, audit, recordPhoneContact, captureError, upsertChatMember } from "../db";
import { createMagicToken } from "../magic";
import { reportError, reportWarn } from "../report";
import { randomBytes } from "node:crypto";
import { handleBusinessEdit, handleBusinessMessage } from "./business";
import { buildMainMenu, handleAutoSummaryCallback, handleBoardAccessCallback, handleEmailCallback, handleFollowUpCallback, handleInboxReply, handleInstaCallback, handleNoteWatchCallback, handleSmsCallback, handleTranscribeCallback, menuGreeting } from "./callbacks";
import { handleChannelPost, handleEmailGroupMessage, handleGroupMessage } from "./group";
import { handleSecretaryReaction, handleSecretaryReply } from "./relay";
import { maybeReleaseGatedRules } from "./rules-apply";
import { background } from "../background";

export let _bot: Bot | null = null;
export function getBot(): Bot {
  if (!_bot) _bot = buildBot();
  return _bot;
}

export const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "message_reaction",
  "message_reaction_count",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  // Membership events — Telegram Bot API has no "list all members"
  // endpoint, but if the bot is an admin and listens for these it
  // builds up the full roster over time as people join/leave/get
  // promoted. my_chat_member fires when the BOT's own status changes
  // (added to / removed from a chat).
  "chat_member",
  "my_chat_member",
] as const;

export type OwnerCacheEntry = { userId: number; userChatId: number; canReply: boolean };
const ownerCache = new Map<string, OwnerCacheEntry>();
export const autoReplyCache = new Map<string, number>();

// Everything the owner reads must be Persian — including mode names and
// digits inside the alert cards.
export const CHAT_MODE_FA: Record<string, string> = {
  off: "خاموش",
  secretary: "منشی",
  auto_reply: "پاسخ خودکار",
  friendly_reply: "پاسخ دوستانه",
  ai_chat: "چت هوش مصنوعی",
  ai_listen: "شنود هوش مصنوعی",
};

export function faNum(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
}

export function chatTitleOf(msg: Message): string | null {
  const chat = msg.chat as { title?: unknown };
  return typeof chat.title === "string" ? chat.title : null;
}

export async function logOwnerSent(args: {
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
    reportError("bot", `[db] logOwnerSent (${args.source}) failed:`, err);
  }
}

export function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://tgsecretarybot.vercel.app")
  );
}

// Show "typing…" in the chat and wait a randomised delay so the AI
// reply doesn't land instantly (which feels robotic and tips the other
// side off that they're talking to a bot). Delay is roughly: 0.8-1.8s
// of think time + ~50ms per character of reply, capped at ~7s so we
// don't blow Telegram's 25s webhook timeout.
export async function humanTypingDelay(
  bot: Bot,
  args: { chatId: number; bcId: string; replyText: string },
): Promise<void> {
  const len = Math.min(args.replyText.length, 240);
  const think = 800 + Math.random() * 1000;
  const typing = len * (35 + Math.random() * 25);
  const total = Math.max(1200, Math.min(7000, think + typing));
  const sendAction = async () => {
    try {
      await bot.api.sendChatAction(args.chatId, "typing", {
        business_connection_id: args.bcId,
      });
    } catch (err) {
      // Non-fatal: typing indicator isn't critical, and some business
      // connections won't accept it.
      reportWarn("bot", "[typing] sendChatAction failed:", err);
    }
  };
  // Telegram clears the typing indicator after ~5s, so re-send for
  // longer delays.
  await sendAction();
  let waited = 0;
  while (waited < total) {
    const step = Math.min(4500, total - waited);
    await sleep(step);
    waited += step;
    if (waited < total) await sendAction();
  }
}

export function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function chunkText(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + max));
    i += max;
  }
  return out;
}

export async function markBusinessRead(
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
      reportWarn("bot", 
        `[read] cannot mark message read (likely missing can_read_messages right): ${e.description}`,
      );
    } else {
      reportError("bot", "[read] failed:", err);
    }
  }
}

function buildBot(): Bot {
  // During `next build`'s page-data collection this module is imported
  // with no runtime env, so the token is empty and grammy's `new Bot("")`
  // throws "Empty token!". Feed a placeholder in the build phase only —
  // no Telegram calls happen at build time. At runtime the real token is
  // present (systemd EnvironmentFile / Vercel env).
  const token =
    config.telegramBotToken || (IS_BUILD_PHASE ? "0:BUILD_PLACEHOLDER" : "");
  const bot = new Bot(token);

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
        reportError("bot", "[connection] persist failed:", err);
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
    await handleBusinessEdit(ctx.update.edited_business_message, bot).catch(
      (err) => reportError("bot", "[edit] handler error:", err),
    );
  });

  bot.on("deleted_business_messages", async (ctx) => {
    const d = ctx.update.deleted_business_messages;
    if (!d) return;
    const ids = Array.isArray(d.message_ids)
      ? d.message_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    if (!d.business_connection_id || !d.chat?.id || ids.length === 0) return;
    try {
      const n = await markMessagesDeleted({
        businessConnectionId: d.business_connection_id,
        chatId: Number(d.chat.id),
        messageIds: ids,
      });
      console.log(
        `[delete] chat=${d.chat.id} marked ${n} of ${ids.length} message(s) deleted`,
      );
    } catch (err) {
      reportError("bot", "[delete] mark failed:", err);
    }
  });

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    const arg = ctx.match?.toString().trim() ?? "";

    // Deep-link board login: t.me/<bot>?start=board_<shareToken>. The
    // person taps Start, we record their access request (verified by
    // their Telegram identity here), ping the owner to approve, and hand
    // back a one-tap magic link into the board.
    if (arg.startsWith("board_") && from && hasDb()) {
      const shareToken = arg.slice("board_".length);
      const chat = await getChatIdByShareToken(shareToken).catch(() => null);
      if (!chat) {
        await ctx.reply("این لینک برد معتبر نیست یا منقضی شده.");
        return;
      }
      const name =
        [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
        (from.username ? `@${from.username}` : `tg:${from.id}`);
      const settings = await getSettings().catch(() => null);
      const ownerNotify = settings?.ownerNotifyChatId;
      const owner =
        (await isAllowedUser(from.id).catch(() => false)) ||
        (!!ownerNotify && String(ownerNotify) === String(from.id));

      const { isNew } = await requestBoardAccess({
        chatId: chat.chatId,
        tgId: from.id,
        username: from.username ?? null,
        name,
        autoApprove: owner,
      });

      if (isNew && !owner && ownerNotify) {
        const uname = from.username ? ` (@${from.username})` : "";
        const kb = new InlineKeyboard()
          .text("✅ تایید دسترسی", `board:ok:${chat.chatId}:${from.id}`)
          .text("❌ رد", `board:no:${chat.chatId}:${from.id}`);
        await bot.api
          .sendMessage(
            ownerNotify,
            `🔐 درخواست دسترسی به برد\n\n` +
              `برد: ${chat.chatTitle ?? chat.chatId}\n` +
              `کاربر: ${name}${uname}\n` +
              `آیدی: ${from.id}\n\n` +
              `اگر تایید کنی، دسترسی ویرایش پیدا می‌کنه.`,
            { reply_markup: kb },
          )
          .catch(() => {});
      }

      const magic = await createMagicToken({
        userId: from.id,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        photoUrl: null,
      });
      const url = `${appBaseUrl()}/board/${shareToken}?login=${encodeURIComponent(magic)}`;
      await ctx.reply(
        owner
          ? `✅ خوش اومدی ${name}! روی دکمه بزن تا وارد برد بشی.`
          : `سلام ${name} 👋\nدرخواست دسترسی‌ات ثبت شد و برای مدیر رفت. روی دکمه بزن؛ به‌محض تایید، برد باز می‌شه.`,
        {
          reply_markup: new InlineKeyboard().url("📋 رفتن به برد", url),
          link_preview_options: { is_disabled: true },
        },
      );
      return;
    }

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
        reportError("bot", "[invite] parse secretaries failed:", err);
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
        reportError("bot", "[invite] updateSettings failed:", err);
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

    const isOwner = from
      ? await isAllowedUser(from.id).catch(() => false)
      : false;
    await ctx.reply(menuGreeting(isOwner, from?.first_name ?? null), {
      reply_markup: buildMainMenu(isOwner),
    });
  });

  bot.command("menu", async (ctx) => {
    const from = ctx.from;
    const isOwner = from
      ? await isAllowedUser(from.id).catch(() => false)
      : false;
    await ctx.reply(menuGreeting(isOwner, from?.first_name ?? null), {
      reply_markup: buildMainMenu(isOwner),
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const from = ctx.from;
    const data = ctx.callbackQuery.data;
    if (!from || !data) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    if (data.startsWith("as:")) {
      await handleAutoSummaryCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[as_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("tx:")) {
      await handleTranscribeCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[transcribe] failed:", err),
      );
      return;
    }
    if (data.startsWith("insta:")) {
      await handleInstaCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[insta_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("nw:")) {
      await handleNoteWatchCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[nw_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("fu:")) {
      await handleFollowUpCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[fu_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("sms:")) {
      await handleSmsCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[sms_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("em:")) {
      await handleEmailCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[email_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("board:")) {
      await handleBoardAccessCallback(ctx, data, bot).catch((err) =>
        reportError("bot", "[board_callback] failed:", err),
      );
      return;
    }
    if (!data.startsWith("ui:")) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    const isOwner = await isAllowedUser(from.id).catch(() => false);
    try {
      if (data === "ui:login") {
        if (!hasDb()) {
          await ctx.answerCallbackQuery({
            text: "داشبورد تنظیم نشده.",
            show_alert: true,
          });
          return;
        }
        if (!isOwner) {
          await ctx.answerCallbackQuery({
            text: "اول این بات رو از Telegram Business → Chatbots وصل کن.",
            show_alert: true,
          });
          return;
        }
        const token = await createMagicToken({
          userId: from.id,
          username: from.username ?? null,
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          photoUrl: null,
        });
        const url = `${appBaseUrl()}/login/magic?token=${encodeURIComponent(token)}`;
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `🔐 لینک ورود (۵ دقیقه اعتبار داره، یک بار مصرف):\n${url}`,
          { link_preview_options: { is_disabled: true } },
        );
      } else if (data === "ui:invite_secretary") {
        if (!isOwner) {
          await ctx.answerCallbackQuery({
            text: "فقط صاحب اکانت می‌تونه دعوت‌نامه بسازه.",
            show_alert: true,
          });
          return;
        }
        if (!hasDb()) {
          await ctx.answerCallbackQuery({
            text: "دیتابیس تنظیم نشده.",
            show_alert: true,
          });
          return;
        }
        const s = await getSettings();
        const ownerName =
          s.ownerDisplayName || s.ownerName || "the owner";
        const token = `inv${randomBytes(12).toString("hex")}`;
        await createInvite({
          token,
          purpose: "secretary_invite",
          payload: { ownerName, invitedBy: from.id },
          ttlSeconds: 7 * 24 * 60 * 60,
          createdBy: from.id,
        });
        const botUsername =
          process.env.NEXT_PUBLIC_BOT_USERNAME || "smmrchatbot";
        const url = `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `👥 لینک دعوت منشی (۷ روز اعتبار داره):\n${url}\n\nبرای کسی که می‌خوای منشیت بشه بفرست. وقتی روی لینک بزنه، خودش رو ثبت می‌کنه.`,
          { link_preview_options: { is_disabled: true } },
        );
      } else if (data === "ui:status") {
        const s = await getSettings();
        const secList = getSecretaries(s);
        const lines: string[] = [
          `📊 وضعیت`,
          `• اتصال Business: ${isOwner ? "✅ متصل" : "❌ متصل نیست"}`,
          `• منشی‌های ثبت‌شده: ${secList.length} نفر`,
        ];
        if (secList.length > 0) {
          lines.push(...secList.map((sec) => `   - ${sec.name}`));
        }
        lines.push(
          `• Secretary فعال: ${(s.secretaryEnabled ?? "false").toLowerCase() === "true" ? "روشن" : "خاموش"}`,
        );
        lines.push(
          `• Auto-reply: ${(s.autoReplyEnabled ?? "true").toLowerCase() === "false" ? "خاموش" : "روشن"}`,
        );
        await ctx.answerCallbackQuery();
        await ctx.reply(lines.join("\n"));
      } else if (data === "ui:help") {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "🆘 راهنمای کوتاه:\n\n" +
            "1. توی تلگرام: Settings → Telegram Business → Chatbots → این بات رو اضافه کن. حتماً اجازه‌ی Reply رو روشن کن.\n" +
            "2. /login یا دکمه‌ی «ورود به داشبورد» رو بزن تا لینک ورود به وب بگیری.\n" +
            "3. توی داشبورد، توی Settings مشخصات خودت، owner_context و آستانه‌ی importance رو تنظیم کن.\n" +
            "4. هر چت رو می‌تونی روی mode دلخواه بذاری: Off / Secretary / Auto-reply / Friendly / AI chat.\n" +
            "5. برای منشی‌ها از همین منو دعوت‌نامه بساز.\n\n" +
            "هر وقت خواستی این منو رو ببینی /menu بزن.",
        );
      } else {
        await ctx.answerCallbackQuery();
      }
    } catch (err) {
      reportError("bot", "[ui] callback failed:", err);
      try {
        await ctx.answerCallbackQuery({
          text: "خطا رخ داد. دوباره امتحان کن.",
          show_alert: true,
        });
      } catch {}
    }
  });

  bot.command("login", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    if (!hasDb()) {
      await ctx.reply(
        "داشبورد تنظیم نشده (DATABASE_URL روی سرور موجود نیست).",
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
    const m = ctx.update.message;
    // If this message lands in a group/channel that the owner has
    // tagged as summary_inbox and it's a reply to one of our delivered
    // summaries, route it back to the source chat. Runs BEFORE the
    // normal group handler so we don't classify our own routed reply.
    const routed = await handleInboxReply(m, bot).catch((err) => {
      reportError("bot", "[inbox_reply] handler error:", err);
      return false;
    });
    if (routed) return;
    // Email: (a) a reply to the bot's ↩️ force-reply prompt → send the
    // email reply; (b) a /email compose command in the email channel.
    const handledEmail = await handleEmailGroupMessage(m, bot).catch((err) => {
      reportError("bot", "[email] group handler error:", err);
      return false;
    });
    if (handledEmail) return;
    // Groups/supergroups: classify + log + alert if urgent. Requires
    // 'Disable group privacy' on the bot in BotFather so Telegram
    // forwards every message instead of just /commands and mentions.
    if (m.chat.type === "group" || m.chat.type === "supergroup") {
      await handleGroupMessage(m, bot).catch((err) =>
        reportError("bot", "[group] handler error:", err),
      );
      return;
    }
    // Private chats: existing secretary-reply relay (a registered
    // secretary replying to a forwarded message in their DM with the
    // bot). For anything else this no-ops.
    await handleSecretaryReply(m, bot).catch((err) =>
      reportError("bot", "[secretary] handler error:", err),
    );
    // NOTE: the multi-recipient Secretary Routes reply path used to
    // live here for bot-DM-style relays, but the operator wants
    // recipients to interact with their own personal Telegram chat
    // with the owner instead — so the reply detection moved into the
    // business_message handler (see maybeRelayRecipientReplyBusiness
    // call inside handleBusinessMessage).
    // Harvest any contact share into phone_contacts so the SMS
    // router can identify this number on a later inbound SMS.
    harvestContactShare(m);
    // Gate-release path for rule recipients DM'ing the bot directly.
    // The owner's business chats already fire this from inside
    // handleBusinessMessage; this branch covers people who only know
    // the bot via /start (rule recipients).
    const incomingText =
      typeof m.text === "string"
        ? m.text
        : typeof m.caption === "string"
          ? m.caption
          : "";
    if (incomingText && m.chat.type === "private") {
      await maybeReleaseGatedRules({
        senderChatId: m.chat.id,
        messageText: incomingText,
        bot,
      }).catch((err) =>
        reportWarn("bot", "[rules] direct-DM release failed:", err),
      );
    }
  });

  // Channels deliver posts via channel_post, NOT message. First we
  // give the inbox-reply router a chance (owner-typed replies to our
  // summary posts), otherwise the post goes through the same
  // classify-and-log path we use for groups so news / archive
  // channels show up in /messages and /chats too.
  bot.on("channel_post", async (ctx) => {
    const m = ctx.update.channel_post;
    console.log(
      `[channel_post] chat=${m.chat.id} type=${m.chat.type} msg=${m.message_id} text=${(m.text ?? m.caption ?? "").slice(0, 60)}`,
    );
    const routed = await handleInboxReply(m, bot).catch((err) => {
      reportError("bot", "[inbox_reply] channel handler error:", err);
      return false;
    });
    if (routed) return;
    await handleChannelPost(m, bot).catch((err) =>
      reportError("bot", "[channel_post] handler error:", err),
    );
  });

  bot.on("edited_channel_post", async (ctx) => {
    const m = ctx.update.edited_channel_post;
    console.log(
      `[edited_channel_post] chat=${m.chat.id} msg=${m.message_id}`,
    );
    // Treat edits in channels as fresh classifies — for news channels
    // an edit is often a correction the owner should see.
    await handleChannelPost(m, bot).catch((err) =>
      reportError("bot", "[edited_channel_post] handler error:", err),
    );
  });

  bot.on("message_reaction", async (ctx) => {
    const upd = ctx.update.message_reaction;
    const bcId = (upd as unknown as { business_connection_id?: string })
      .business_connection_id;
    console.log(
      `[reaction] received chat=${upd?.chat?.id} chat_type=${upd?.chat?.type} ` +
        `user=${upd?.user?.id} bcId=${bcId ?? "(none)"} ` +
        `new=${upd?.new_reaction?.length ?? 0} ` +
        `types=${(upd?.new_reaction ?? []).map((r) => r.type).join(",")}`,
    );
    await handleSecretaryReaction(ctx.update.message_reaction, bot).catch(
      (err) => reportError("bot", "[secretary] reaction error:", err),
    );
  });

  // chat_member fires when ANY member's status in the chat changes
  // (joined/left/promoted/restricted). Requires the bot to be an
  // admin of the group. Telegram doesn't expose a getChatMembers
  // method, so we recover the roster by upserting on every event —
  // over time the chat_members table fills up.
  bot.on("chat_member", async (ctx) => {
    const upd = ctx.update.chat_member;
    const u = upd.new_chat_member.user;
    try {
      await upsertChatMember({
        chatId: upd.chat.id,
        userId: u.id,
        firstName: u.first_name ?? null,
        lastName: u.last_name ?? null,
        username: u.username ?? null,
        isBot: Boolean(u.is_bot),
        isPremium: Boolean(u.is_premium),
        languageCode: u.language_code ?? null,
        status: upd.new_chat_member.status,
      });
    } catch (err) {
      reportWarn("bot", "[chat_member] upsert failed:", err);
    }
  });
  // my_chat_member fires when OUR bot's status in the chat changes.
  // Useful for tracking which groups the bot is in / has been booted
  // from — we just log it, no state changes needed beyond the row.
  bot.on("my_chat_member", async (ctx) => {
    const upd = ctx.update.my_chat_member;
    console.log(
      `[my_chat_member] chat=${upd.chat.id} status=${upd.new_chat_member.status} ` +
        `by=${upd.from?.id ?? "?"}`,
    );
  });

  bot.catch((err) => {
    const e = err.error;
    let source = "bot:uncaught";
    if (e instanceof GrammyError) {
      reportError("bot", "[bot] Telegram API:", e.description);
      source = "bot:telegram-api";
    } else if (e instanceof HttpError) {
      reportError("bot", "[bot] network:", e);
      source = "bot:network";
    } else {
      reportError("bot", "[bot] uncaught:", e);
    }
    // Fire-and-forget — captureError swallows its own DB failures
    // so we never re-throw out of the grammy handler.
    void captureError({
      source,
      error: e,
      scope: err.ctx?.update?.update_id
        ? `update=${err.ctx.update.update_id}`
        : null,
      details: {
        chatId: err.ctx?.chat?.id ?? null,
        userId: err.ctx?.from?.id ?? null,
      },
    });
  });

  return bot;
}

export async function resolveOwner(bcId: string, bot: Bot): Promise<OwnerCacheEntry | null> {
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
    reportError("bot", `[connection] api lookup failed for ${bcId}:`, err);
    return null;
  }
}

// Telegram delivers shared contacts as a regular message with
// msg.contact set; the payload optionally includes user_id when the
// contact is a Telegram user. We harvest these into phone_contacts
// so findOwnerOfPhone can resolve the SMS sender on later lookups.
export function harvestContactShare(msg: Message): void {
  const c = msg.contact;
  if (!c || !c.phone_number) return;
  background("recordPhoneContact", recordPhoneContact({
    phoneFull: c.phone_number,
    telegramUserId: c.user_id ?? null,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    username: null,
    source: "contact_share",
  }).catch((err) => reportWarn("bot", "[phone_contacts] save failed:", err)));
}

// The owner's active business connection, used to act as the owner.
export async function activeBusinessConnectionId(): Promise<string | null> {
  try {
    const { listBusinessConnections } = await import("../db");
    const rows = await listBusinessConnections();
    return rows.find((r) => r.isEnabled && r.canReply)?.id ?? null;
  } catch {
    return null;
  }
}

export function relTime(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toISOString().slice(0, 10);
}

export function extractMedia(
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

export function describeMessage(msg: Message): string {
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

export type SendCommon = {
  business_connection_id?: string;
  reply_parameters?: { message_id: number };
};

// Multi-recipient Secretary Routes: when the source chat has
// mode='secretary' AND it's listed in one or more enabled Routes,
// fan-out every incoming message to every recipient in those Routes.
// Links each forwarded copy back to the source message so a recipient
// reply (in their own DM with the bot) can be routed back. Separate
// from the legacy single-secretary path so both can coexist.
// Pull every URL button out of an incoming message's inline keyboard.
// Used to capture the HTML / Preview / Summary / Text / Debug links
// that email-bridge channels attach to every post — the dashboard
// stores them so /messages can offer "📧 نمایش HTML" on a row.
export function extractInlineUrlButtons(
  msg: Message,
): Array<{ label: string; url: string }> | null {
  const kb = msg.reply_markup?.inline_keyboard;
  if (!kb || kb.length === 0) return null;
  const out: Array<{ label: string; url: string }> = [];
  for (const row of kb) {
    for (const btn of row) {
      const url = (btn as { url?: unknown }).url;
      const text = (btn as { text?: unknown }).text;
      if (typeof url !== "string" || !url) continue;
      if (typeof text !== "string" || !text) continue;
      out.push({ label: text.trim().slice(0, 120), url: url.slice(0, 2000) });
    }
  }
  return out.length > 0 ? out : null;
}

// Identify what KIND of payload a message carries — used for both
// error logging and to know whether we need a separate text payload.
export function messageKind(msg: Message): string {
  if (msg.photo && msg.photo.length > 0) return "photo";
  if (msg.video) return "video";
  if (msg.voice) return "voice";
  if (msg.audio) return "audio";
  if (msg.document) return "document";
  if (msg.animation) return "gif";
  if (msg.sticker) return "sticker";
  if (msg.video_note) return "video_note";
  if (msg.location) return "location";
  if (msg.contact) return "contact";
  if (msg.dice) return "dice";
  if (msg.venue) return "venue";
  if (msg.poll) return "poll";
  if (msg.text) return "text";
  if (msg.caption) return "caption-only";
  return "unknown";
}

// Pick the right file_id for whatever media the message carries.
// Telegram's File ID is bot-scoped — for re-sending under the owner's
// business connection we use the file_id from the inbound business
// message; if that's rejected we fall back to download + InputFile.
export function mediaFileId(msg: Message): {
  kind:
    | "photo"
    | "video"
    | "voice"
    | "audio"
    | "document"
    | "animation"
    | "sticker"
    | "video_note";
  fileId: string;
} | null {
  if (msg.photo && msg.photo.length > 0) {
    const biggest = msg.photo[msg.photo.length - 1];
    return biggest ? { kind: "photo", fileId: biggest.file_id } : null;
  }
  if (msg.video) return { kind: "video", fileId: msg.video.file_id };
  if (msg.voice) return { kind: "voice", fileId: msg.voice.file_id };
  if (msg.audio) return { kind: "audio", fileId: msg.audio.file_id };
  if (msg.document) return { kind: "document", fileId: msg.document.file_id };
  if (msg.animation)
    return { kind: "animation", fileId: msg.animation.file_id };
  if (msg.sticker) return { kind: "sticker", fileId: msg.sticker.file_id };
  if (msg.video_note)
    return { kind: "video_note", fileId: msg.video_note.file_id };
  return null;
}

export type MediaKind = NonNullable<ReturnType<typeof mediaFileId>>["kind"];

// Telegram error codes that mean "file_id won't work as-is" — these
// trigger the download + re-upload fallback. Everything else is
// propagated to the caller so genuine network / permission failures
// don't waste a download round-trip.
export function isFileIdProblem(err: unknown): boolean {
  const e = err as { error_code?: number; description?: string };
  if (e?.error_code !== 400) return false;
  const d = (e.description ?? "").toLowerCase();
  return (
    d.includes("file") ||
    d.includes("wrong type") ||
    d.includes("not found") ||
    d.includes("identifier")
  );
}

// AximoBot-style forwarder chatter we DON'T want mirrored: menus,
// status pings, subscription/upsell, feed-management confirmations.
// Real forwarded posts are either media or text with a source header
// and don't match any of these.
export const FORWARDER_JUNK_RX: RegExp[] = [
  /^\s*[⌛⏳💳📺⚙️🔧🔔📌]/u,
  /\b(premium|subscription|upgrade|renew|billing|payment)\b/i,
  /\bdisplay options\b/i,
  /^\s*settings\s*$/i,
  /\badd source\b/i,
  /\bdata source\b/i,
  /\byour feed\b/i,
  /\bis (added|removed) (to|from) your feed\b/i,
  /\brequest is processing\b/i,
  /\bresolving data source\b/i,
  /\bwe are using non-official\b/i,
];
