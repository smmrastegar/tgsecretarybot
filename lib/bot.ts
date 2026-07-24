import { Bot, type Context, GrammyError, HttpError, InlineKeyboard, InputFile } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { Message } from "grammy/types";
import { config, IS_BUILD_PHASE } from "./config";
import {
  aiConversationReply,
  classify,
  describeMedia,
  extractActions,
  friendlyAutoReply,
  scanForWatchlistConcepts,
  summarizeGroup,
} from "./classifier";
import { downloadTelegramFile, sttConfigured, transcribeAudio } from "./stt";
import { generatePersonalPhoto, looksLikePhotoRequest } from "./image-gen";
import {
  getRoutedMessage,
  markTranscribed,
  maybeRouteMedia,
} from "./media-router";
import { ensureChatRuleWithDefaults } from "./chat-defaults";
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
  createInvite,
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
  setBoardMemberStatus,
  getBoardMember,
  getChatIdByShareToken,
  requestBoardAccess,
  lastOwnerMessageAt,
  findThreadByInboxMessage,
  getPrimarySummaryInbox,
  listChatThreaded,
  logMessage,
  markAutoSummaryDelivered,
  markMessagesDeleted,
  setThreadSummaryInbox,
  openSecretarySession,
  recentIncomingCount,
  recordMessageEdit,
  saveMediaDescription,
  saveTranscript,
  setFloodCooldown,
  sql,
  upsertThreadSummary,
  type ChatRule,
  recentConversation,
  recordSecretaryLink,
  saveExtractedItems,
  touchSecretarySession,
  upsertBusinessConnection,
  audit,
  logMediaRouting,
  type ChatMode,
  type SecretarySession,
  isChatIgnored,
  recordPhoneContact,
  findEnabledRelaysForSource,
  findSecretaryRelayLinkByRecipientMessage,
  findLatestInboundLinkForRecipient,
  recordSecretaryRelayLink,
  listNoteWatchItemsWithAliases,
  hasRecentNoteWatchMatch,
  recordNoteWatchMatch,
  addChatNote,
  listChatsByFunction,
  upsertForumTopic,
  ackChatFollowUp,
  captureError,
  addSmsAcceptSignature,
  createSmsBlockRule,
  deleteSmsDedup,
  expediteMonitoredAccountFetch,
  getMessageFullText,
  getNoteWatchMatch,
  getPrivateMessage,
  getSmsDedup,
  revealPrivateMessage,
  markNoteWatchMatchConfirmed,
  markNoteWatchMatchWrong,
  recordOwnerReaction,
  upsertChatMember,
  getEmail,
  setEmailSummary,
  shouldNotifyAiActivity,
  bufferMirrorAlbumPart,
  claimMirrorAlbumFlush,
  getMirrorAlbumParts,
  deleteMirrorAlbumBuffer,
  deleteMirrorAlbumClaim,
  getReadyMirrorAlbumGroups,
  type MirrorAlbumPart,
  getEmailAccountByChannel,
  createEmailPendingReply,
  getEmailPendingReply,
  deleteEmailPendingReply,
} from "./db";
import { buildEmailCard, replyToEmail, resolveEmailAccount, sendEmail } from "./email";
import { parseChannelMirrors, type MirrorRule } from "./channel-mirror";
import { isTransientDbError } from "./pg-driver";
import { summarizeEmail } from "./classifier";
import type { MessageReactionUpdated, ReactionType } from "grammy/types";
import { createMagicToken } from "./magic";
import { randomBytes } from "node:crypto";

let _bot: Bot | null = null;
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
  businessConnectionId: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  const s = await getSettings();
  if ((s.autoExtractEnabled ?? "true").toLowerCase() === "false") return;
  try {
    const items = await extractActions({
      text: args.text,
      senderName: args.senderName,
      chatId: args.chatId,
      businessConnectionId: args.businessConnectionId ?? undefined,
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
        priority: typeof it.priority === "string" ? it.priority : "normal",
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
    // Auto-extract is best-effort — a transient DB blip shouldn't be
    // surfaced as a runtime error; the next message re-runs it anyway.
    if (isTransientDbError(err)) {
      console.warn("[extract] auto skipped (transient DB)");
    } else {
      console.error("[extract] auto failed:", err);
    }
  }
}

function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sleep(ms: number): Promise<void> {
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

function buildMainMenu(isOwner: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🔐 ورود به داشبورد", "ui:login")
    .row();
  if (isOwner) {
    kb.text("👥 ساخت دعوت‌نامه منشی", "ui:invite_secretary").row();
  }
  kb.text("📊 وضعیت اتصال", "ui:status")
    .text("🆘 راهنما", "ui:help");
  return kb;
}

function menuGreeting(isOwner: boolean, name: string | null): string {
  const hi = name ? `سلام ${name} 👋` : "سلام 👋";
  if (isOwner) {
    return (
      `${hi}\n\nاز این منو می‌تونی به داشبورد بری، برای منشی‌هات دعوت‌نامه بسازی، یا وضعیت اتصال رو ببینی.`
    );
  }
  return (
    `${hi}\n\nاین بات منشی‌گریِ تلگرامه. اگه صاحب اکانت دعوتت کرده، روی لینک دعوتش کلیک کن. اگه خودت صاحب اکانتی، اول از Telegram Settings → Telegram Business → Chatbots این بات رو وصل کن، بعد دوباره /start رو بزن.`
  );
}

// Show "typing…" in the chat and wait a randomised delay so the AI
// reply doesn't land instantly (which feels robotic and tips the other
// side off that they're talking to a bot). Delay is roughly: 0.8-1.8s
// of think time + ~50ms per character of reply, capped at ~7s so we
// don't blow Telegram's 25s webhook timeout.
async function humanTypingDelay(
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
      console.warn("[typing] sendChatAction failed:", err);
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

// Run multimodal analysis only on chats the owner has put in ai_listen
// mode — for other modes the dashboard either gets a reply (so the
// visual doesn't matter much) or has a separate per-feature transcribe
// path (secretary forwarding already STTs voice messages). Images go
// through Gemini multimodal; voice/audio/video_note go through STT.
async function maybeDescribeMedia(args: {
  mode: ChatMode;
  logId: number;
  mediaFileId: string | null;
  mediaKind: string | null;
  chatId: number;
  bcId: string | null;
}): Promise<void> {
  if (args.mode !== "ai_listen") return;
  if (!args.mediaFileId || !args.mediaKind) return;

  const visualKinds = new Set(["photo", "sticker", "animation"]);
  const audioKinds = new Set(["voice", "audio", "video_note"]);

  if (audioKinds.has(args.mediaKind)) {
    if (!sttConfigured()) return;
    try {
      const settings = await getSettings();
      const tr = await transcribeAudio({
        botToken: config.telegramBotToken,
        fileId: args.mediaFileId,
        language: settings.sttLanguage || "fa",
        chatId: args.chatId,
        businessConnectionId: args.bcId,
      });
      if (tr.text) await saveTranscript(args.logId, tr.text);
    } catch (err) {
      console.warn("[ai_listen] transcribe failed:", err);
    }
    return;
  }

  if (visualKinds.has(args.mediaKind)) {
    try {
      const result = await describeMedia({
        fileId: args.mediaFileId,
        kind: args.mediaKind,
        chatId: args.chatId,
        businessConnectionId: args.bcId,
      });
      if (!result || (!result.description && !result.textInImage)) return;
      const lines: string[] = [];
      if (result.description) lines.push(result.description);
      if (result.textInImage)
        lines.push(`[متن داخل تصویر] ${result.textInImage}`);
      await saveMediaDescription(args.logId, lines.join("\n"));
    } catch (err) {
      console.warn("[ai_listen] describe failed:", err);
    }
  }
}

// Handle clicks on inline buttons attached to auto-summary posts in
// the summary_inbox channel. callback_data formats:
//   as:reply:<chatId>:<startSec>   — generate an AI suggested reply
//   as:resum:<chatId>:<startSec>   — re-generate the summary
//   as:send:<chatId>:<startSec>    — send the previously-suggested
//                                    reply to the source chat
// 🔍 الان بگیر button under the deferred-notify message in the
// storage / download_archive channel. callback_data shape:
//   "insta:fetchnow:<account_id>"
// Pushing the account's pending_fetch_at to NOW makes the next cron
// tick (≤ 5 min) process it.
// ✅ متوجه شدم button under each follow-up notice in notes_inbox.
// Stamps chat_rules.follow_up_acked_at = NOW() so the cron stops
// pinging this chat until a NEW customer message arrives.
async function handleFollowUpCallback(
  ctx: Context,
  data: string,
  _bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length < 3 || parts[1] !== "ack") {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const chatId = Number(parts[2]);
  if (!Number.isFinite(chatId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  try {
    await ackChatFollowUp(chatId);
    try {
      const noticeMsg = ctx.callbackQuery?.message as
        | { chat: { id: number }; message_id: number }
        | undefined;
      if (noticeMsg) {
        await ctx.api.editMessageReplyMarkup(
          noticeMsg.chat.id,
          noticeMsg.message_id,
          {
            reply_markup: new InlineKeyboard().text(
              "✅ متوجه شدم",
              `fu:noop:${chatId}`,
            ),
          },
        );
      }
    } catch {
      // edit failures don't matter — the DB stamp is the source of truth.
    }
    await ctx
      .answerCallbackQuery({ text: "✅ ثبت شد. تا پیام جدید پینگ نمی‌فرستم." })
      .catch(() => {});
  } catch (err) {
    console.warn("[fu_cb] ack failed:", err);
    await ctx
      .answerCallbackQuery({ text: "ثبت نشد." })
      .catch(() => {});
  }
}

// 📄 متن کامل / 🚩 گزارش خطا buttons under each watchlist notice
// in the notes_inbox channel. callback_data shapes:
//   "nw:full:<match_id>"  → reply to the notice with the full
//                            original message text (so the operator
//                            can see what the model actually saw,
//                            not just the short quoted span).
//   "nw:wrong:<match_id>" → stamp note_watch_matches.reported_wrong_at
//                            and replace the keyboard with a single
//                            "🚩 گزارش شد" badge.
async function handleNoteWatchCallback(
  ctx: Context,
  data: string,
  _bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const action = parts[1];
  const matchId = Number(parts[2]);
  if (!Number.isFinite(matchId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const match = await getNoteWatchMatch(matchId).catch(() => null);
  if (!match) {
    await ctx
      .answerCallbackQuery({ text: "match پیدا نشد." })
      .catch(() => {});
    return;
  }
  if (action === "full") {
    if (!match.messageLogId) {
      await ctx
        .answerCallbackQuery({
          text: "متن کامل ذخیره نشده — این match قبل از این فیچر ثبت شده.",
          show_alert: true,
        })
        .catch(() => {});
      return;
    }
    const full = await getMessageFullText(match.messageLogId).catch(
      () => null,
    );
    if (!full) {
      await ctx
        .answerCallbackQuery({ text: "متن پیدا نشد." })
        .catch(() => {});
      return;
    }
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
      );
    const body = esc(full.text || "(خالی)");
    // Two paths:
    //   1. Append to the notice itself via editMessageText. Always
    //      works because the bot already authored the message.
    //   2. Fallback: send a fresh reply (only if editing fails for
    //      some reason, e.g. the original notice was deleted).
    const noticeMsg = ctx.callbackQuery?.message as
      | { chat: { id: number }; message_id: number; text?: string; caption?: string }
      | undefined;
    const existingText =
      noticeMsg?.text ?? noticeMsg?.caption ?? "";
    // Don't re-append if the operator already pressed the button
    // earlier — detect the "📄 متن کامل" marker we wrote on the
    // first press.
    const alreadyAppended = existingText.includes("📄 متن کامل");
    if (noticeMsg && !alreadyAppended) {
      const appended =
        `${existingText}\n\n📄 <b>متن کامل</b>\n${body}`.slice(0, 4096);
      try {
        await ctx.api.editMessageText(
          noticeMsg.chat.id,
          noticeMsg.message_id,
          appended,
          {
            parse_mode: "HTML",
            // Keep the ✅ تأیید + 🚩 گزارش خطا buttons alive after
            // the edit — the operator might still want to confirm
            // or flag after expanding the full text.
            reply_markup: new InlineKeyboard()
              .text("✅ تأیید", `nw:ok:${matchId}`)
              .text("🚩 گزارش خطا", `nw:wrong:${matchId}`),
          },
        );
        await ctx
          .answerCallbackQuery({ text: "✅ متن کامل اضافه شد." })
          .catch(() => {});
        return;
      } catch (err) {
        console.warn(
          "[nw_cb] edit notice with full-text failed, falling back to fresh send:",
          err,
        );
      }
    } else if (alreadyAppended) {
      await ctx
        .answerCallbackQuery({ text: "متن کامل قبلاً اضافه شده." })
        .catch(() => {});
      return;
    }
    // Fallback: send a fresh reply.
    const header = [
      `📄 <b>متن کامل پیام</b>`,
      `از: ${esc(full.senderName)}` +
        (full.chatTitle ? ` · ${esc(full.chatTitle)}` : ""),
    ].join("\n");
    const text = `${header}\n\n${body}`.slice(0, 4096);
    try {
      await ctx.api.sendMessage(match.forwardedTo ?? match.chatId, text, {
        parse_mode: "HTML",
        ...(noticeMsg
          ? { reply_parameters: { message_id: noticeMsg.message_id } }
          : {}),
      });
      await ctx
        .answerCallbackQuery({ text: "✅ متن کامل ارسال شد." })
        .catch(() => {});
    } catch (err) {
      console.warn("[nw_cb] full-text fresh send failed:", err);
      await ctx
        .answerCallbackQuery({
          text: "ارسال نشد — احتمالاً بات توی این چت permission نداره.",
          show_alert: true,
        })
        .catch(() => {});
    }
    return;
  }
  if (action === "wrong") {
    try {
      await markNoteWatchMatchWrong(matchId);
      // Edit the keyboard to a single "🚩 گزارش شد" badge so the
      // operator knows the report stuck and can't double-press it.
      try {
        const noticeMsg = ctx.callbackQuery?.message as
          | { chat: { id: number }; message_id: number }
          | undefined;
        if (noticeMsg) {
          await ctx.api.editMessageReplyMarkup(
            noticeMsg.chat.id,
            noticeMsg.message_id,
            {
              reply_markup: new InlineKeyboard().text(
                "🚩 گزارش شد",
                `nw:noop:${matchId}`,
              ),
            },
          );
        }
      } catch {
        // Editing fails when the message was deleted or 48h+ old;
        // the markNoteWatchMatchWrong above is what matters.
      }
      await ctx
        .answerCallbackQuery({ text: "✅ گزارش شد." })
        .catch(() => {});
    } catch (err) {
      console.warn("[nw_cb] mark-wrong failed:", err);
      await ctx
        .answerCallbackQuery({ text: "ثبت نشد." })
        .catch(() => {});
    }
    return;
  }
  if (action === "ok") {
    try {
      await markNoteWatchMatchConfirmed(matchId);
      // Replace the keyboard with a single "✅ تأیید شد" badge so the
      // operator can't double-press it. The 📄 button is dropped
      // since "ok" implies they've already inspected the message.
      try {
        const noticeMsg = ctx.callbackQuery?.message as
          | { chat: { id: number }; message_id: number }
          | undefined;
        if (noticeMsg) {
          await ctx.api.editMessageReplyMarkup(
            noticeMsg.chat.id,
            noticeMsg.message_id,
            {
              reply_markup: new InlineKeyboard().text(
                "✅ تأیید شد",
                `nw:noop:${matchId}`,
              ),
            },
          );
        }
      } catch {
        // Editing fails when the message was deleted or too old —
        // the DB stamp is the thing that matters.
      }
      await ctx
        .answerCallbackQuery({ text: "✅ ثبت شد." })
        .catch(() => {});
    } catch (err) {
      console.warn("[nw_cb] mark-confirmed failed:", err);
      await ctx
        .answerCallbackQuery({ text: "ثبت نشد." })
        .catch(() => {});
    }
    return;
  }
  // Unknown action (or "noop" for the post-report badge) — silent ack.
  await ctx.answerCallbackQuery().catch(() => {});
}

async function handleInstaCallback(
  ctx: Context,
  data: string,
  _bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length < 3 || parts[1] !== "fetchnow") {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const accountId = Number(parts[2]);
  if (!Number.isFinite(accountId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  try {
    await expediteMonitoredAccountFetch(accountId);
    await ctx
      .answerCallbackQuery({
        text: "✅ توی فرصت بعدی cron گرفته می‌شه (تا ۵ دقیقه دیگه).",
      })
      .catch(() => {});
  } catch (err) {
    console.warn("[insta_cb] expedite failed:", err);
    await ctx
      .answerCallbackQuery({ text: "نشد — خطا." })
      .catch(() => {});
  }
}

// 🗑 / 🚫 buttons under each forwarded SMS in the notes_inbox /
// sms_inbox channel. callback_data shapes:
//   "sms:rm:<dedup_id>"    — delete the Telegram copy + drop the
//                            dedup row so a future duplicate posts
//                            fresh instead of editing nothing.
//   "sms:block:<dedup_id>" — also adds the body as an sms_block_rules
//                            example so future similar SMS are
//                            filtered before they ever reach the
//                            inbox. Best-effort delete the Telegram
//                            copy too.
async function handleSmsCallback(
  ctx: Context,
  data: string,
  _bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const action = parts[1];
  // The reveal/hide actions are keyed on the messages_log id, not
  // the sms_dedup id, so handle them BEFORE the dedup lookup below.
  if (action === "reveal" || action === "hide") {
    const logId = Number(parts[2]);
    if (!Number.isFinite(logId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await handleSmsReveal(ctx, action, logId);
    return;
  }
  const dedupId = Number(parts[2]);
  if (!Number.isFinite(dedupId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const row = await getSmsDedup(dedupId).catch(() => null);
  if (!row) {
    await ctx
      .answerCallbackQuery({ text: "ردیف dedup پیدا نشد." })
      .catch(() => {});
    return;
  }
  if (action === "rm") {
    try {
      if (row.telegramMessageId) {
        await ctx.api.deleteMessage(row.inboxChatId, row.telegramMessageId);
      }
      await deleteSmsDedup(dedupId);
      await ctx.answerCallbackQuery({ text: "پاک شد." }).catch(() => {});
    } catch (err) {
      console.warn("[sms_cb] delete failed:", err);
      await ctx
        .answerCallbackQuery({
          text: "نشد پاک کنم — احتمالاً قبلاً پاک شده.",
          show_alert: false,
        })
        .catch(() => {});
    }
    return;
  }
  if (action === "ok") {
    try {
      await addSmsAcceptSignature({
        bodySignature: row.bodySignature,
        bodyPreview: row.bodyPreview ?? row.bodySignature,
        createdBy: ctx.from?.id ?? null,
      });
      // Remove the action keyboard from the current message — the
      // operator told us they're fine with this pattern, no reason
      // to keep the buttons visible. Future SMS that hash to the
      // same signature will arrive without buttons in the first
      // place (see isSmsAcceptedSignature check in routeSmsForward).
      if (row.telegramMessageId) {
        await ctx.api
          .editMessageReplyMarkup(row.inboxChatId, row.telegramMessageId, {
            reply_markup: undefined,
          })
          .catch(() => {});
      }
      await ctx
        .answerCallbackQuery({ text: "✅ پذیرفته شد." })
        .catch(() => {});
    } catch (err) {
      console.warn("[sms_cb] accept failed:", err);
      await ctx
        .answerCallbackQuery({ text: "ذخیره نشد — خطا." })
        .catch(() => {});
    }
    return;
  }
  if (action === "block") {
    try {
      // Use the original body preview as the example. The signature
      // is normalised so it's a poor seed; bodyPreview is the human-
      // readable body for the gate's LLM check.
      const example = row.bodyPreview ?? row.bodySignature;
      const rule = await createSmsBlockRule({
        exampleBody: example,
        label: null,
        createdBy: ctx.from?.id ?? null,
      });
      // Delete the Telegram message too — once the user blocked it
      // they probably don't want it lingering.
      if (row.telegramMessageId) {
        await ctx.api
          .deleteMessage(row.inboxChatId, row.telegramMessageId)
          .catch(() => {});
      }
      await deleteSmsDedup(dedupId);
      await ctx
        .answerCallbackQuery({
          text: `بلاک شد. (rule #${rule.id})`,
          show_alert: false,
        })
        .catch(() => {});
    } catch (err) {
      console.warn("[sms_cb] block failed:", err);
      await ctx
        .answerCallbackQuery({ text: "بلاک نشد — خطا." })
        .catch(() => {});
    }
    return;
  }
  await ctx.answerCallbackQuery().catch(() => {});
}

// Email card buttons (em:sum:<id> / em:reply:<id>). Summary posts an
// AI summary as a reply in the channel; Reply posts a force-reply
// prompt the operator answers to send the email reply — all without
// leaving Telegram.
// Owner taps ✅/❌ on a board access request. Only an allowed (owner)
// account may decide. Approve/reject the member, refresh the card, and
// best-effort DM the requester with the outcome.
async function handleBoardAccessCallback(
  ctx: Context,
  data: string,
  bot: Bot,
): Promise<void> {
  const parts = data.split(":"); // board:ok|no:<chatId>:<tgId>
  const action = parts[1];
  const boardChatId = Number(parts[2]);
  const tgId = Number(parts[3]);
  const from = ctx.from;
  if (
    !from ||
    (action !== "ok" && action !== "no") ||
    !Number.isFinite(boardChatId) ||
    !Number.isFinite(tgId)
  ) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const isOwner = await isAllowedUser(from.id).catch(() => false);
  if (!isOwner) {
    await ctx
      .answerCallbackQuery({ text: "فقط مدیر می‌تواند تایید کند." })
      .catch(() => {});
    return;
  }
  const member = await getBoardMember(boardChatId, tgId).catch(() => null);
  if (!member) {
    await ctx.answerCallbackQuery({ text: "درخواست پیدا نشد." }).catch(() => {});
    return;
  }
  const status = action === "ok" ? "approved" : "rejected";
  const decidedBy =
    [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
    (from.username ? `@${from.username}` : String(from.id));
  await setBoardMemberStatus({
    chatId: boardChatId,
    tgId,
    status,
    decidedBy,
  }).catch(() => null);

  const who = member.name || (member.username ? `@${member.username}` : String(tgId));
  await ctx
    .answerCallbackQuery({ text: action === "ok" ? "تایید شد ✓" : "رد شد" })
    .catch(() => {});
  const cardChat = ctx.chat?.id;
  const cardMsgId = ctx.callbackQuery?.message?.message_id;
  if (cardChat != null && cardMsgId != null) {
    await ctx.api
      .editMessageText(
        cardChat,
        cardMsgId,
        `🔐 درخواست دسترسی به برد — ${who}\n\n` +
          (action === "ok" ? "✅ تایید شد" : "❌ رد شد") +
          ` (توسط ${decidedBy})`,
      )
      .catch(() => {});
  }
  // Best-effort: tell the requester (only works if they've started the bot).
  if (action === "ok") {
    await bot.api
      .sendMessage(tgId, "✅ دسترسی‌ات به برد تسک تایید شد. حالا صفحه را باز کن.")
      .catch(() => {});
  }
}

async function handleEmailCallback(
  ctx: Context,
  data: string,
  _bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  const action = parts[1];
  const emailId = Number(parts[2]);
  const chatId = ctx.chat?.id;
  const cardMsgId = ctx.callbackQuery?.message?.message_id;
  if (!Number.isFinite(emailId) || chatId == null) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  if (action === "sum") {
    const e = await getEmail(emailId).catch(() => null);
    if (!e) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    // Already summarized → the button is "spent". Don't re-run; just
    // acknowledge, and make sure the card shows the ✓ state.
    if ((e.summary ?? "").trim()) {
      await ctx.answerCallbackQuery({ text: "قبلاً خلاصه شده ✓" }).catch(() => {});
      const account = await resolveEmailAccount(e).catch(() => null);
      const card = buildEmailCard(e, account, { summary: e.summary });
      if (cardMsgId) {
        await ctx.api
          .editMessageText(chatId, cardMsgId, card.text, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: card.reply_markup,
          })
          .catch(() => {});
      }
      return;
    }
    await ctx.answerCallbackQuery({ text: "در حال خلاصه‌سازی…" }).catch(() => {});
    const r = await summarizeEmail({ subject: e.subject, from: e.fromEmail, text: e.textBody }).catch(() => null);
    if (!r) {
      await ctx.answerCallbackQuery({ text: "خلاصه‌سازی ناموفق بود.", show_alert: true }).catch(() => {});
      return;
    }
    const summary = `${r.summary}${r.keyPoints.length ? "\n\n• " + r.keyPoints.join("\n• ") : ""}`;
    await setEmailSummary(emailId, summary).catch(() => {});
    // Append the summary to the SAME card message in place (don't post
    // a separate message).
    const account = await resolveEmailAccount(e).catch(() => null);
    const card = buildEmailCard({ ...e, summary }, account);
    if (cardMsgId) {
      await ctx.api
        .editMessageText(chatId, cardMsgId, card.text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: card.reply_markup,
        })
        .catch(() => {});
    }
    return;
  }
  if (action === "reply") {
    await ctx.answerCallbackQuery().catch(() => {});
    const sent = await ctx.api
      .sendMessage(
        chatId,
        "↩️ متن پاسخت رو <b>به همین پیام ریپلای کن</b> تا برای فرستنده ایمیل بشه.",
        {
          parse_mode: "HTML",
          reply_markup: { force_reply: true, input_field_placeholder: "متن پاسخ ایمیل…" },
        },
      )
      .catch(() => null);
    if (sent) {
      await createEmailPendingReply(chatId, sent.message_id, emailId).catch(() => {});
    }
    return;
  }
  await ctx.answerCallbackQuery().catch(() => {});
}

// Handles email actions that arrive as plain group messages:
//   (a) a reply to the bot's force-reply prompt → send the email reply
//   (b) "/email to@x.com | subject | body" in the email channel → send
// Returns true when it consumed the message.
async function handleEmailGroupMessage(m: Message, bot: Bot): Promise<boolean> {
  const chatId = m.chat?.id;
  const text = m.text ?? m.caption ?? "";
  if (chatId == null) return false;

  // (a) reply to a pending force-reply prompt
  const replyTo = m.reply_to_message?.message_id;
  if (replyTo != null) {
    const emailId = await getEmailPendingReply(chatId, replyTo).catch(() => null);
    if (emailId != null) {
      await deleteEmailPendingReply(chatId, replyTo).catch(() => {});
      if (!text.trim()) return true;
      const r = await replyToEmail(emailId, text).catch((e) => ({ ok: false, error: String(e) }));
      await bot.api
        .sendMessage(
          chatId,
          r.ok ? "✅ پاسخ ایمیل ارسال شد." : `❌ ارسال ناموفق: ${r.error ?? "?"}`,
          { reply_parameters: { message_id: m.message_id } },
        )
        .catch(() => {});
      return true;
    }
  }

  // (b) /email compose command — only in a chat tied to an email account
  if (/^\/email(@\w+)?\b/i.test(text)) {
    const account = await getEmailAccountByChannel(chatId).catch(() => null);
    const rest = text.replace(/^\/email(@\w+)?\s*/i, "");
    const parts = rest.split("|").map((x) => x.trim());
    if (parts.length < 3 || !parts[0] || !parts[1]) {
      await bot.api
        .sendMessage(
          chatId,
          "فرمت: <code>/email گیرنده@دامنه | موضوع | متن</code>",
          { parse_mode: "HTML", reply_parameters: { message_id: m.message_id } },
        )
        .catch(() => {});
      return true;
    }
    const [to, subject, ...bodyParts] = parts;
    const r = await sendEmail({
      account,
      to: to!,
      subject: subject!,
      text: bodyParts.join(" | "),
    }).catch((e) => ({ ok: false, error: String(e) }) as { ok: boolean; error?: string });
    await bot.api
      .sendMessage(
        chatId,
        r.ok ? `✅ ایمیل به ${to} ارسال شد.` : `❌ ارسال ناموفق: ${r.error ?? "?"}`,
        { reply_parameters: { message_id: m.message_id } },
      )
      .catch(() => {});
    return true;
  }
  return false;
}

// Reveal / hide the body of a "🔒 پیام خصوصی" SMS card. Edits the
// inbox message in-place to swap between the redacted placeholder
// and the actual body, and toggles the keyboard button label.
async function handleSmsReveal(
  ctx: Context,
  action: "reveal" | "hide",
  logId: number,
): Promise<void> {
  const msg = ctx.callbackQuery?.message;
  if (!msg) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const row = await getPrivateMessage(logId).catch(() => null);
  if (!row) {
    await ctx
      .answerCallbackQuery({ text: "پیام پیدا نشد." })
      .catch(() => {});
    return;
  }
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
    );
  // Take the current message text up to the body placeholder/body and
  // splice in either the body or the placeholder. We rebuild around
  // the first blank line to preserve the header (☎️ +98… — Name).
  const oldText = msg.text ?? "";
  const headerEnd = oldText.indexOf("\n\n");
  const header = headerEnd > 0 ? oldText.slice(0, headerEnd) : oldText;
  let newText: string;
  let newKb: InlineKeyboard;
  // Find dedup id from the existing keyboard so we can reconstruct
  // the action row.
  const buttons = (msg.reply_markup as InlineKeyboardMarkup | undefined)
    ?.inline_keyboard;
  let dedupId: number | null = null;
  if (buttons) {
    for (const row of buttons) {
      for (const b of row) {
        const d = (b as { callback_data?: string }).callback_data;
        if (!d) continue;
        const m = /^sms:(?:ok|rm|block):(\d+)$/.exec(d);
        if (m) {
          dedupId = Number(m[1]);
          break;
        }
      }
      if (dedupId != null) break;
    }
  }
  if (action === "reveal") {
    const body = row.body || "(پیام بدون متن)";
    newText = `${header}\n\n${esc(body)}`;
    newKb = new InlineKeyboard().text("🙈 مخفی کن", `sms:hide:${logId}`);
    if (dedupId != null) {
      newKb
        .row()
        .text("🗑 پاک کن", `sms:rm:${dedupId}`)
        .text("🚫 این مدل رو نیار", `sms:block:${dedupId}`)
        .row()
        .text("✅ پذیرفتم", `sms:ok:${dedupId}`);
    }
    await revealPrivateMessage(logId).catch(() => {});
  } else {
    newText = `${header}\n\n🔒 <i>پیام خصوصی — تا «👁 نمایش متن» رو نزدی، متن نشون داده نمی‌شه.</i>`;
    newKb = new InlineKeyboard().text("👁 نمایش متن", `sms:reveal:${logId}`);
    if (dedupId != null) {
      newKb
        .row()
        .text("🗑 پاک کن", `sms:rm:${dedupId}`)
        .text("🚫 این مدل رو نیار", `sms:block:${dedupId}`)
        .row()
        .text("✅ پذیرفتم", `sms:ok:${dedupId}`);
    }
  }
  try {
    await ctx.api.editMessageText(msg.chat.id, msg.message_id, newText, {
      parse_mode: "HTML",
      reply_markup: newKb,
    });
    await ctx
      .answerCallbackQuery({
        text: action === "reveal" ? "نمایش داده شد." : "مخفی شد.",
      })
      .catch(() => {});
  } catch (err) {
    console.warn("[sms_cb] reveal/hide failed:", err);
    await ctx.answerCallbackQuery({ text: "خطا." }).catch(() => {});
  }
}

// 📝 Transcribe button on voice / video-note copies forwarded into
// the voice_storage channel. callback_data is the constant "tx:lookup"
// — the button is always attached to the storage message itself, so
// we recover the chat + message ids from ctx.callbackQuery.message and
// look up the source file_id in media_router_messages.
async function handleTranscribeCallback(
  ctx: Context,
  _data: string,
  bot: Bot,
): Promise<void> {
  const cbMsg = ctx.callbackQuery?.message;
  if (!cbMsg) {
    await ctx.answerCallbackQuery({ text: "no message context", show_alert: true });
    return;
  }
  const storageChatId = cbMsg.chat.id;
  const storageMessageId = cbMsg.message_id;
  if (!sttConfigured()) {
    await ctx.answerCallbackQuery({
      text: "STT not configured — set GROQ_API_KEY or OPENROUTER_API_KEY.",
      show_alert: true,
    });
    return;
  }
  // Look up media_router_messages first (fast path with cached
  // metadata). If the row is missing for any reason (the recordCopy
  // race-lost, or the bot was added to a channel manually before we
  // started tracking it), fall back to the file id on the callback
  // message itself — the Transcribe button is always attached to the
  // voice/video_note, so the file_id is RIGHT THERE.
  const row = await getRoutedMessage({ storageChatId, storageMessageId });
  let fileId: string | null = row?.fileId ?? null;
  let senderName: string | null = row?.sourceSenderName ?? null;
  let alreadyTranscribed: string | null = row?.transcript ?? null;
  if (!fileId) {
    type MessageWithMedia = {
      voice?: { file_id: string };
      video_note?: { file_id: string };
      audio?: { file_id: string };
      reply_to_message?: MessageWithMedia;
    };
    const m = cbMsg as MessageWithMedia;
    fileId =
      m.voice?.file_id ??
      m.video_note?.file_id ??
      m.audio?.file_id ??
      // Sometimes the button is on the follow-up caption message
      // (video_note case) where the audio is on the replied-to msg.
      m.reply_to_message?.voice?.file_id ??
      m.reply_to_message?.video_note?.file_id ??
      m.reply_to_message?.audio?.file_id ??
      null;
  }
  if (!fileId) {
    await ctx.answerCallbackQuery({
      text: "media metadata not found",
      show_alert: true,
    });
    return;
  }
  if (alreadyTranscribed) {
    await ctx.answerCallbackQuery({ text: "Already transcribed." });
    return;
  }
  await ctx.answerCallbackQuery({ text: "در حال transcribe…" });
  try {
    const { text } = await transcribeAudio({
      botToken: config.telegramBotToken,
      fileId,
      chatId: storageChatId,
    });
    const transcript = (text ?? "").trim();
    if (!transcript) {
      await bot.api.sendMessage(
        storageChatId,
        "📝 transcript خالی برگشت.",
        { reply_to_message_id: storageMessageId },
      ).catch(() => {});
      return;
    }
    await markTranscribed({
      storageChatId,
      storageMessageId,
      transcript,
    });
    // Reply directly under the original copy so the text and audio
    // stay paired in the channel. We don't editMessageCaption on the
    // voice itself because video_note doesn't support captions and
    // we want one consistent UX.
    const header = senderName
      ? `📝 <b>${escapeForHtml(senderName)}</b>:`
      : "📝";
    const chunks = chunkText(`${header}\n${escapeForHtml(transcript)}`, 4000);
    for (const chunk of chunks) {
      await bot.api.sendMessage(storageChatId, chunk, {
        parse_mode: "HTML",
        reply_to_message_id: storageMessageId,
      });
    }
    // Strip the button now that there's a transcript.
    await bot.api
      .editMessageReplyMarkup(storageChatId, storageMessageId, {
        reply_markup: undefined,
      })
      .catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[transcribe] failed:", msg);
    await bot.api.sendMessage(
      storageChatId,
      `📝 transcribe ناموفق: ${msg.slice(0, 200)}`,
      { reply_to_message_id: storageMessageId },
    ).catch(() => {});
  }
}

function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chunkText(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + max));
    i += max;
  }
  return out;
}

async function handleAutoSummaryCallback(
  ctx: Context,
  data: string,
  bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length < 4) {
    await ctx.answerCallbackQuery({ text: "bad callback", show_alert: true });
    return;
  }
  const action = parts[1]!;
  const chatId = Number(parts[2]);
  const startSec = Number(parts[3]);
  if (!Number.isFinite(chatId) || !Number.isFinite(startSec)) {
    await ctx.answerCallbackQuery({ text: "bad callback", show_alert: true });
    return;
  }
  const cb = ctx.callbackQuery;
  if (!cb) return;
  const rule = await getChatRule(chatId).catch(() => null);
  if (!rule) {
    await ctx.answerCallbackQuery({
      text: "chat rule missing",
      show_alert: true,
    });
    return;
  }
  const settings = await getSettings();
  const messages = await listChatThreaded({
    chatId,
    gapMinutes: rule.autoSummarizeGapMinutes || 5,
    limit: 1000,
  });
  const target = messages.find(
    (m) => Math.floor(m.createdAt.getTime() / 1000) === startSec,
  );
  if (!target) {
    await ctx.answerCallbackQuery({
      text: "thread not found",
      show_alert: true,
    });
    return;
  }
  const threadMsgs = messages
    .filter((m) => m.threadNo === target.threadNo)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (action === "resum") {
    await ctx.answerCallbackQuery({ text: "در حال خلاصه‌سازی…" });
    try {
      const s = await summarizeGroup({
        chatTitle: rule.chatTitle,
        ownerName: settings.ownerName,
        ownerContext: settings.ownerContext,
        chatNotes: rule.notes ?? null,
        outputLanguage: "Persian (فارسی)",
        messages: threadMsgs.map((m) => ({
          sender: m.fromOwner
            ? settings.ownerDisplayName || settings.ownerName || "owner"
            : m.senderName,
          text: m.transcript
            ? `[voice] ${m.transcript}`
            : m.mediaDescription
              ? `[${m.mediaKind ?? "media"}] ${m.mediaDescription}`
              : m.mediaKind && !m.messageText
                ? `[${m.mediaKind}]`
                : m.messageText,
          at: m.createdAt,
        })),
      });
      await upsertThreadSummary({
        chatId: rule.chatId,
        threadStartedAt: threadMsgs[0]!.createdAt,
        threadEndedAt: threadMsgs[threadMsgs.length - 1]!.createdAt,
        messageCount: threadMsgs.length,
        summary: s.summary,
        topics: s.topics,
        actionItems: s.actionItems,
      }).catch(() => {});
      const chatLabel =
        [rule.firstName, rule.lastName].filter(Boolean).join(" ").trim() ||
        rule.chatTitle ||
        `chat ${rule.chatId}`;
      const body = [
        `📬 خلاصه‌ی thread — ${chatLabel} (re-generated)`,
        "",
        s.summary,
        s.topics.length > 0 ? `\nموضوعات: ${s.topics.join(" · ")}` : "",
        s.actionItems.length > 0
          ? `\nاکشن‌ها:\n• ${s.actionItems.join("\n• ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 3800);
      const keyboard = new InlineKeyboard()
        .text("💬 جواب پیشنهادی", `as:reply:${chatId}:${startSec}`)
        .text("🔄 Regenerate", `as:resum:${chatId}:${startSec}`);
      try {
        await ctx.editMessageText(body, { reply_markup: keyboard });
      } catch (err) {
        console.warn("[as_callback] editMessageText failed:", err);
      }
    } catch (err) {
      console.error("[as_callback] resum failed:", err);
    }
    return;
  }

  if (action === "reply") {
    await ctx.answerCallbackQuery({ text: "در حال تولید پاسخ…" });
    const history = threadMsgs.map((m) => ({
      from: m.fromOwner ? ("owner" as const) : ("other" as const),
      senderName: m.senderName,
      text: m.transcript
        ? m.transcript
        : m.mediaDescription
          ? `[${m.mediaKind ?? "media"}] ${m.mediaDescription}`
          : m.messageText,
    }));
    const senderName =
      threadMsgs.find((m) => !m.fromOwner)?.senderName ?? "the other person";
    let reply = "";
    try {
      reply = await aiConversationReply({
        ownerName: settings.ownerName,
        ownerDisplayName: settings.ownerDisplayName,
        ownerContext: settings.ownerContext,
        senderName,
        history,
        nickname: rule.nickname,
        relationship: rule.relationship,
        relationshipNotes: rule.relationshipNotes,
        talkStyleNotes: rule.talkStyleNotes,
        toneProfile: rule.toneProfile,
        chatId: rule.chatId,
      });
    } catch (err) {
      console.error("[as_callback] generate reply failed:", err);
    }
    if (!reply) {
      try {
        await ctx.reply("پاسخ AI تولید نشد. دوباره تلاش کن.");
      } catch {}
      return;
    }
    // Append suggested reply to the channel post + add Send/Regenerate
    // buttons. We don't auto-send to the source chat — explicit
    // confirmation via the Send button.
    const orig =
      cb.message?.text ?? cb.message?.caption ?? "";
    const newBody = `${orig}\n\n🤖 پاسخ پیشنهادی:\n${reply}`.slice(0, 3800);
    const keyboard = new InlineKeyboard()
      .text("✅ ارسال به چت", `as:send:${chatId}:${startSec}`)
      .text("🔄 دوباره", `as:reply:${chatId}:${startSec}`);
    try {
      await ctx.editMessageText(newBody, { reply_markup: keyboard });
    } catch (err) {
      console.warn("[as_callback] editMessageText failed:", err);
    }
    return;
  }

  if (action === "send") {
    // Recover the suggested reply from the channel post body.
    const orig =
      cb.message?.text ?? cb.message?.caption ?? "";
    const marker = "🤖 پاسخ پیشنهادی:\n";
    const idx = orig.lastIndexOf(marker);
    if (idx === -1) {
      await ctx.answerCallbackQuery({
        text: "پاسخ پیشنهادی پیدا نشد.",
        show_alert: true,
      });
      return;
    }
    const replyText = orig.slice(idx + marker.length).trim();
    if (!replyText) {
      await ctx.answerCallbackQuery({
        text: "پاسخ خالی.",
        show_alert: true,
      });
      return;
    }
    // For DMs we send via business connection. We don't always have
    // bcId on the rule, so look it up from a recent log row.
    const rows = await sql()`
      SELECT business_connection_id FROM messages_log
      WHERE chat_id = ${chatId}
        AND business_connection_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`;
    const bcId = (rows[0] as { business_connection_id: string } | undefined)
      ?.business_connection_id;
    try {
      if (bcId) {
        await bot.api.sendMessage(chatId, replyText, {
          business_connection_id: bcId,
        });
      } else {
        await bot.api.sendMessage(chatId, replyText);
      }
      await ctx.answerCallbackQuery({ text: "✅ ارسال شد" });
      const newBody = `${orig}\n\n✅ ارسال شد در ${new Date().toLocaleTimeString()}`.slice(
        0,
        3800,
      );
      try {
        await ctx.editMessageText(newBody);
      } catch {}
    } catch (err) {
      console.error("[as_callback] send failed:", err);
      await ctx.answerCallbackQuery({
        text: "ارسال نشد: " + String(err).slice(0, 80),
        show_alert: true,
      });
    }
    return;
  }

  await ctx.answerCallbackQuery({ text: "unknown action" });
}

// Owner typed a reply (or any message) inside the summary_inbox
// channel/group. If it's a reply to one of our delivered summaries,
// forward the text back to the original chat — over the same
// business_connection if available, otherwise plain sendMessage.
// Returns true when the message was a recognised inbox reply and we
// handled it (so the normal classify/log path should skip it).
async function handleInboxReply(msg: Message, bot: Bot): Promise<boolean> {
  // Must be a chat tagged as summary_inbox.
  const rule = await getChatRule(msg.chat.id).catch(() => null);
  if (!rule || rule.functionRole !== "summary_inbox") return false;
  // Must be a reply to one of our prior summary posts.
  const replyTo = msg.reply_to_message;
  if (!replyTo) return false;
  // Ignore bot-typed messages (our own summary deliveries and edits).
  if (msg.from?.is_bot) return false;
  // Need actual text to forward; ignore caption-only media for now.
  const text = msg.text?.trim();
  if (!text) return false;

  const mapping = await findThreadByInboxMessage(
    msg.chat.id,
    replyTo.message_id,
  );
  if (!mapping) return false;

  // Find a recent bcId for the source chat (we used the business
  // connection to receive the original messages; we send through it
  // to deliver as the owner).
  let bcId: string | null = null;
  try {
    const rows = await sql()`
      SELECT business_connection_id FROM messages_log
      WHERE chat_id = ${mapping.chatId}
        AND business_connection_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`;
    bcId =
      (rows[0] as { business_connection_id: string } | undefined)
        ?.business_connection_id ?? null;
  } catch (err) {
    console.warn("[inbox_reply] bcId lookup failed:", err);
  }

  try {
    if (bcId) {
      await bot.api.sendMessage(mapping.chatId, text, {
        business_connection_id: bcId,
      });
    } else {
      await bot.api.sendMessage(mapping.chatId, text);
    }
    try {
      await bot.api.sendMessage(
        msg.chat.id,
        `✅ ارسال شد به چت مبدا`,
        { reply_parameters: { message_id: msg.message_id } },
      );
    } catch {}
    return true;
  } catch (err) {
    console.error("[inbox_reply] send failed:", err);
    try {
      await bot.api.sendMessage(
        msg.chat.id,
        `❌ ارسال نشد: ${String(err).slice(0, 200)}`,
        { reply_parameters: { message_id: msg.message_id } },
      );
    } catch {}
    return true;
  }
}

// In ai_listen mode with auto_summarize_enabled, whenever a NEW
// message arrives we check the gap from the previously logged
// message: if that gap exceeds the chat's configured silence window
// (default 5min), the previous thread just "closed" — we summarise
// what was in it and post that summary to the primary summary_inbox
// channel. Fire-and-forget so we never block the regular reply path.
export async function maybeAutoSummarizeOnArrival(args: {
  rule: ChatRule | null;
  msg: Message;
  bot: Bot;
}): Promise<void> {
  const { rule, msg, bot } = args;
  if (!rule || rule.mode !== "ai_listen") return;
  if (!rule.autoSummarizeEnabled) return;
  if (!hasDb()) return;
  const gapMin = rule.autoSummarizeGapMinutes || 5;

  try {
    // Previous logged row (any kind, owner or other) BEFORE the row
    // that handleBusinessMessage / handleGroupMessage just inserted.
    const rows = await sql()`
      SELECT created_at, from_owner FROM messages_log
      WHERE chat_id = ${msg.chat.id}
        AND message_id <> ${msg.message_id}
      ORDER BY created_at DESC
      LIMIT 1`;
    const prev = rows[0] as
      | { created_at: Date; from_owner: boolean }
      | undefined;
    if (!prev) return;
    // If the previous message was from the OWNER, the previous thread
    // was "open" (we replied last, waiting for them) — don't summarise
    // or generate a suggested reply, even if a long gap passed.
    if (prev.from_owner) return;
    const gapMs = Date.now() - new Date(prev.created_at).getTime();
    if (gapMs < gapMin * 60_000) return;
    // The previous thread JUST closed (we got the first message after
    // a long silence). Idempotency: if last_auto_summary_at is newer
    // than prev's timestamp, we already summarised this gap.
    if (
      rule.lastAutoSummaryAt &&
      rule.lastAutoSummaryAt.getTime() >= new Date(prev.created_at).getTime()
    ) {
      return;
    }
    await deliverAutoSummary({
      bot,
      rule,
      throughTs: new Date(prev.created_at),
    });
  } catch (err) {
    console.error("[auto_summary] reactive trigger failed:", err);
  }
}

// Used by both the reactive path (handleBusinessMessage) and the
// cron path (catches threads that just stopped without a follow-up).
export async function deliverAutoSummary(args: {
  bot: Bot;
  rule: ChatRule;
  throughTs: Date;
}): Promise<boolean> {
  const { bot, rule, throughTs } = args;
  const inbox = await getPrimarySummaryInbox();
  if (!inbox) {
    console.warn(
      "[auto_summary] no summary_inbox configured; skipping for chat=" +
        rule.chatId,
    );
    return false;
  }
  const gap = rule.autoSummarizeGapMinutes || 5;
  // Cluster the chat's messages so we can grab JUST the most-recent
  // thread whose endedAt <= throughTs.
  const messages = await listChatThreaded({
    chatId: rule.chatId,
    gapMinutes: gap,
    limit: 1000,
  });
  if (messages.length === 0) return false;
  // Find the thread that contains `throughTs` (the last message
  // before the silence gap).
  const target = messages.find(
    (m) => m.createdAt.getTime() === throughTs.getTime(),
  );
  if (!target) return false;
  const threadNo = target.threadNo;
  const threadMsgs = messages
    .filter((m) => m.threadNo === threadNo)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (threadMsgs.length === 0) return false;
  // If the OWNER sent the last message of this thread, the thread is
  // still "open" from our side — we already replied; no summary or
  // suggested reply needed regardless of how long the silence is.
  if (threadMsgs[threadMsgs.length - 1]!.fromOwner) {
    return false;
  }

  const settings = await getSettings();
  const chatLabel =
    [rule.firstName, rule.lastName].filter(Boolean).join(" ").trim() ||
    rule.chatTitle ||
    `chat ${rule.chatId}`;

  let summary;
  try {
    summary = await summarizeGroup({
      chatTitle: chatLabel,
      ownerName: settings.ownerName,
      ownerContext: settings.ownerContext,
      chatNotes: rule.notes ?? null,
      outputLanguage: "Persian (فارسی)",
      messages: threadMsgs.map((m) => ({
        sender: m.fromOwner
          ? settings.ownerDisplayName || settings.ownerName || "owner"
          : m.senderName,
        text: m.transcript
          ? `[voice] ${m.transcript}`
          : m.mediaDescription
            ? `[${m.mediaKind ?? "media"}] ${m.mediaDescription}`
            : m.mediaKind && !m.messageText
              ? `[${m.mediaKind}]`
              : m.messageText,
        at: m.createdAt,
      })),
    });
  } catch (err) {
    console.error("[auto_summary] summarise failed:", err);
    return false;
  }

  await upsertThreadSummary({
    chatId: rule.chatId,
    threadStartedAt: threadMsgs[0]!.createdAt,
    threadEndedAt: threadMsgs[threadMsgs.length - 1]!.createdAt,
    messageCount: threadMsgs.length,
    summary: summary.summary,
    topics: summary.topics,
    actionItems: summary.actionItems,
  }).catch((err) =>
    console.error("[auto_summary] upsertThreadSummary failed:", err),
  );

  // Generate a suggested reply in parallel with the summary so the
  // owner gets summary + draft together. If it fails (or comes back
  // blank), we still post the summary — owner can hit 🔄 to retry.
  let suggested = "";
  try {
    const history = threadMsgs.map((m) => ({
      from: m.fromOwner ? ("owner" as const) : ("other" as const),
      senderName: m.senderName,
      text: m.transcript
        ? m.transcript
        : m.mediaDescription
          ? `[${m.mediaKind ?? "media"}] ${m.mediaDescription}`
          : m.messageText,
    }));
    const senderName =
      threadMsgs.find((m) => !m.fromOwner)?.senderName ?? "the other person";
    suggested = await aiConversationReply({
      ownerName: settings.ownerName,
      ownerDisplayName: settings.ownerDisplayName,
      ownerContext: settings.ownerContext,
      senderName,
      history,
      nickname: rule.nickname,
      relationship: rule.relationship,
      relationshipNotes: rule.relationshipNotes,
      talkStyleNotes: rule.talkStyleNotes,
      toneProfile: rule.toneProfile,
      chatId: rule.chatId,
    });
  } catch (err) {
    console.warn("[auto_summary] suggested reply failed:", err);
  }

  const header = `📬 خلاصه‌ی thread — ${chatLabel}`;
  const body = [
    header,
    "",
    summary.summary,
    summary.topics.length > 0
      ? `\nموضوعات: ${summary.topics.join(" · ")}`
      : "",
    summary.actionItems.length > 0
      ? `\nاکشن‌ها:\n• ${summary.actionItems.join("\n• ")}`
      : "",
    `\n⏱ ${threadMsgs.length} پیام · ${threadMsgs[0]!.createdAt.toLocaleString()} → ${threadMsgs[threadMsgs.length - 1]!.createdAt.toLocaleString()}`,
    suggested ? `\n\n🤖 پاسخ پیشنهادی:\n${suggested}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3800);

  // callback_data limit is 64 bytes. We pack { action, chatId,
  // threadStartTs (unix seconds) }. The handler recovers the thread
  // by (chatId, started_at) and regenerates the AI reply.
  const startSec = Math.floor(threadMsgs[0]!.createdAt.getTime() / 1000);
  const keyboard = suggested
    ? new InlineKeyboard()
        .text("✅ ارسال", `as:send:${rule.chatId}:${startSec}`)
        .text("🔄 پاسخ دوباره", `as:reply:${rule.chatId}:${startSec}`)
        .row()
        .text("📋 خلاصه دوباره", `as:resum:${rule.chatId}:${startSec}`)
    : new InlineKeyboard()
        .text("💬 جواب پیشنهادی", `as:reply:${rule.chatId}:${startSec}`)
        .text("🔄 Regenerate", `as:resum:${rule.chatId}:${startSec}`);

  try {
    const sent = await bot.api.sendMessage(inbox.chatId, body, {
      reply_markup: keyboard,
    });
    await markAutoSummaryDelivered(rule.chatId);
    await setThreadSummaryInbox({
      chatId: rule.chatId,
      threadStartedAt: threadMsgs[0]!.createdAt,
      inboxChatId: inbox.chatId,
      inboxMessageId: sent.message_id,
    }).catch((err) =>
      console.error("[auto_summary] setThreadSummaryInbox failed:", err),
    );
    return true;
  } catch (err) {
    console.error(
      `[auto_summary] send to inbox=${inbox.chatId} failed:`,
      err,
    );
    return false;
  }
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
    await handleBusinessEdit(ctx.update.edited_business_message, bot).catch(
      (err) => console.error("[edit] handler error:", err),
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
      console.error("[delete] mark failed:", err);
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
        console.error("[as_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("tx:")) {
      await handleTranscribeCallback(ctx, data, bot).catch((err) =>
        console.error("[transcribe] failed:", err),
      );
      return;
    }
    if (data.startsWith("insta:")) {
      await handleInstaCallback(ctx, data, bot).catch((err) =>
        console.error("[insta_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("nw:")) {
      await handleNoteWatchCallback(ctx, data, bot).catch((err) =>
        console.error("[nw_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("fu:")) {
      await handleFollowUpCallback(ctx, data, bot).catch((err) =>
        console.error("[fu_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("sms:")) {
      await handleSmsCallback(ctx, data, bot).catch((err) =>
        console.error("[sms_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("em:")) {
      await handleEmailCallback(ctx, data, bot).catch((err) =>
        console.error("[email_callback] failed:", err),
      );
      return;
    }
    if (data.startsWith("board:")) {
      await handleBoardAccessCallback(ctx, data, bot).catch((err) =>
        console.error("[board_callback] failed:", err),
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
            text: "Dashboard not configured.",
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
            text: "DB not configured.",
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
      console.error("[ui] callback failed:", err);
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
    const m = ctx.update.message;
    // If this message lands in a group/channel that the owner has
    // tagged as summary_inbox and it's a reply to one of our delivered
    // summaries, route it back to the source chat. Runs BEFORE the
    // normal group handler so we don't classify our own routed reply.
    const routed = await handleInboxReply(m, bot).catch((err) => {
      console.error("[inbox_reply] handler error:", err);
      return false;
    });
    if (routed) return;
    // Email: (a) a reply to the bot's ↩️ force-reply prompt → send the
    // email reply; (b) a /email compose command in the email channel.
    const handledEmail = await handleEmailGroupMessage(m, bot).catch((err) => {
      console.error("[email] group handler error:", err);
      return false;
    });
    if (handledEmail) return;
    // Groups/supergroups: classify + log + alert if urgent. Requires
    // 'Disable group privacy' on the bot in BotFather so Telegram
    // forwards every message instead of just /commands and mentions.
    if (m.chat.type === "group" || m.chat.type === "supergroup") {
      await handleGroupMessage(m, bot).catch((err) =>
        console.error("[group] handler error:", err),
      );
      return;
    }
    // Private chats: existing secretary-reply relay (a registered
    // secretary replying to a forwarded message in their DM with the
    // bot). For anything else this no-ops.
    await handleSecretaryReply(m, bot).catch((err) =>
      console.error("[secretary] handler error:", err),
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
        console.warn("[rules] direct-DM release failed:", err),
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
      console.error("[inbox_reply] channel handler error:", err);
      return false;
    });
    if (routed) return;
    await handleChannelPost(m, bot).catch((err) =>
      console.error("[channel_post] handler error:", err),
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
      console.error("[edited_channel_post] handler error:", err),
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
      (err) => console.error("[secretary] reaction error:", err),
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
      console.warn("[chat_member] upsert failed:", err);
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
      console.error("[bot] Telegram API:", e.description);
      source = "bot:telegram-api";
    } else if (e instanceof HttpError) {
      console.error("[bot] network:", e);
      source = "bot:network";
    } else {
      console.error("[bot] uncaught:", e);
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

// Lightweight gate before paying for an LLM call: most messages
// don't carry an OTP, so we skip extraction unless the body has at
// least one 4+ digit run. We normalise Persian / Arabic digits first
// so codes like "۱۴۵۵۵۵۵" still register — JS \d only matches Latin
// digits.
function looksLikePossibleOtp(text: string): boolean {
  if (!text || text.length < 4) return false;
  // We can't import lib/rules at module-eval (circular) so inline a
  // tiny normaliser. Same semantics as normaliseDigits over there.
  const FA = "۰۱۲۳۴۵۶۷۸۹";
  const AR = "٠١٢٣٤٥٦٧٨٩";
  const ascii = text
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
  return /\b\d{4,}\b/.test(ascii);
}

async function maybeExtractOtp(args: {
  logId: number;
  text: string;
}): Promise<void> {
  if (!looksLikePossibleOtp(args.text)) return;
  try {
    const { extractOtpCodeAi } = await import("./rules");
    const { saveOtpCode } = await import("./db");
    const code = await extractOtpCodeAi(args.text);
    if (code) {
      await saveOtpCode(args.logId, code);
      console.log(`[otp] saved code=${code} for log=${args.logId}`);
    }
  } catch (err) {
    console.warn(`[otp] extract failed for log=${args.logId}:`, err);
  }
}

// Note watchlist: scan every incoming message body against the
// operator's configured "watched concepts". When the LLM finds a
// match, persist a chat_notes row, log the match for the dashboard,
// and (when notes_inbox is configured) forward the hit to that
// channel so the operator notices in real time. Skip-on-failure —
// nothing here can drop the original message.
// Exported so /api/sms-webhook can run the same watchlist scan on
// incoming SMS bodies — single source of truth.
export async function maybeApplyNoteWatch(args: {
  logId: number;
  text: string;
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  messageId: number;
  businessConnectionId: string | null;
  bot: Bot;
}): Promise<void> {
  if (!args.text.trim()) {
    console.log(`[watchlist] skip chat=${args.chatId}: empty text`);
    return;
  }
  if (!hasDb()) return;
  const settings = await getSettings();
  // Master switch.
  if ((settings.notesWatchlistEnabled ?? "true").toLowerCase() === "false") {
    console.log(
      `[watchlist] skip chat=${args.chatId}: master switch off`,
    );
    return;
  }
  // Short-message gate to save LLM cost.
  const minLen = Math.max(
    Number(settings.notesWatchlistMinMessageLength) || 0,
    0,
  );
  if (args.text.trim().length < minLen) {
    console.log(
      `[watchlist] skip chat=${args.chatId}: text len ${args.text.trim().length} < min ${minLen}`,
    );
    return;
  }
  const globalCooldownMin = Math.max(
    Number(settings.notesWatchlistCooldownMinutes) || 0,
    0,
  );
  const forwardDefault =
    (settings.notesWatchlistForwardToInbox ?? "true").toLowerCase() !== "false";

  const items = await listNoteWatchItemsWithAliases({
    enabledOnly: true,
  }).catch(() => []);
  if (items.length === 0) {
    console.log(
      `[watchlist] skip chat=${args.chatId}: zero enabled concepts`,
    );
    return;
  }
  let matches: Awaited<ReturnType<typeof scanForWatchlistConcepts>> = [];
  try {
    matches = await scanForWatchlistConcepts({
      text: args.text,
      items: items.map((it) => ({
        id: it.id,
        concept: it.concept,
        description: it.description,
        aliases: it.aliases,
        context: it.context,
      })),
      chatTitle: args.chatTitle,
      senderName: args.senderName,
      chatId: args.chatId,
      businessConnectionId: args.businessConnectionId ?? undefined,
    });
  } catch (err) {
    console.warn("[watchlist] scan failed:", err);
    return;
  }
  console.log(
    `[watchlist] scan chat=${args.chatId} items=${items.length} matches=${matches.length} text="${args.text.trim().slice(0, 80)}"`,
  );
  if (matches.length === 0) return;
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
    );
  const byId = new Map(items.map((it) => [it.id, it]));
  const inboxes = await listChatsByFunction("notes_inbox").catch(() => []);
  const inbox = inboxes[0];
  for (const m of matches) {
    const item = byId.get(m.itemId);
    if (!item) continue;
    // Per-concept cooldown wins over global; 0 / null = use global.
    const effectiveCooldownMin =
      item.cooldownOverrideMinutes ?? globalCooldownMin;
    if (effectiveCooldownMin > 0) {
      const recent = await hasRecentNoteWatchMatch({
        itemId: item.id,
        chatId: args.chatId,
        withinMinutes: effectiveCooldownMin,
      }).catch(() => false);
      if (recent) {
        console.log(
          `[watchlist] cooldown ${effectiveCooldownMin}m active item=${item.id} ("${item.concept}") chat=${args.chatId} — skipping. Lower cooldown in /notes → تنظیمات if this is unintended.`,
        );
        continue;
      }
    }
    // Record the match FIRST so we have its id for the inline
    // keyboard's callback_data. The forward step below uses it to
    // wire the "📄 متن کامل" / "🚩 گزارش خطا" buttons; if the row
    // wasn't there yet the buttons would be orphaned.
    const matchRow = await recordNoteWatchMatch({
      itemId: item.id,
      chatId: args.chatId,
      chatTitle: args.chatTitle,
      messageLogId: args.logId || null,
      sourceMessageId: args.messageId,
      senderName: args.senderName,
      quote: m.quote,
      reason: m.reason
        ? m.matchedAlias && m.matchedAlias.toLowerCase() !== item.concept.toLowerCase()
          ? `(${m.matchedAlias}) ${m.reason}`
          : m.reason
        : m.matchedAlias,
      forwardedTo: null,
    }).catch((err) => {
      console.warn(`[watchlist] record failed item=${item.id}:`, err);
      return null;
    });
    let forwardedTo: number | null = null;
    // Per-concept forward toggle overrides the global default.
    const shouldForward = item.forwardToInbox && forwardDefault;
    if (inbox && shouldForward) {
      try {
        const aliasTag =
          m.matchedAlias && m.matchedAlias.toLowerCase() !== item.concept.toLowerCase()
            ? ` <i>(${esc(m.matchedAlias)})</i>`
            : "";
        const priorityTag =
          item.priority === "high"
            ? "🚨 "
            : item.priority === "low"
              ? "🔅 "
              : "";
        const conceptIcon = item.emoji ? `${item.emoji} ` : "📝 ";
        const text =
          `${priorityTag}${conceptIcon}<b>${esc(item.concept)}</b>${aliasTag}\n` +
          `از: ${esc(args.senderName)}` +
          (args.chatTitle ? ` · ${esc(args.chatTitle)}` : "") +
          `\n\n💬 «${esc(m.quote)}»` +
          (m.reason ? `\n\n🔎 ${esc(m.reason)}` : "");
        const keyboard = matchRow
          ? new InlineKeyboard()
              .text("📄 متن کامل", `nw:full:${matchRow.id}`)
              .text("✅ تأیید", `nw:ok:${matchRow.id}`)
              .text("🚩 گزارش خطا", `nw:wrong:${matchRow.id}`)
          : undefined;
        await args.bot.api.sendMessage(inbox.chatId, text.slice(0, 4096), {
          parse_mode: "HTML",
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
        forwardedTo = inbox.chatId;
      } catch (err) {
        console.warn(
          `[watchlist] notes_inbox forward failed item=${item.id} chat=${inbox.chatId}:`,
          err,
        );
      }
    }
    await addChatNote({
      chatId: args.chatId,
      sourceMessageId: args.messageId,
      kind: "watchlist",
      title: item.concept,
      content: m.quote,
      senderName: args.senderName,
      metadata: {
        watch_item_id: item.id,
        match_id: matchRow?.id ?? null,
        matched_alias: m.matchedAlias,
        reason: m.reason || null,
        chat_title: args.chatTitle,
      },
    }).catch((err) =>
      console.warn(`[watchlist] addChatNote failed item=${item.id}:`, err),
    );
    console.log(
      `[watchlist] match item=${item.id} chat=${args.chatId} concept="${item.concept}"`,
    );
  }
}

// Telegram delivers shared contacts as a regular message with
// msg.contact set; the payload optionally includes user_id when the
// contact is a Telegram user. We harvest these into phone_contacts
// so findOwnerOfPhone can resolve the SMS sender on later lookups.
function harvestContactShare(msg: Message): void {
  const c = msg.contact;
  if (!c || !c.phone_number) return;
  void recordPhoneContact({
    phoneFull: c.phone_number,
    telegramUserId: c.user_id ?? null,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    username: null,
    source: "contact_share",
  }).catch((err) => console.warn("[phone_contacts] save failed:", err));
}

async function handleBusinessMessage(msg: Message, bot: Bot): Promise<void> {
  // Hard ignore: operator marked this chat as "do not process". Bail
  // before any classifier / log / route / rule work. Cached briefly
  // in lib/db so a burst of messages from the same chat doesn't
  // round-trip per message.
  if (await isChatIgnored(msg.chat.id).catch(() => false)) {
    console.log(`[ignore] dropping business_message in chat=${msg.chat.id} (ignored=true)`);
    return;
  }
  harvestContactShare(msg);
  // Diagnostic — every media payload that reaches this handler gets a
  // "received_business" row in media_routing_log so we can tell apart
  // "the bot never saw it" (no received row) from "the bot saw it but
  // bailed before routing" (received row but no follow-up).
  if (msg.voice || msg.video_note || msg.video || msg.photo) {
    const kind = msg.voice
      ? "voice"
      : msg.video_note
        ? "video_note"
        : msg.video
          ? "video"
          : "photo";
    void logMediaRouting({
      sourceChatId: msg.chat.id,
      sourceMessageId: msg.message_id,
      kind,
      decision: "received_business",
    }).catch(() => {});
  }
  const bcId = msg.business_connection_id;
  if (!bcId) {
    if (msg.voice || msg.video_note || msg.video || msg.photo) {
      const kind = msg.voice
        ? "voice"
        : msg.video_note
          ? "video_note"
          : msg.video
            ? "video"
            : "photo";
      void logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "skipped_no_bcid",
      }).catch(() => {});
    }
    return;
  }

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
  if (!hasContent) {
    if (msg.voice || msg.video_note || msg.video || msg.photo) {
      const kind = msg.voice
        ? "voice"
        : msg.video_note
          ? "video_note"
          : msg.video
            ? "video"
            : "photo";
      void logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "skipped_no_content",
      }).catch(() => {});
    }
    return;
  }

  // When the bot itself sends a message via business_connection_id (e.g.
  // an ai_chat / auto_reply / friendly_reply / secretary relay), Telegram
  // echoes the message back as a business_message update with
  // sender_business_bot set. Without this guard we'd treat that echo as a
  // brand-new incoming message and reply again, looping forever.
  if (
    (msg as unknown as { sender_business_bot?: unknown }).sender_business_bot
  ) {
    if (msg.voice || msg.video_note || msg.video || msg.photo) {
      const kind = msg.voice
        ? "voice"
        : msg.video_note
          ? "video_note"
          : msg.video
            ? "video"
            : "photo";
      void logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "skipped_bot_echo",
      }).catch(() => {});
    }
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
  // secretary session for this chat, then bail. media-router still
  // gets fired below so the owner's OWN voices/photos auto-route to
  // their *_storage channels (they're often the most useful ones to
  // archive — voice notes to friends, photos taken with the camera).
  if (!owner && (msg.voice || msg.video_note || msg.video || msg.photo)) {
    const kind = msg.voice
      ? "voice"
      : msg.video_note
        ? "video_note"
        : msg.video
          ? "video"
          : "photo";
    void logMediaRouting({
      sourceChatId: msg.chat.id,
      sourceMessageId: msg.message_id,
      kind,
      decision: "skipped_no_owner",
    }).catch(() => {});
  }
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
    // Owner-sent voices / videos / photos are NOT routed to the
    // *_storage channels. The owner already has these on their own
    // device; copying them just clutters the archive with duplicates.
    // Only incoming media from the other party gets routed (handled
    // in the main path below). We still log the diagnostic so the
    // operator can see the message reached this branch.
    if (msg.voice || msg.video_note || msg.video || msg.photo) {
      const kind = msg.voice
        ? "voice"
        : msg.video_note
          ? "video_note"
          : msg.video
            ? "video"
            : "photo";
      void logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "skipped_owner_self",
      }).catch(() => {});
    }
    return;
  }

  // Channel mirror for a DM source (e.g. the AximoBot forwarder):
  // re-send real content into the configured destination channel,
  // skipping the bot's own commands / menus / service chatter. Runs
  // here — past the owner-outgoing and bot-echo early-returns — so
  // only genuine INCOMING messages are considered. Fire-and-forget.
  // AWAITED (not void): on Vercel a detached promise can be frozen the
  // moment the webhook response returns, silently dropping the mirror
  // copy — the same failure class that hit album flushing. The work is
  // bounded (one buffer write or one resend) and the webhook has 55s.
  await maybeMirrorBusinessMessage({ msg, bot }).catch((err) =>
    console.warn("[mirror-dm] failed:", err),
  );

  let rule = await getChatRule(msg.chat.id).catch(() => null);
  const settings = await getSettings();
  // First time the bot sees this chat — stamp a chat_rules row with
  // the operator's configured defaults so future loads see the
  // intended starting state instead of the column-level defaults.
  if (!rule) {
    await ensureChatRuleWithDefaults({
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      chatTitle:
        "title" in msg.chat && typeof msg.chat.title === "string"
          ? msg.chat.title
          : null,
    }).catch((err) =>
      console.warn("[chat-defaults] ensure failed:", err),
    );
    rule = await getChatRule(msg.chat.id).catch(() => null);
  }

  // Fire media-router here, BEFORE every other early-return below
  // (grace window, secretary relay, urgent-skip, etc.) can intercept
  // the message. Otherwise photos/videos with a caption — which skip
  // the no-text-no-caption branch above — get trapped by the grace
  // check at line ~1944 and never reach the legacy router call near
  // the bottom of this function. Skipping is per-flag inside
  // maybeRouteMedia itself; this is just making sure we get a chance
  // to consider it for every incoming message.
  if (msg.voice || msg.video_note || msg.video || msg.photo || msg.location) {
    if (msg.voice || msg.video_note || msg.video || msg.photo) {
      const kind = msg.voice
        ? "voice"
        : msg.video_note
          ? "video_note"
          : msg.video
            ? "video"
            : "photo";
      void logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "passed_to_router",
      }).catch(() => {});
    }
    void maybeRouteMedia({ rule, msg, bot }).then((r) => {
      if (r.errors.length > 0) {
        console.warn("[media-router/main-early] errors:", r.errors);
      }
    });
  }

  // Best-effort auto-fill of per-chat first/last name from the sender's
  // Telegram profile, only when the owner hasn't set them yet.
  if (msg.chat.type === "private" && msg.from) {
    autoFillChatNames({
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      firstName: msg.from.first_name ?? null,
      lastName: msg.from.last_name ?? null,
      isBot: Boolean(msg.from.is_bot),
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
  //
  // Exception: ai_chat mode with the matching ai_process_* flag on. In
  // that case the AI reply path (sendAiConversation) is the one that
  // actually transcribes/describes the media, so we must NOT early-
  // return — otherwise the toggle would be silently ignored and the
  // user would see the bot stay quiet on every voice / sticker / GIF
  // / photo without caption (the exact bug we shipped before).
  const canAiProcessMedia =
    msg.chat.type === "private" &&
    (rule?.mode ?? "off") === "ai_chat" &&
    ((rule?.aiProcessVoice && (msg.voice || msg.audio)) ||
      (rule?.aiProcessVideoNotes && msg.video_note) ||
      (rule?.aiProcessStickers && msg.sticker) ||
      (rule?.aiProcessGifs && msg.animation) ||
      (rule?.aiProcessPhotos &&
        msg.photo &&
        msg.photo.length > 0));
  if (!msg.text && !msg.caption && !canAiProcessMedia) {
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
    // Voice / video_note / photo without a caption all land here.
    // Without this call they'd skip the media-router entirely (the
    // existing maybeRouteMedia below sits past this early-return),
    // which was the root cause of voices arriving in messages_log
    // but never showing up in voice_storage.
    // media-router already fired at the top of this function (early-
    // call) so we don't double-route here.
    return;
  }

  // VIP bypasses the active-conversation grace period. So does ai_listen:
  // listen-mode never replies, so there's nothing to silence — but we
  // DO want to keep classifying + logging messages so the dashboard's
  // thread view stays complete during an active conversation.
  if (!rule?.vip && (rule?.mode ?? "off") !== "ai_listen") {
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
      chatNotes: rule?.notes ?? null,
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

  // Multi-recipient Secretary Routes — independent of mode/alert
  // gates. The whole point of the Route system is that the operator
  // explicitly listed a chat as a source, so EVERY message from that
  // chat goes to every recipient. Fires for DMs only (relay between
  // groups would be confusing) but for any message, urgent or not.
  let relayDelivered = 0;
  // Skip owner-typed messages: they're the owner talking to either
  // the source or the recipient directly. Forwarding/relaying them
  // would either loop or duplicate work the owner is already doing.
  const isOwnerTyped =
    !!owner && !!msg.from?.id && msg.from.id === owner.userId;
  if (isDmPrivate && !isOwnerTyped) {
    // Recipient-reply: if the chat is a Route recipient (i.e. the
    // owner's chat with a designated secretary), relay the
    // recipient's message back to the original source via the
    // owner's business connection. Returns true when the message was
    // a reply we routed; in that case we DON'T also forward via
    // maybeForwardViaRelays since a recipient and a source for the
    // same chat would be a loop.
    const replied = await maybeRelayRecipientReplyBusiness({
      msg,
      bcId,
      bot,
    }).catch((err) => {
      console.error("[relay] recipient-reply failed:", err);
      return false;
    });
    if (!replied) {
      const relayed = await maybeForwardViaRelays({
        msg,
        bcId,
        senderName,
        bot,
      }).catch((err) => {
        console.error("[relay] forward failed:", err);
        return { delivered: 0, relays: 0 };
      });
      relayDelivered = relayed.delivered;
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
      const anyHandled = secretaryHandled || relayDelivered > 0;
      const suppressAuto =
        anyHandled &&
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
        chatNotes: rule?.notes ?? null,
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
        relationshipNotes: rule?.relationshipNotes ?? null,
        talkStyleNotes: rule?.talkStyleNotes ?? null,
        toneProfile: rule?.toneProfile ?? null,
        chatNotes: rule?.notes ?? null,
        floodCooldownUntil: rule?.floodCooldownUntil ?? null,
        aiProcessVoice: rule?.aiProcessVoice ?? false,
        aiProcessStickers: rule?.aiProcessStickers ?? false,
        aiProcessGifs: rule?.aiProcessGifs ?? false,
        aiProcessPhotos: rule?.aiProcessPhotos ?? false,
        aiProcessVideoNotes: rule?.aiProcessVideoNotes ?? false,
        aiGeneratePhoto: rule?.aiGeneratePhoto ?? false,
        bot,
      });
    }

    // Let the owner know when the AI STARTS auto-replying in a chat, so
    // it's never a surprise later. Only the AI-generating modes count
    // (not canned auto-replies), and it's throttled to once per chat per
    // hour so a running conversation doesn't spam.
    if (
      autoReplied &&
      (mode === "ai_chat" || mode === "friendly_reply") &&
      settings.ownerNotifyChatId
    ) {
      const notify = await shouldNotifyAiActivity({
        businessConnectionId: bcId,
        chatId: msg.chat.id,
        throttleMinutes: 60,
      }).catch(() => false);
      if (notify) {
        const modeLabel =
          mode === "ai_chat" ? "گفتگوی AI" : "پاسخ دوستانه‌ی AI";
        await bot.api
          .sendMessage(
            settings.ownerNotifyChatId,
            `🤖 AI فعال شد\n` +
              `تو چت «${chatTitle ?? senderName}» شروع به پاسخ‌دادن خودکار کرد (حالت: ${modeLabel}).\n` +
              `اگه نمی‌خوای، حالت این چت رو از داشبورد عوض کن.`,
          )
          .catch((err) => console.warn("[ai-notify] failed:", err));
      }
    }
  }

  if (hasDb()) {
    try {
      const logId = await logMessage({
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
        messageThreadId: msg.message_thread_id ?? null,
        inlineButtons: extractInlineUrlButtons(msg),
      });
      void maybeExtractOtp({ logId, text });
      // AWAITED, not void — same Vercel-kills-the-promise problem
      // as maybeApplyMessageRules. void'd here meant most Telegram
      // messages never finished their watchlist scan before the
      // request handler returned. Bounded by the LLM-call timeout
      // in classifier.ts so the handler still completes well under
      // maxDuration.
      await maybeApplyNoteWatch({
        logId,
        text,
        chatId: msg.chat.id,
        chatTitle,
        senderName,
        messageId: msg.message_id,
        businessConnectionId: bcId,
        bot,
      }).catch((err) =>
        console.warn("[watchlist] apply failed:", err),
      );
      void maybeDescribeMedia({
        mode,
        logId,
        mediaFileId,
        mediaKind,
        chatId: msg.chat.id,
        bcId,
      });
      void maybeAutoSummarizeOnArrival({
        rule,
        msg,
        bot,
      });
      // AWAITED, not void: on Vercel a void-dispatched promise can be
      // killed when the request handler returns and the function gets
      // reclaimed. We were losing ~5 of every 7 incoming matches that
      // way. The rule path is bounded by per-LLM-call timeouts so the
      // overall handler stays well under maxDuration.
      await maybeApplyMessageRules({
        logId,
        chatId: msg.chat.id,
        chatTitle,
        senderName,
        messageText: text,
        businessConnectionId: bcId,
        fromOwner: false,
        bot,
      }).catch((err) =>
        console.warn("[rules] apply failed:", err),
      );
      // If this message is itself from a rule-recipient and looks like a
      // trigger ("send me the code"), release any held matches for them
      // that fell inside the rule's window.
      await maybeReleaseGatedRules({
        senderChatId: msg.chat.id,
        messageText: text,
        bot,
      }).catch((err) =>
        console.warn("[rules] release failed:", err),
      );
      // SMS routing: when the message starts with "☎️ +PHONE …" we
      // treat it as an SMS forward (from the operator's SMS-to-
      // Telegram gateway) and route the body to every chat tagged
      // sms_inbox, prepended with the resolved owner name when we
      // can find one in past chats.
      try {
        const { routeSmsForward } = await import("./sms-router");
        await routeSmsForward({
          bot,
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          text,
        });
      } catch (err) {
        console.warn("[sms] route failed:", err);
      }
      // media-router was already fired at the top of this function
      // (early-call right after we resolved the rule), so we don't
      // double-route here.
    } catch (err) {
      console.error("[db] log failed:", err);
    }
  }
}

async function maybeApplyMessageRules(args: {
  logId: number;
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  messageText: string;
  businessConnectionId: string | null;
  fromOwner: boolean;
  bot: Bot;
}): Promise<void> {
  if (args.fromOwner) return;
  if (!args.messageText || !args.messageText.trim()) return;
  // Self-forward guard: when the recipient is itself a business-
  // connected account, our bot.api.sendMessage(...) reflects back
  // through *their* business connection as a fresh business_message.
  // Without this gate that message would re-match the rule and we'd
  // loop. Our forward prefix is "🏷 [rule:" — no real customer
  // message starts with that, so it's a safe sentinel.
  if (/^🏷 \[rule:/.test(args.messageText.trim())) {
    console.log(
      `[rules] skipping rule-prefixed forward echo chat=${args.chatId} log=${args.logId}`,
    );
    return;
  }
  try {
    const {
      listMessageRules,
      listRuleRecipients,
      recordRuleMatch,
    } = await import("./db");
    const { matchRules, formatMessageForRule } = await import("./rules");
    const allRules = await listMessageRules({ enabledOnly: true });
    // Source allowlist: a rule with source_chat_ids set can ONLY match
    // messages arriving from those chats. Deterministic scoping so a
    // broad description ("any message with a code") can't grab numbers
    // out of unrelated conversations.
    const rules = allRules.filter(
      (r) => !r.sourceChatIds || r.sourceChatIds.includes(args.chatId),
    );
    console.log(
      `[rules] eval chat=${args.chatId} log=${args.logId} enabledRules=${rules.length}/${allRules.length} text="${args.messageText.slice(0, 80).replace(/\n/g, " ")}"`,
    );
    if (rules.length === 0) return;
    // Source-feed rules (match_all_from_source + source scope) matched by
    // SOURCE alone — they already passed the source filter above, so no
    // LLM check. The rest go through the content classifier.
    const forced = rules.filter(
      (r) => r.matchAllFromSource && r.sourceChatIds && r.sourceChatIds.length > 0,
    );
    const llmRules = rules.filter((r) => !forced.includes(r));
    const matchedLlm = llmRules.length
      ? await matchRules(
          {
            chatId: args.chatId,
            chatTitle: args.chatTitle,
            senderName: args.senderName,
            messageText: args.messageText,
            businessConnectionId: args.businessConnectionId,
          },
          llmRules,
        )
      : [];
    const matched = Array.from(
      new Set([...forced.map((r) => r.id), ...matchedLlm]),
    );
    if (matched.length === 0) return;
    for (const ruleId of matched) {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) continue;
      // Paused recipients keep their config but receive no forwards.
      const recipients = (await listRuleRecipients(ruleId)).filter(
        (r) => !r.paused,
      );
      if (recipients.length === 0) {
        await recordRuleMatch({
          ruleId,
          messageLogId: args.logId,
          formattedText: null,
          forwardedTo: [],
        }).catch(() => {});
        continue;
      }
      // OTP mode short-circuits the LLM formatter — we just extract
      // the digits ourselves. Saves a model call AND avoids the model
      // helpfully "tidying up" the code.
      const formatted = rule.formatAsOtp
        ? null
        : await formatMessageForRule(rule, {
            chatId: args.chatId,
            chatTitle: args.chatTitle,
            senderName: args.senderName,
            messageText: args.messageText,
            businessConnectionId: args.businessConnectionId,
          });
      const body =
        formatted && formatted.trim().length > 0
          ? formatted
          : args.messageText;
      const { buildRuleForwardText } = await import("./rule-delivery");
      let otpCode: string | null = null;
      if (rule.formatAsOtp) {
        const { extractOtpCodeAi } = await import("./rules");
        otpCode = await extractOtpCodeAi(body).catch(() => null);
      }
      // OTP mode + no extractable code = the matched message wasn't
      // actually an OTP carrier (it was probably someone asking for
      // the code). Skip the forward rather than ship "🔑 کد بده" —
      // that just trains the recipient to ignore the channel.
      if (rule.formatAsOtp && !otpCode) {
        console.log(
          `[rule] skip forward — formatAsOtp=true but no code extracted ` +
            `from message; rule=${ruleId} chat=${args.chatId}`,
        );
        await recordRuleMatch({
          ruleId,
          messageLogId: args.logId,
          formattedText: null,
          forwardedTo: [],
        }).catch(() => {});
        continue;
      }
      const built = buildRuleForwardText({
        ruleName: rule.name,
        senderName: args.senderName,
        body,
        showRulePrefix: rule.showRulePrefix,
        formatAsOtp: rule.formatAsOtp,
        otpCode,
      });
      const outText = built.text;
      const outParseMode = built.parseMode;

      // Request-gate: hold the forward for each recipient until they've
      // sent a trigger-matching message within the window. The gate is
      // ACTIVE when the window is set AND there's either a trigger
      // description OR saved gate examples. (Previously only the
      // trigger text counted — an operator who generated gate examples
      // but never saved the description silently ran WITHOUT a gate and
      // codes forwarded to everyone immediately.)
      const { listRuleExamples: listExamplesForGate } = await import("./db");
      const windowed =
        rule.requestWindowSeconds != null && rule.requestWindowSeconds > 0;
      let gated = false;
      if (windowed) {
        if (rule.requestTrigger?.trim()) {
          gated = true;
        } else {
          // Examples-only gate. FAIL CLOSED: if we can't read the
          // examples (transient DB error), HOLD rather than broadcast
          // the code to everyone. A held code is recoverable (the
          // recipient can ask again); a leaked code is not.
          try {
            const ex = await listExamplesForGate(ruleId, "gate_match");
            gated = ex.length > 0;
          } catch (err) {
            console.warn(
              `[rules] gate-example read failed rule=${ruleId} — failing closed (holding):`,
              err,
            );
            gated = true;
          }
        }
      }

      const { sendRuleForward } = await import("./rule-delivery");
      const { consumeRecipientRequest } = await import("./db");
      const delivered: number[] = [];
      const failures: Array<{ chatId: number; reason: string }> = [];
      for (const r of recipients) {
        let shouldForward = !gated;
        if (gated) {
          // ATOMIC check-and-consume: forward NOW only if this recipient
          // has a still-valid request stamp, which is cleared in the
          // same statement. Two codes arriving concurrently for one ask
          // can no longer both pass this gate. If the send then fails
          // the match stays held and a re-ask re-releases it.
          shouldForward = await consumeRecipientRequest({
            ruleId,
            recipientChatId: r.recipientChatId,
            windowSeconds: rule.requestWindowSeconds ?? 0,
          }).catch(() => false);
        }
        if (!shouldForward) continue;
        const out = await sendRuleForward({
          bot: args.bot,
          chatId: r.recipientChatId,
          text: outText,
          parseMode: outParseMode,
        });
        if (out.ok) {
          delivered.push(r.recipientChatId);
          console.log(
            `[rules] forward sent rule=${ruleId} → chat=${r.recipientChatId} mode=${out.mode} msg_id=${out.sentMessageId} bcId=${out.businessConnectionId ?? "—"}${gated ? " (gate: recipient requested recently)" : ""}`,
          );
        } else {
          failures.push({
            chatId: r.recipientChatId,
            reason: out.error,
          });
          console.warn(
            `[rules] forward to ${r.recipientChatId} failed (both modes): ${out.error}`,
          );
        }
      }
      if (failures.length > 0) {
        console.warn(
          `[rules] partial forward rule=${ruleId} delivered=${delivered.length}/${recipients.length} failures=${JSON.stringify(failures)}`,
        );
      }
      if (gated && delivered.length < recipients.length) {
        console.log(
          `[rules] gate-held ${recipients.length - delivered.length}/${recipients.length} (rule=${ruleId} window=${rule.requestWindowSeconds}s)`,
        );
      }
      const errMap: Record<string, string> = {};
      for (const f of failures) errMap[String(f.chatId)] = f.reason;
      await recordRuleMatch({
        ruleId,
        messageLogId: args.logId,
        formattedText: formatted,
        forwardedTo: delivered,
        forwardErrors: errMap,
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[rules] application failed:", err);
  }
}

// Called for every logged incoming message. If the sender's chat is a
// recipient of any rule that has a request_trigger, check whether the
// text counts as a trigger — if it does, release the matching messages
// that were held within the window.
async function maybeReleaseGatedRules(args: {
  senderChatId: number;
  messageText: string;
  bot: Bot;
}): Promise<void> {
  if (!args.messageText || !args.messageText.trim()) return;
  // Same self-forward guard as maybeApplyMessageRules: our own
  // rule-tagged forward bouncing back must not look like a trigger.
  if (/^🏷 \[rule:/.test(args.messageText.trim())) return;
  try {
    const {
      listRulesForRecipient,
      findPendingMatchesForRecipient,
      markMatchForwardedTo,
      markRecipientRequestedNow,
      clearRecipientRequest,
      listRuleExamples,
    } = await import("./db");
    const { checkRequestTriggerMatch } = await import("./rules");
    const rules = await listRulesForRecipient(args.senderChatId);
    // Same gate-activation logic as the forward path: window set AND
    // (trigger description OR gate examples). Rules whose gate is
    // active only via examples must still be releasable here.
    const candidates = rules.filter(
      (r) =>
        r.enabled &&
        r.requestWindowSeconds != null &&
        r.requestWindowSeconds > 0,
    );
    if (candidates.length === 0) return;
    const { listRuleRecipients: listRecips } = await import("./db");
    for (const rule of candidates) {
      // A paused recipient must not have codes released to them either.
      const myRecip = (await listRecips(rule.id).catch(() => [])).find(
        (r) => r.recipientChatId === args.senderChatId,
      );
      if (myRecip?.paused) continue;
      // Gate-side example phrasings (the "🤖 ساخت پاراف‌راز با AI"
      // output) widen the gate's understanding beyond the one-line
      // description.
      const gateExamples = await listRuleExamples(rule.id, "gate_match")
        .then((rows) => rows.map((r) => r.text))
        .catch(() => []);
      const hasGate =
        !!rule.requestTrigger?.trim() || gateExamples.length > 0;
      if (!hasGate) continue;
      const isTrigger = await checkRequestTriggerMatch(
        args.messageText,
        rule.requestTrigger ?? "",
        gateExamples,
      );
      if (!isTrigger) continue;
      // Stamp the trigger so a match arriving RIGHT AFTER this ask
      // (bidirectional gate) forwards immediately. Consumed on
      // delivery — one ask, one code.
      await markRecipientRequestedNow({
        ruleId: rule.id,
        recipientChatId: args.senderChatId,
      }).catch(() => {});
      const pending = await findPendingMatchesForRecipient({
        ruleId: rule.id,
        recipientChatId: args.senderChatId,
        withinSeconds: rule.requestWindowSeconds ?? 0,
      });
      if (pending.length === 0) continue;
      const { sendRuleForward, buildRuleForwardText } = await import(
        "./rule-delivery"
      );
      const { extractOtpCodeAi } = await import("./rules");
      // Release ONLY the newest pending match — one ask, one code. The
      // old behavior dumped every held match in the window at once,
      // which could leak several unrelated codes on a single request.
      const newestFirst = [...pending].sort(
        (a, b) =>
          new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime(),
      );
      for (const p of newestFirst) {
        // Same rule-flag-aware build as the forward path. OTP mode
        // re-extracts the code from formatted_text (or messageText)
        // — we don't trust whatever was held to be already OTP-shaped.
        const body =
          p.formattedText && p.formattedText.trim().length > 0
            ? p.formattedText
            : p.messageText;
        const otpCode = rule.formatAsOtp
          ? await extractOtpCodeAi(body).catch(() => null)
          : null;
        // OTP mode without an extractable code: the held message
        // was a false positive (asker, not OTP carrier). Drop it
        // silently instead of releasing "🔑 <raw text>" and try the
        // next-newest held match instead.
        if (rule.formatAsOtp && !otpCode) {
          console.log(
            `[rule] gate-release skip — formatAsOtp=true but no code ` +
              `extractable; rule=${rule.id} match=${p.matchId}`,
          );
          continue;
        }
        const built = buildRuleForwardText({
          ruleName: rule.name,
          senderName: p.senderName,
          body,
          showRulePrefix: rule.showRulePrefix,
          formatAsOtp: rule.formatAsOtp,
          otpCode,
        });
        const outText = built.text;
        const out = await sendRuleForward({
          bot: args.bot,
          chatId: args.senderChatId,
          text: outText,
          parseMode: built.parseMode,
        });
        if (out.ok) {
          await markMatchForwardedTo({
            matchId: p.matchId,
            recipientChatId: args.senderChatId,
          });
          // Delivered — consume the request stamp and stop. One ask
          // releases exactly one code.
          await clearRecipientRequest({
            ruleId: rule.id,
            recipientChatId: args.senderChatId,
          }).catch(() => {});
          console.log(
            `[rules] released held match=${p.matchId} → ${args.senderChatId} mode=${out.mode} (rule=${rule.id})`,
          );
          break;
        } else {
          console.warn(
            `[rules] release-forward to ${args.senderChatId} failed: ${out.error}`,
          );
          break;
        }
      }
    }
  } catch (err) {
    console.warn("[rules] release-gated failed:", err);
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
function extractInlineUrlButtons(
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
function messageKind(msg: Message): string {
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
function mediaFileId(msg: Message): {
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

type MediaKind = NonNullable<ReturnType<typeof mediaFileId>>["kind"];

// Per-media-type send via business_connection_id. file is either the
// raw file_id (fast path) or an InputFile after download+reupload
// (fallback). Caption (where supported) carries the source caption.
async function sendMediaAsOwner(args: {
  bot: Bot;
  toChatId: number;
  // When set, the media is sent AS THE OWNER via the business
  // connection. When omitted, it's sent AS THE BOT (used by the
  // channel-mirror path, where the destination is a channel the bot
  // administers rather than one of the owner's private chats).
  businessConnectionId?: string;
  kind: MediaKind;
  file: string | InputFile;
  caption?: string;
  replyToMessageId?: number;
  messageThreadId?: number;
}): Promise<number> {
  const { bot, toChatId, businessConnectionId, kind, file } = args;
  const base: Record<string, unknown> = {};
  if (businessConnectionId) {
    base.business_connection_id = businessConnectionId;
  }
  if (args.messageThreadId !== undefined) {
    base.message_thread_id = args.messageThreadId;
  }
  if (args.replyToMessageId !== undefined) {
    base.reply_parameters = { message_id: args.replyToMessageId };
  }
  const withCaption = (capable: boolean) =>
    capable && args.caption ? { ...base, caption: args.caption } : base;
  switch (kind) {
    case "photo": {
      const m = await bot.api.sendPhoto(
        toChatId,
        file,
        withCaption(true),
      );
      return m.message_id;
    }
    case "video": {
      const m = await bot.api.sendVideo(toChatId, file, withCaption(true));
      return m.message_id;
    }
    case "voice": {
      const m = await bot.api.sendVoice(toChatId, file, withCaption(true));
      return m.message_id;
    }
    case "audio": {
      const m = await bot.api.sendAudio(toChatId, file, withCaption(true));
      return m.message_id;
    }
    case "document": {
      const m = await bot.api.sendDocument(toChatId, file, withCaption(true));
      return m.message_id;
    }
    case "animation": {
      const m = await bot.api.sendAnimation(
        toChatId,
        file,
        withCaption(true),
      );
      return m.message_id;
    }
    case "sticker": {
      // Stickers ignore captions. Pass only base options.
      const m = await bot.api.sendSticker(toChatId, file, base);
      return m.message_id;
    }
    case "video_note": {
      // Video notes also ignore captions.
      const m = await bot.api.sendVideoNote(toChatId, file, base);
      return m.message_id;
    }
  }
}

// Telegram error codes that mean "file_id won't work as-is" — these
// trigger the download + re-upload fallback. Everything else is
// propagated to the caller so genuine network / permission failures
// don't waste a download round-trip.
function isFileIdProblem(err: unknown): boolean {
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

// Relay one incoming business message to a recipient AS the owner.
//
//   * text → sendMessage(business_connection_id)
//   * any media → sendXxx(file_id, business_connection_id) — and if
//     Telegram rejects the file_id (which it does for some kinds
//     where the file scope doesn't transfer cleanly across business
//     chats) fall back to downloading the file via the bot's File API
//     and re-uploading as an InputFile.
//
// Service messages, polls, location / contact / dice / venue all fall
// through to copyMessage (no file to download, just metadata).
async function relayCopyViaBusiness(args: {
  bot: Bot;
  msg: Message;
  toChatId: number;
  businessConnectionId: string;
  replyToMessageId?: number;
}): Promise<number[]> {
  const { bot, msg, toChatId, businessConnectionId, replyToMessageId } = args;
  const baseOpts: Record<string, unknown> = {
    business_connection_id: businessConnectionId,
  };
  if (replyToMessageId !== undefined) {
    baseOpts.reply_parameters = { message_id: replyToMessageId };
  }

  // Plain text.
  if (msg.text && !mediaFileId(msg)) {
    const m = await bot.api.sendMessage(
      toChatId,
      msg.text.slice(0, 4096),
      baseOpts,
    );
    return [m.message_id];
  }

  // File-bearing media.
  const media = mediaFileId(msg);
  if (media) {
    const caption = msg.caption?.slice(0, 1024);
    try {
      const id = await sendMediaAsOwner({
        bot,
        toChatId,
        businessConnectionId,
        kind: media.kind,
        file: media.fileId,
        caption,
        replyToMessageId,
      });
      console.log(
        `[relay] ${media.kind} sent via file_id rcpt=${toChatId}`,
      );
      return [id];
    } catch (err) {
      if (!isFileIdProblem(err)) throw err;
      console.warn(
        `[relay] ${media.kind} file_id rejected — falling back to download+reupload`,
      );
      // Fallback: download via the bot's File API and re-upload.
      const { data, name } = await downloadTelegramFile(
        config.telegramBotToken,
        media.fileId,
      );
      const fallbackName = name || `${media.kind}.bin`;
      const inputFile = new InputFile(data, fallbackName);
      const id = await sendMediaAsOwner({
        bot,
        toChatId,
        businessConnectionId,
        kind: media.kind,
        file: inputFile,
        caption,
        replyToMessageId,
      });
      console.log(
        `[relay] ${media.kind} re-uploaded ok rcpt=${toChatId} bytes=${data.length}`,
      );
      return [id];
    }
  }

  // No file payload but not text either (location, contact, dice,
  // venue, poll, service messages...). copyMessage is the right
  // primitive: it carries the structured metadata as the owner.
  const copyOpts = baseOpts as unknown as Parameters<
    typeof bot.api.copyMessage
  >[3];
  const sent = await bot.api.copyMessage(
    toChatId,
    msg.chat.id,
    msg.message_id,
    copyOpts,
  );
  return [sent.message_id];
}

async function maybeForwardViaRelays(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  bot: Bot;
}): Promise<{ delivered: number; relays: number }> {
  const { msg, bcId, senderName, bot } = args;
  if (msg.chat.type !== "private") return { delivered: 0, relays: 0 };
  if (!hasDb()) return { delivered: 0, relays: 0 };
  const relays = await findEnabledRelaysForSource(msg.chat.id).catch(() => []);
  if (relays.length === 0) return { delivered: 0, relays: 0 };

  const kind = messageKind(msg);
  let delivered = 0;
  let anyRecipientGotIt = false;
  for (const relay of relays) {
    if (relay.recipients.length === 0) continue;
    // Per-relay header — the recipient sees who the source is.
    const headerText = `📨 [${relay.name}] از: ${senderName}`;
    for (const rcpt of relay.recipients) {
      // Skip self-routes — never forward to the source chat itself.
      if (rcpt.chatId === msg.chat.id) continue;
      try {
        // 1. Header (sent as the owner so the recipient sees their
        // own chat with the owner).
        const header = await bot.api.sendMessage(rcpt.chatId, headerText, {
          business_connection_id: bcId,
        });
        await recordSecretaryRelayLink({
          relayId: relay.id,
          businessConnectionId: bcId,
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          recipientChatId: rcpt.chatId,
          recipientMessageId: header.message_id,
          direction: "inbound",
        });
        // 2. Body via copyMessage — handles every media type cleanly.
        let bodyIds: number[] = [];
        try {
          bodyIds = await relayCopyViaBusiness({
            bot,
            msg,
            toChatId: rcpt.chatId,
            businessConnectionId: bcId,
            replyToMessageId: header.message_id,
          });
        } catch (err) {
          const e = err as { error_code?: number; description?: string };
          // copyMessage refuses service / forwarded / unknown
          // payloads with 400. Tell the recipient what kind of
          // message they're missing so the relay doesn't go silent.
          console.warn(
            `[relay] copy kind=${kind} chat=${msg.chat.id}→${rcpt.chatId} failed: ${e?.error_code} ${e?.description}`,
          );
          const fallback = await bot.api.sendMessage(
            rcpt.chatId,
            `[${kind} نتونست منتقل بشه: ${e?.description ?? "unknown"}]`,
            {
              business_connection_id: bcId,
              reply_parameters: { message_id: header.message_id },
            },
          );
          bodyIds = [fallback.message_id];
        }
        for (const id of bodyIds) {
          await recordSecretaryRelayLink({
            relayId: relay.id,
            businessConnectionId: bcId,
            sourceChatId: msg.chat.id,
            sourceMessageId: msg.message_id,
            recipientChatId: rcpt.chatId,
            recipientMessageId: id,
            direction: "inbound",
          });
        }
        delivered++;
        anyRecipientGotIt = true;
        console.log(
          `[relay] forwarded kind=${kind} source=${msg.chat.id} relay=${relay.id} → rcpt=${rcpt.chatId} parts=${bodyIds.length}`,
        );
      } catch (err) {
        const e = err as { error_code?: number; description?: string };
        if (e?.error_code === 403) {
          console.warn(
            `[relay] recipient ${rcpt.chatId} not reachable via business (no existing chat / blocked / privacy)`,
          );
        } else {
          console.error(
            `[relay] forward to ${rcpt.chatId} (relay=${relay.id}, kind=${kind}) failed: ${e?.error_code} ${e?.description}`,
          );
        }
      }
    }
  }
  // Read-receipt propagation. As soon as ANY recipient received the
  // forward, mark the source's message as read so the customer sees
  // a "seen" tick — that's the operator's promise: "someone's on it".
  // Without this the source would have to wait for an actual reply to
  // see the tick, even though their message is already in the
  // recipient's inbox.
  if (anyRecipientGotIt) {
    await markBusinessRead(bot, bcId, msg.chat.id, msg.message_id).catch(
      () => {},
    );
  }
  return { delivered, relays: relays.length };
}

// Reply path (business edition): the RECIPIENT typed in their normal
// chat with the owner. The bot receives that as a business_message
// where msg.chat.id = recipient's user id. We look it up against the
// most recent inbound relay link for that recipient and relay the
// body to the source chat via the SAME business connection so the
// source sees it arrive from the owner.
async function maybeRelayRecipientReplyBusiness(args: {
  msg: Message;
  bcId: string;
  bot: Bot;
}): Promise<boolean> {
  const { msg, bcId, bot } = args;
  if (msg.chat.type !== "private") return false;
  if (!hasDb()) return false;
  const replyTo = msg.reply_to_message;
  let link = replyTo
    ? await findSecretaryRelayLinkByRecipientMessage(
        msg.chat.id,
        replyTo.message_id,
      ).catch(() => null)
    : null;
  if (!link) {
    link = await findLatestInboundLinkForRecipient(msg.chat.id, 120).catch(
      () => null,
    );
  }
  if (!link) return false;
  // Only relay when this chat is genuinely a recipient — i.e. the
  // recipient chat id on the link matches this chat. Direction
  // 'inbound' means the link was created by us forwarding TO this
  // recipient earlier, so a follow-up message here is a reply.
  if (link.recipientChatId !== msg.chat.id) return false;
  // Use the bcId of the current message (the recipient's business
  // connection) rather than the stored one, since the owner could
  // have multiple business connections.
  const sendBcId = link.businessConnectionId ?? bcId;
  const kind = messageKind(msg);
  try {
    let sentIds: number[] = [];
    try {
      sentIds = await relayCopyViaBusiness({
        bot,
        msg,
        toChatId: link.sourceChatId,
        businessConnectionId: sendBcId,
      });
    } catch (err) {
      const e = err as { error_code?: number; description?: string };
      console.warn(
        `[relay] reply-copy kind=${kind} rcpt=${msg.chat.id}→source=${link.sourceChatId} failed: ${e?.error_code} ${e?.description}`,
      );
      // Fail loudly to the recipient so they know their reply didn't
      // reach the customer.
      await bot.api
        .sendMessage(
          msg.chat.id,
          `❌ ارسال ${kind} به فرستنده نشد: ${e?.description ?? "unknown"}`,
          {
            business_connection_id: sendBcId,
            reply_parameters: { message_id: msg.message_id },
          },
        )
        .catch(() => {});
      return false;
    }
    // Read-receipt: the recipient just answered, so mark the source's
    // last forwarded message as read. Telegram's read cursor moves
    // forward, so this implicitly marks every earlier customer
    // message as seen too. Per markBusinessRead, this only works
    // when the operator granted can_read_messages to the bot when
    // setting up the Business connection — failures get a clear
    // [read] warning in the log.
    if (link.sourceMessageId) {
      console.log(
        `[relay] marking source=${link.sourceChatId} msg=${link.sourceMessageId} as read on reply`,
      );
      await markBusinessRead(
        bot,
        sendBcId,
        link.sourceChatId,
        link.sourceMessageId,
      );
    }
    for (const id of sentIds) {
      await recordSecretaryRelayLink({
        relayId: link.relayId,
        businessConnectionId: sendBcId,
        sourceChatId: link.sourceChatId,
        sourceMessageId: id,
        recipientChatId: msg.chat.id,
        recipientMessageId: msg.message_id,
        direction: "outbound",
      });
    }
    console.log(
      `[relay] reply kind=${kind} rcpt=${msg.chat.id} → source=${link.sourceChatId} parts=${sentIds.length}`,
    );
    return true;
  } catch (err) {
    console.error("[relay] reply (business) failed:", err);
    return false;
  }
}

// Reply path: a recipient typed in their DM with the bot. If they
// replied to a forwarded message we routed (or recently received one
// without using reply-to), relay the body back to the original
// source's chat as if it came from the owner — via the same business
// connection so the source sees "me" on the other end.
async function handleSecretaryRelayReply(
  msg: Message,
  bot: Bot,
): Promise<boolean> {
  if (msg.chat.type !== "private") return false;
  if (!msg.from) return false;
  if (msg.text && msg.text.startsWith("/")) return false;
  if (!hasDb()) return false;

  const replyTo = msg.reply_to_message;
  let link = replyTo
    ? await findSecretaryRelayLinkByRecipientMessage(
        msg.chat.id,
        replyTo.message_id,
      ).catch(() => null)
    : null;
  if (!link) {
    // Recipient didn't tap reply — assume the most recent inbound link
    // for this chat. 120-min window mirrors the legacy secretary
    // session idle window.
    link = await findLatestInboundLinkForRecipient(msg.chat.id, 120).catch(
      () => null,
    );
  }
  if (!link) return false;
  if (!link.businessConnectionId) return false;

  try {
    const sentIds = await relayAnyMessage({
      bot,
      source: msg,
      toChatId: link.sourceChatId,
      businessConnectionId: link.businessConnectionId,
    });
    // Mark the original sender message as read so the source sees a
    // "seen" tick.
    if (link.sourceMessageId) {
      await markBusinessRead(
        bot,
        link.businessConnectionId,
        link.sourceChatId,
        link.sourceMessageId,
      ).catch(() => {});
    }
    // Track outbound copy so future replies-to-our-reply still relay.
    for (const id of sentIds) {
      await recordSecretaryRelayLink({
        relayId: link.relayId,
        businessConnectionId: link.businessConnectionId,
        sourceChatId: link.sourceChatId,
        sourceMessageId: id,
        recipientChatId: msg.chat.id,
        recipientMessageId: msg.message_id,
        direction: "outbound",
      });
    }
    try {
      await bot.api.setMessageReaction(msg.chat.id, msg.message_id, [
        { type: "emoji", emoji: "👍" },
      ]);
    } catch {
      // Older clients reject; ignore.
    }
    console.log(
      `[relay] reply rcpt=${msg.chat.id} → source=${link.sourceChatId} parts=${sentIds.length}`,
    );
    return true;
  } catch (err) {
    console.error("[relay] reply failed:", err);
    await bot.api
      .sendMessage(
        msg.chat.id,
        `❌ Failed to relay: ${String(err).slice(0, 200)}`,
        { reply_parameters: { message_id: msg.message_id } },
      )
      .catch(() => {});
    return false;
  }
}

// Groups/supergroups: bot.on("message") path (non-business). Logs every
// non-empty message, classifies it via the same SYSTEM_PROMPT used for
// DMs, and fires the alert webhook + ownerNotifyChatId DM when the
// classifier says it's urgent and concerns the owner. Mute and VIP
// chat-rules still apply. The bot never replies in groups — that's
// intentional, groups stay log-only.
// Channels and supergroup-channels deliver posts via channel_post,
// not message. They have no `from` (the post is from the channel
// itself) and the bot must be a member/admin to see them at all.
// Same flow as handleGroupMessage minus the per-sender bits, so news
// channels show up in /messages and the dashboard. We deliberately
// don't filter on chat.type — Telegram delivers anonymous-admin
// posts in supergroups via channel_post too and we want those too.
async function handleChannelPost(msg: Message, bot: Bot): Promise<void> {
  await handleAnyChatPost(msg, bot);
}

async function handleGroupMessage(msg: Message, bot: Bot): Promise<void> {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") return;
  if (msg.from?.is_bot) return;
  // Forum topic harvest. Telegram delivers forum_topic_created on the
  // very first message of a new topic and forum_topic_edited when the
  // operator renames one. Both arrive as regular messages with the
  // special field set, so we capture them here regardless of who the
  // sender is.
  type ForumLike = {
    forum_topic_created?: {
      name?: string;
      icon_color?: number;
      icon_custom_emoji_id?: string;
    };
    forum_topic_edited?: { name?: string; icon_custom_emoji_id?: string };
    forum_topic_closed?: Record<string, unknown>;
    forum_topic_reopened?: Record<string, unknown>;
    general_forum_topic_hidden?: Record<string, unknown>;
    general_forum_topic_unhidden?: Record<string, unknown>;
  };
  const forum = msg as unknown as ForumLike;
  const threadId = msg.message_thread_id ?? null;
  if (threadId) {
    if (forum.forum_topic_created) {
      await upsertForumTopic({
        chatId: msg.chat.id,
        messageThreadId: threadId,
        name: forum.forum_topic_created.name ?? null,
        iconColor: forum.forum_topic_created.icon_color ?? null,
        iconEmoji: forum.forum_topic_created.icon_custom_emoji_id ?? null,
      }).catch((err) =>
        console.warn("[forum] topic_created upsert failed:", err),
      );
    } else if (forum.forum_topic_edited) {
      await upsertForumTopic({
        chatId: msg.chat.id,
        messageThreadId: threadId,
        name: forum.forum_topic_edited.name ?? null,
        iconEmoji: forum.forum_topic_edited.icon_custom_emoji_id ?? null,
      }).catch((err) =>
        console.warn("[forum] topic_edited upsert failed:", err),
      );
    } else if (forum.forum_topic_closed) {
      await upsertForumTopic({
        chatId: msg.chat.id,
        messageThreadId: threadId,
        isClosed: true,
      }).catch(() => {});
    } else if (forum.forum_topic_reopened) {
      await upsertForumTopic({
        chatId: msg.chat.id,
        messageThreadId: threadId,
        isClosed: false,
      }).catch(() => {});
    } else {
      // Plain message inside a known topic — ensure we at least have
      // a row so the analyzer can render "Topic #N" while we wait for
      // the topic_created event.
      await upsertForumTopic({
        chatId: msg.chat.id,
        messageThreadId: threadId,
      }).catch(() => {});
    }
  }
  await handleAnyChatPost(msg, bot);
}

// Copy every incoming post from a mirrored source chat into its
// destination(s). copyMessage handles all media/text types cleanly and
// posts as a fresh message (no "forwarded from" header). Loop-guarded:
// a chat that is any rule's destination is never used as a source.
async function maybeMirrorPost(args: { msg: Message; bot: Bot }): Promise<void> {
  const { msg, bot } = args;
  let rules: MirrorRule[];
  try {
    const settings = await getSettings();
    rules = parseChannelMirrors(settings.channelMirrors ?? "");
  } catch (err) {
    console.warn("[mirror] settings read failed:", err);
    return;
  }
  if (rules.length === 0) return;
  const destinations = new Set(rules.map((r) => r.to));
  if (destinations.has(msg.chat.id)) return; // loop guard
  const targets = rules.filter((r) => r.from === msg.chat.id && r.to !== msg.chat.id);
  if (targets.length === 0) return;
  if (typeof (bot.api as { copyMessage?: unknown }).copyMessage !== "function") {
    return;
  }
  for (const r of targets) {
    try {
      await bot.api.copyMessage(
        r.to,
        msg.chat.id,
        msg.message_id,
        r.threadId ? { message_thread_id: r.threadId } : {},
      );
      console.log(
        `[mirror] ${msg.chat.id} → ${r.to}${r.threadId ? `#${r.threadId}` : ""} msg=${msg.message_id}`,
      );
    } catch (err) {
      console.warn(`[mirror] copy ${msg.chat.id}→${r.to} failed:`, err);
    }
  }
}

// AximoBot-style forwarder chatter we DON'T want mirrored: menus,
// status pings, subscription/upsell, feed-management confirmations.
// Real forwarded posts are either media or text with a source header
// and don't match any of these.
const FORWARDER_JUNK_RX: RegExp[] = [
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

// Decide whether an incoming forwarder-bot message is REAL content
// worth mirroring (vs. a command echo or the bot's own UI/service
// message). Owner-typed commands never reach here — they early-return
// on the owner-outgoing branch — but we still guard against a leading
// "/" and against data-export documents just in case.
function isForwarderContent(msg: Message): boolean {
  const body = msg.text ?? msg.caption ?? "";
  if (body.trimStart().startsWith("/")) return false; // command
  const media = mediaFileId(msg);
  if (media) {
    if (media.kind === "document") {
      const name = msg.document?.file_name ?? "";
      if (/\.(csv|json|txt|xlsx?|log)$/i.test(name)) return false; // export
    }
    return true; // photo / video / album part / etc.
  }
  if (!body.trim()) return false;
  return !FORWARDER_JUNK_RX.some((rx) => rx.test(body));
}

// Re-send a message to `toChatId` AS THE BOT (no business connection):
// media by file_id (with download+reupload fallback), text as text.
// Used for mirroring a business-DM source (e.g. AximoBot) into a
// channel the bot administers, where copyMessage isn't available
// because the bot only sees the source via the business connection.
async function mirrorViaResend(args: {
  bot: Bot;
  msg: Message;
  toChatId: number;
  threadId?: number;
}): Promise<void> {
  const { bot, msg, toChatId, threadId } = args;
  const media = mediaFileId(msg);
  if (media) {
    const caption = msg.caption?.slice(0, 1024);
    try {
      await sendMediaAsOwner({
        bot,
        toChatId,
        kind: media.kind,
        file: media.fileId,
        caption,
        messageThreadId: threadId,
      });
    } catch (err) {
      if (!isFileIdProblem(err)) throw err;
      const { data, name } = await downloadTelegramFile(
        config.telegramBotToken,
        media.fileId,
      );
      await sendMediaAsOwner({
        bot,
        toChatId,
        kind: media.kind,
        file: new InputFile(data, name || `${media.kind}.bin`),
        caption,
        messageThreadId: threadId,
      });
    }
    return;
  }
  const textBody = msg.text;
  if (textBody && textBody.trim()) {
    const opts: Record<string, unknown> = {};
    if (threadId) opts.message_thread_id = threadId;
    await bot.api.sendMessage(toChatId, textBody.slice(0, 4096), opts);
  }
}

// An album group is considered COMPLETE once no new part has been
// buffered for this many seconds. Flushing is driven by (a) the next
// incoming message's opportunistic sweep and (b) a 1-minute cron —
// NOT by an in-request timer, which Vercel freezes after the webhook
// response returns (that made album flushing unreliable).
const ALBUM_QUIET_SECONDS = 8;

// Flush every album group that is complete (quiet ≥ ALBUM_QUIET_SECONDS)
// and not yet claimed. Safe to call from anywhere — a webhook sweep or
// the cron. The atomic claim guarantees each group sends exactly once.
export async function flushReadyMirrorAlbums(bot: Bot): Promise<number> {
  let flushed = 0;
  let groups: string[];
  try {
    groups = await getReadyMirrorAlbumGroups(ALBUM_QUIET_SECONDS);
  } catch (err) {
    console.warn("[mirror-dm] ready-groups query failed:", err);
    return 0;
  }
  for (const groupKey of groups) {
    let claimed = false;
    try {
      if (!(await claimMirrorAlbumFlush(groupKey))) continue;
      claimed = true;
      const parts = await getMirrorAlbumParts(groupKey);
      if (parts.length === 0) {
        await deleteMirrorAlbumClaim(groupKey).catch(() => {});
        continue;
      }
      await sendAlbumParts({
        bot,
        toChatId: parts[0]!.targetChatId,
        threadId: parts[0]!.threadId ?? undefined,
        parts,
      });
      await deleteMirrorAlbumBuffer(groupKey);
      flushed++;
      console.log(
        `[mirror-dm] album flushed group=${groupKey} (${parts.length} parts)`,
      );
    } catch (err) {
      console.warn(`[mirror-dm] album flush failed group=${groupKey}:`, err);
      // Release the claim so the next cron tick retries this group —
      // otherwise it would be stuck behind the claim forever.
      if (claimed) await deleteMirrorAlbumClaim(groupKey).catch(() => {});
    }
  }
  return flushed;
}

// Send buffered album parts to one chat as native grouped albums
// (chunked to Telegram's 10-item limit). The caption goes on the very
// first item of the first chunk. Falls back to individual re-sends if
// sendMediaGroup rejects the batch.
async function sendAlbumParts(args: {
  bot: Bot;
  toChatId: number;
  threadId?: number;
  parts: MirrorAlbumPart[];
}): Promise<void> {
  const { bot, toChatId, threadId, parts } = args;
  const caption = parts.find((p) => p.caption && p.caption.trim())?.caption;
  for (let i = 0; i < parts.length; i += 10) {
    const chunk = parts.slice(i, i + 10);
    const media = chunk.map((p, idx) => {
      const item: Record<string, unknown> = {
        type: p.kind === "video" ? "video" : "photo",
        media: p.fileId,
      };
      if (i === 0 && idx === 0 && caption) item.caption = caption.slice(0, 1024);
      return item;
    });
    const opts: Record<string, unknown> = {};
    if (threadId) opts.message_thread_id = threadId;
    try {
      await bot.api.sendMediaGroup(
        toChatId,
        media as unknown as Parameters<typeof bot.api.sendMediaGroup>[1],
        opts,
      );
    } catch (err) {
      console.warn(
        `[mirror-dm] sendMediaGroup failed (${chunk.length} items) → individual fallback:`,
        err,
      );
      for (const p of chunk) {
        try {
          await sendMediaAsOwner({
            bot,
            toChatId,
            kind: p.kind as MediaKind,
            file: p.fileId,
            caption: p === chunk[0] && caption ? caption.slice(0, 1024) : undefined,
            messageThreadId: threadId,
          });
        } catch (e) {
          console.warn("[mirror-dm] album fallback part failed:", e);
        }
      }
    }
  }
}

// Mirror an incoming business-DM message (from a forwarder bot) into
// its configured destination(s), skipping commands and bot chatter.
// Album (media_group) posts are buffered and re-sent as a single
// grouped album instead of separate photos.
async function maybeMirrorBusinessMessage(args: {
  msg: Message;
  bot: Bot;
}): Promise<void> {
  const { msg, bot } = args;
  let rules: MirrorRule[];
  try {
    const settings = await getSettings();
    rules = parseChannelMirrors(settings.channelMirrors ?? "");
  } catch (err) {
    console.warn("[mirror-dm] settings read failed:", err);
    return;
  }
  if (rules.length === 0) return;
  const destinations = new Set(rules.map((r) => r.to));
  if (destinations.has(msg.chat.id)) return; // loop guard
  const targets = rules.filter(
    (r) => r.from === msg.chat.id && r.to !== msg.chat.id,
  );
  if (targets.length === 0) return;
  if (!isForwarderContent(msg)) {
    console.log(
      `[mirror-dm] skipped command/chatter chat=${msg.chat.id} msg=${msg.message_id}`,
    );
    return;
  }

  // Album path: buffer this part, wait for the rest, then the first
  // claimer flushes the whole group as one grouped album.
  const mediaGroupId = (msg as unknown as { media_group_id?: string })
    .media_group_id;
  const media = mediaFileId(msg);
  if (
    mediaGroupId &&
    media &&
    (media.kind === "photo" || media.kind === "video")
  ) {
    const caption = msg.caption?.slice(0, 1024) ?? null;
    for (const r of targets) {
      const groupKey = `${mediaGroupId}:${r.to}`;
      try {
        await bufferMirrorAlbumPart({
          groupKey,
          targetChatId: r.to,
          threadId: r.threadId ?? null,
          sourceMessageId: msg.message_id,
          fileId: media.fileId,
          kind: media.kind,
          caption,
        });
      } catch (err) {
        console.warn(`[mirror-dm] buffer failed group=${groupKey}:`, err);
      }
    }
    // Opportunistic sweep: flush any PRIOR album that has gone quiet.
    // This is immediate (no timer, so it survives the serverless
    // response), and since a forwarder sends albums back-to-back the
    // next message usually flushes the previous one within seconds.
    // The trailing album (no following message) is caught by the cron.
    await flushReadyMirrorAlbums(bot);
    return;
  }

  // Single (non-album) message.
  for (const r of targets) {
    try {
      await mirrorViaResend({ bot, msg, toChatId: r.to, threadId: r.threadId });
      console.log(
        `[mirror-dm] ${msg.chat.id} → ${r.to}${r.threadId ? `#${r.threadId}` : ""} msg=${msg.message_id}`,
      );
    } catch (err) {
      console.warn(`[mirror-dm] resend ${msg.chat.id}→${r.to} failed:`, err);
    }
  }
}

async function handleAnyChatPost(msg: Message, bot: Bot): Promise<void> {
  if (await isChatIgnored(msg.chat.id).catch(() => false)) {
    console.log(`[ignore] dropping channel/group post in chat=${msg.chat.id} (ignored=true)`);
    return;
  }
  harvestContactShare(msg);
  // Diagnostic mirror of handleBusinessMessage's "received" entry.
  // Used to tell apart "bot never saw the message" from "bot saw it
  // but bailed early".
  if (msg.voice || msg.video_note || msg.video || msg.photo) {
    const kind = msg.voice
      ? "voice"
      : msg.video_note
        ? "video_note"
        : msg.video
          ? "video"
          : "photo";
    void logMediaRouting({
      sourceChatId: msg.chat.id,
      sourceMessageId: msg.message_id,
      kind,
      decision: "received_group",
    }).catch(() => {});
  }

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

  // Channel mirror: copy every post from a mirrored source chat into
  // its destination(s). AWAITED — a detached promise can be frozen when
  // the webhook response returns on Vercel, silently dropping the copy.
  // Runs even for muted chats: mirroring is about the feed, not
  // notifications.
  await maybeMirrorPost({ msg, bot }).catch((err) =>
    console.warn("[mirror] failed:", err),
  );

  const text = describeMessage(msg);
  const chatTitle =
    "title" in msg.chat && typeof msg.chat.title === "string" ? msg.chat.title : null;
  // Channel posts have no `from` — the post belongs to the channel
  // itself. Fall back to the channel title so the row is recognisable.
  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
    msg.from?.username ||
    msg.sender_chat?.title ||
    chatTitle ||
    "unknown sender";
  const senderUsername =
    msg.from?.username ?? msg.sender_chat?.username ?? null;

  const media = extractMedia(msg);
  const mediaFileId = media?.fileId ?? null;
  const mediaKind = media?.kind ?? null;

  let rule = await getChatRule(msg.chat.id).catch(() => null);
  if (!rule) {
    await ensureChatRuleWithDefaults({
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      chatTitle: chatTitle,
    }).catch((err) =>
      console.warn("[chat-defaults] ensure failed:", err),
    );
    rule = await getChatRule(msg.chat.id).catch(() => null);
  }
  const settings = await getSettings();
  const mode: ChatMode = rule?.mode ?? "off";

  if (rule?.muted) {
    if (hasDb()) {
      await logMessage({
        businessConnectionId: null,
        ownerUserId: null,
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
      }).catch((err) => console.error("[db] group mute-log failed:", err));
    }
    return;
  }

  let verdict;
  try {
    verdict = await classify({
      chatType: msg.chat.type,
      chatTitle: chatTitle ?? undefined,
      senderName,
      text,
      chatNotes: rule?.notes ?? null,
    });
  } catch (err) {
    console.error("[classify] group failed:", err);
    verdict = {
      importance: 0,
      urgent: false,
      concernsOwner: false,
      reason: "classifier failed",
    };
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
  const chatLabel = chatTitle ?? `group ${msg.chat.id}`;

  console.log(
    `[classify] imp=${verdict.importance} urg=${verdict.urgent} owner=${verdict.concernsOwner} chat=${msg.chat.type}:${msg.chat.id} from=${senderName} alert=${shouldAlert} | ${verdict.reason}`,
  );

  // Auto-extract for meaningful group messages too.
  const extractMin = Number(settings.autoExtractMinImportance) || 4;
  if (
    (msg.text || msg.caption) &&
    !msg.from?.is_bot &&
    verdict.importance >= extractMin
  ) {
    void autoExtractAndSave({
      text,
      chatId: msg.chat.id,
      chatTitle,
      senderName,
      messageId: msg.message_id,
      businessConnectionId: null,
    });
  }

  let alerted = false;
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
      console.error("[alert] group failed:", err);
    }
    const notifyChat = settings.ownerNotifyChatId;
    if (notifyChat) {
      try {
        await bot.api.sendMessage(
          notifyChat,
          `🚨 Urgent (group)\n` +
            `From: ${senderName}\n` +
            `In: ${chatLabel}\n` +
            `Importance: ${verdict.importance}/10\n` +
            `Reason: ${verdict.reason}\n\n` +
            text.slice(0, 500),
        );
      } catch (err) {
        console.error("[notify] group failed:", err);
      }
    }
  }

  if (hasDb()) {
    try {
      const logId = await logMessage({
        businessConnectionId: null,
        ownerUserId: null,
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
        autoReplied: false,
        mediaFileId,
        mediaKind,
        messageThreadId: msg.message_thread_id ?? null,
        inlineButtons: extractInlineUrlButtons(msg),
      });
      void maybeExtractOtp({ logId, text });
      // AWAITED — see the matching comment in handleBusinessMessage.
      await maybeApplyNoteWatch({
        logId,
        text,
        chatId: msg.chat.id,
        chatTitle,
        senderName,
        messageId: msg.message_id,
        businessConnectionId: null,
        bot,
      }).catch((err) =>
        console.warn("[watchlist] apply failed:", err),
      );
      void maybeDescribeMedia({
        mode,
        logId,
        mediaFileId,
        mediaKind,
        chatId: msg.chat.id,
        bcId: null,
      });
      void maybeAutoSummarizeOnArrival({
        rule,
        msg,
        bot,
      });
      // SMS routing for channel/group messages too — the operator's
      // SMS-to-Telegram gateway usually delivers into a Channel like
      // "Mahdi SMS1", not the personal business chat.
      try {
        const { routeSmsForward } = await import("./sms-router");
        await routeSmsForward({
          bot,
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          text,
        });
      } catch (err) {
        console.warn("[sms] route failed (channel/group):", err);
      }
      // Same media-router fan-out the business-message path has, so
      // voice/video/photo arriving in a group OR channel gets routed
      // to the configured *_storage chats. We skip routing when the
      // sender is one of our registered Business owners — the owner
      // doesn't want to see their OWN voices/photos echoed back into
      // their storage channels.
      const senderIsOwner =
        msg.from?.id != null && (await isAllowedUser(msg.from.id).catch(() => false));
      if (senderIsOwner) {
        if (msg.voice || msg.video_note || msg.video || msg.photo) {
          const kind = msg.voice
            ? "voice"
            : msg.video_note
              ? "video_note"
              : msg.video
                ? "video"
                : "photo";
          void logMediaRouting({
            sourceChatId: msg.chat.id,
            sourceMessageId: msg.message_id,
            kind,
            decision: "skipped_owner_self",
          }).catch(() => {});
        }
      } else {
        void maybeRouteMedia({ rule, msg, bot }).then((r) => {
          if (r.errors.length > 0) {
            console.warn("[media-router/group] errors:", r.errors);
          }
        });
      }
    } catch (err) {
      console.error("[db] group-log failed:", err);
    }
  }
}

// Edited DM messages from either side arrive here. We snapshot the
// previous text into message_edits and overwrite the live row, but we
// don't re-classify or re-reply — the original handleBusinessMessage
// already did that and re-running it would either dedupe (logMessage
// returns the existing id) or worse, generate a second AI reply for
// the same conversation turn.
async function handleBusinessEdit(msg: Message, bot: Bot): Promise<void> {
  const bcId = msg.business_connection_id;
  if (!bcId) return;
  // Ignore the bot's own outgoing echo edits — we don't track those.
  if (
    (msg as unknown as { sender_business_bot?: unknown }).sender_business_bot
  ) {
    return;
  }
  const newText = describeMessage(msg);
  if (!newText) return;
  try {
    const changed = await recordMessageEdit({
      businessConnectionId: bcId,
      chatId: msg.chat.id,
      messageId: msg.message_id,
      newText,
    });
    if (changed) {
      console.log(
        `[edit] chat=${msg.chat.id} msg=${msg.message_id} text updated, prev snapshot saved`,
      );
    }
  } catch (err) {
    console.error("[edit] recordMessageEdit failed:", err);
  }
  // Silence the no-unused-param lint while keeping the bot arg available
  // for future use (e.g. re-classifying or notifying the secretary).
  void bot;
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

  // First: regardless of secretary config, if the owner reacted to a
  // customer message in their own business chat, log it so the
  // follow-up cron treats reactions as "you replied".
  const bcIdRaw =
    (upd as unknown as { business_connection_id?: string })
      .business_connection_id ?? null;
  if (bcIdRaw && upd.chat.type === "private") {
    const owner = await resolveOwner(bcIdRaw, bot).catch(() => null);
    if (!owner) {
      console.log(`[reaction] owner-log skip chat=${upd.chat.id}: resolveOwner returned null for bcId=${bcIdRaw}`);
    } else if (upd.user.id !== owner.userId) {
      console.log(
        `[reaction] owner-log skip chat=${upd.chat.id}: reactor=${upd.user.id} != owner=${owner.userId}`,
      );
    } else {
      // Accept any reaction type — plain emoji, custom_emoji (Telegram
      // Premium), or paid. The earlier filter restricted to plain
      // emoji which dropped premium users' custom-emoji reactions.
      const newReactions = upd.new_reaction ?? [];
      const emojis = newReactions
        .map((r) => {
          if (r.type === "emoji") {
            return (r as { type: "emoji"; emoji: string }).emoji;
          }
          if (r.type === "custom_emoji") {
            return "🌟"; // placeholder — we can't render custom emojis
          }
          if (r.type === "paid") return "⭐";
          return "";
        })
        .filter(Boolean)
        .join(" ");
      // Only count ADDING a reaction. If new_reaction is empty (the
      // owner removed all reactions), don't treat that as a reply.
      if (newReactions.length === 0) {
        console.log(
          `[reaction] owner-log skip chat=${upd.chat.id}: new_reaction empty (reaction removal, not a reply)`,
        );
      } else {
        try {
          await recordOwnerReaction({
            chatId: upd.chat.id,
            businessConnectionId: bcIdRaw,
            messageId: upd.message_id,
            emojis: emojis || "(reaction)",
            tenantId: null,
          });
          console.log(
            `[reaction] owner-log OK chat=${upd.chat.id} emojis="${emojis}" types=${newReactions.map((r) => r.type).join(",")} bcId=${bcIdRaw}`,
          );
        } catch (err) {
          console.warn(`[reaction] owner-log DB write failed chat=${upd.chat.id}:`, err);
        }
      }
    }
  } else if (!bcIdRaw) {
    console.log(`[reaction] owner-log skip chat=${upd.chat.id}: no business_connection_id (not a business chat)`);
  }

  const settings = await getSettings();
  if ((settings.secretaryEnabled ?? "false").toLowerCase() !== "true") return;
  const secList = getSecretaries(settings);
  if (secList.length === 0) return;
  const secIds = new Set(secList.map((s) => s.userId));

  // Direction A: reaction inside a business chat (the sender reacted to a
  // message). Relay it to the corresponding message in the secretary's chat
  // so the secretary can see what got reacted to.
  const bcId = bcIdRaw;
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
  chatNotes: string | null;
  bot: Bot;
}): Promise<boolean> {
  const { msg, bcId, senderName, settings, customReply, nickname, relationship, chatNotes, bot } = args;
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
        chatNotes,
        chatId: msg.chat.id,
        businessConnectionId: bcId,
      })) || awayMessage;
  } catch (err) {
    console.error("[friendly] AI failed; falling back to literal:", err);
  }

  await humanTypingDelay(bot, {
    chatId: msg.chat.id,
    bcId,
    replyText: text,
  });

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

// One-shot "I'm busy" reply we send when the other person is flooding
// the chat. Tries to match the language the owner has been using in
// this chat so it doesn't read like a system message. We do NOT use AI
// here on purpose — flood-deflection is exactly the moment we want
// short, predictable, and free.
async function pickFloodDeflection(args: {
  senderName: string;
  toneProfile: string | null;
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  relationship: import("./db").Relationship | null;
  nickname: string | null;
  settings: Awaited<ReturnType<typeof getSettings>>;
  chatId: number;
}): Promise<string | null> {
  let ownerWritesPersian = true; // default for this codebase's user
  try {
    const history = await recentConversation(args.chatId, 30);
    const ownerTexts = history
      .filter((m) => m.from === "owner")
      .slice(-10)
      .map((m) => m.text)
      .join(" ");
    if (ownerTexts) {
      const hasPersian = /[؀-ۿ]/.test(ownerTexts);
      const hasLatin = /[A-Za-z]/.test(ownerTexts);
      if (hasLatin && !hasPersian) ownerWritesPersian = false;
    }
  } catch {}
  const formal =
    args.relationship === "formal" ||
    args.relationship === "employer" ||
    args.relationship === "work_acquaintance";
  if (!ownerWritesPersian) {
    return formal
      ? "Sorry, in the middle of something — I'll get back to you in a bit."
      : "Sorry, busy right now, ttyl 🙏";
  }
  if (formal) {
    return "ببخشید الان درگیر یه کاری هستم، یکم بعد برمی‌گردم 🙏";
  }
  if (args.nickname) {
    return `${args.nickname} جان الان درگیرم، یکم دیگه میام جوابتو میدم 🙏`;
  }
  return "الان درگیرم، یکم بعد میام جواب میدم 🙏";
}

async function sendAiConversation(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  nickname: string | null;
  relationship: import("./db").Relationship | null;
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  toneProfile: string | null;
  chatNotes: string | null;
  floodCooldownUntil: Date | null;
  aiProcessVoice: boolean;
  aiProcessStickers: boolean;
  aiProcessGifs: boolean;
  aiProcessPhotos: boolean;
  aiProcessVideoNotes: boolean;
  aiGeneratePhoto: boolean;
  bot: Bot;
}): Promise<boolean> {
  const {
    msg,
    bcId,
    senderName,
    settings,
    nickname,
    relationship,
    relationshipNotes,
    talkStyleNotes,
    toneProfile,
    chatNotes,
    floodCooldownUntil,
    aiProcessVoice,
    aiProcessStickers,
    aiProcessGifs,
    aiProcessPhotos,
    aiProcessVideoNotes,
    aiGeneratePhoto,
    bot,
  } = args;
  if (msg.chat.type !== "private") return false;

  // Fire the read receipt eagerly — STT + AI generation can take 5–10s
  // and Telegram's "voice unlistened" dot stays visible the whole time.
  // We're committed to attempting a reply here (we're in ai_chat mode
  // for a DM), so mark the incoming message read now. The post-send
  // markBusinessRead below becomes a backup; readBusinessMessage is
  // idempotent.
  void markBusinessRead(bot, bcId, msg.chat.id, msg.message_id).catch(
    () => {},
  );

  // Default: only text/caption messages get an AI reply. With per-chat
  // ai_process_voice / _stickers / _gifs flags, we ALSO process the
  // corresponding media kind: transcribe voice via STT, describe
  // sticker/GIF via multimodal. The transcript / description becomes
  // the effective "user text" the AI replies to, and we persist it on
  // the messages_log row downstream (recentConversation already reads
  // transcript / media_description, so subsequent turns see the real
  // content instead of `[voice]`).
  let userText: string | undefined = msg.text ?? msg.caption ?? undefined;
  let processedMediaTranscript: string | null = null;
  let processedMediaDescription: string | null = null;
  let processedMediaKind: string | null = null;

  const voiceId = msg.voice?.file_id ?? msg.audio?.file_id ?? null;
  const videoNoteId = msg.video_note?.file_id ?? null;
  const stickerId = msg.sticker?.file_id ?? null;
  const animationId = msg.animation?.file_id ?? null;
  const photoId =
    msg.photo && msg.photo.length > 0
      ? msg.photo[msg.photo.length - 1]?.file_id ?? null
      : null;

  // Audio kinds (voice / audio / video_note): only process when there's
  // no caption — the transcript IS the message text, so a typed caption
  // already covers it. voice + audio share aiProcessVoice; video_note
  // has its own (📹) since the circular clip is a separate UX.
  if (!userText && voiceId && aiProcessVoice && sttConfigured()) {
    try {
      const tr = await transcribeAudio({
        botToken: config.telegramBotToken,
        fileId: voiceId,
        language: settings.sttLanguage || "fa",
        chatId: msg.chat.id,
        businessConnectionId: bcId,
      });
      if (tr.text) {
        userText = tr.text;
        processedMediaTranscript = tr.text;
        processedMediaKind = msg.voice ? "voice" : "audio";
      }
    } catch (err) {
      console.warn("[ai_chat] voice STT failed:", err);
    }
  }
  if (
    !userText &&
    videoNoteId &&
    aiProcessVideoNotes &&
    sttConfigured()
  ) {
    try {
      const tr = await transcribeAudio({
        botToken: config.telegramBotToken,
        fileId: videoNoteId,
        language: settings.sttLanguage || "fa",
        chatId: msg.chat.id,
        businessConnectionId: bcId,
      });
      if (tr.text) {
        userText = `[video note] ${tr.text}`;
        processedMediaTranscript = tr.text;
        processedMediaKind = "video_note";
      }
    } catch (err) {
      console.warn("[ai_chat] video_note STT failed:", err);
    }
  }

  // Visual kinds (photo / sticker / GIF): describe ALWAYS when the
  // toggle is on, even if a caption is present. The AI needs to see
  // what's in the image to answer questions like «این چیه؟» or «این
  // جا کجاست؟». Description is appended to any existing caption so
  // both reach the model.
  const appendVisual = (label: string, body: string): void => {
    userText = userText
      ? `${userText}\n\n[${label}: ${body}]`
      : `[${label}] ${body}`;
  };
  if (photoId && aiProcessPhotos) {
    const desc = await describeMedia({
      fileId: photoId,
      kind: "photo",
      chatId: msg.chat.id,
      businessConnectionId: bcId,
    }).catch(() => null);
    const text = desc
      ? [desc.description, desc.textInImage].filter(Boolean).join("\n")
      : "";
    if (text) {
      appendVisual("photo", text);
      processedMediaDescription = text;
      processedMediaKind = "photo";
    }
  }
  if (stickerId && aiProcessStickers) {
    const desc = await describeMedia({
      fileId: stickerId,
      kind: "sticker",
      chatId: msg.chat.id,
      businessConnectionId: bcId,
    }).catch(() => null);
    const text = desc
      ? [desc.description, desc.textInImage].filter(Boolean).join("\n")
      : "";
    if (text) {
      appendVisual("sticker", text);
      processedMediaDescription = text;
      processedMediaKind = "sticker";
    }
  }
  if (animationId && aiProcessGifs) {
    const desc = await describeMedia({
      fileId: animationId,
      kind: "animation",
      chatId: msg.chat.id,
      businessConnectionId: bcId,
    }).catch(() => null);
    const text = desc
      ? [desc.description, desc.textInImage].filter(Boolean).join("\n")
      : "";
    if (text) {
      appendVisual("GIF", text);
      processedMediaDescription = text;
      processedMediaKind = "animation";
    }
  }

  if (!userText) return false;

  // Photo generation — if the operator enabled "🖼 تولید عکس من" for
  // this chat AND set their reference photo URL in settings AND the
  // user's message looks like a photo request ("عکست", "یه سلفی",
  // "send me a photo of you"), generate one with Gemini's image model
  // using the reference as the visual anchor and send it INSTEAD of a
  // text reply. Falls through to the normal text path on any failure
  // (model down, no reference URL, etc.) so the user still gets an
  // answer.
  if (aiGeneratePhoto) {
    const intent = looksLikePhotoRequest(userText);
    console.log(
      `[ai_chat] photo-gen check chat=${msg.chat.id} intent=${intent} userText="${userText.slice(0, 80)}"`,
    );
    if (intent) {
      try {
        // Reference resolution (uploaded blob → ownerPhotoUrl) lives
        // inside generatePersonalPhoto; we pass the URL field as a
        // fallback only.
        const img = await generatePersonalPhoto({
          referenceUrl: (settings.ownerPhotoUrl ?? "").trim(),
          userRequest: userText,
          chatId: msg.chat.id,
          businessConnectionId: bcId,
        });
        const sent = await bot.api.sendPhoto(
          msg.chat.id,
          new InputFile(img.data, "selfie.jpg"),
          {
            business_connection_id: bcId,
            reply_parameters: { message_id: msg.message_id },
          },
        );
        await logOwnerSent({
          bcId,
          chatId: msg.chat.id,
          chatType: msg.chat.type,
          chatTitle: chatTitleOf(msg),
          ownerUserId: null,
          sentMessageId: sent.message_id,
          text: "[generated photo]",
          source: "ai_chat",
          ownerLabel: settings.ownerName ?? "owner",
          mediaKind: "photo",
        });
        console.log(
          `[ai_chat] photo-gen success chat=${msg.chat.id} bytes=${img.data.length}`,
        );
        return true;
      } catch (err) {
        console.warn(
          "[ai_chat] photo generation failed, falling back to text:",
          err,
        );
      }
    }
  }

  // Persist the transcript/description on the original message row so
  // future calls to recentConversation (and the dashboard) see the
  // real content instead of `[voice]`. Best-effort — we already have
  // userText cached locally, so this never blocks the AI reply.
  if (processedMediaTranscript || processedMediaDescription) {
    void (async () => {
      try {
        // Look up the messages_log row created (or about to be created)
        // for this telegram message. handleBusinessMessage logs AFTER
        // sendAiConversation, so there might not be a row yet — retry
        // briefly.
        for (let i = 0; i < 4; i++) {
          const rows = await sql()`
            SELECT id FROM messages_log
            WHERE business_connection_id = ${bcId}
              AND chat_id = ${msg.chat.id}
              AND message_id = ${msg.message_id}
            LIMIT 1`;
          const r = rows[0] as { id: string } | undefined;
          if (r) {
            if (processedMediaTranscript) {
              await saveTranscript(Number(r.id), processedMediaTranscript);
            } else if (processedMediaDescription) {
              await saveMediaDescription(
                Number(r.id),
                processedMediaDescription,
              );
            }
            return;
          }
          await sleep(800);
        }
      } catch (err) {
        console.warn("[ai_chat] persist transcript/description failed:", err);
      }
    })();
  }
  void processedMediaKind;

  // Flood waitlist: if we already sent the "I'm busy" deflection in this
  // chat and the cooldown hasn't passed, stay silent. The dashboard
  // still shows the messages (they're logged downstream).
  if (floodCooldownUntil && floodCooldownUntil.getTime() > Date.now()) {
    console.log(
      `[ai_chat] in flood cooldown for chat=${msg.chat.id} until ${floodCooldownUntil.toISOString()}`,
    );
    return false;
  }

  // Rate check: how many user-typed messages have we received in the
  // last 60 seconds? If well above what a normal conversation produces
  // and there's already a recent bot reply, treat it as flooding and
  // send ONE deflection that locks us out for ~5 min.
  const incomingLast60s = await recentIncomingCount(msg.chat.id, 60).catch(
    () => 0,
  );
  const FLOOD_THRESHOLD = 5;
  if (incomingLast60s >= FLOOD_THRESHOLD) {
    const deflection = await pickFloodDeflection({
      senderName,
      toneProfile,
      relationshipNotes,
      talkStyleNotes,
      relationship,
      nickname,
      settings,
      chatId: msg.chat.id,
    });
    if (deflection) {
      await humanTypingDelay(bot, {
        chatId: msg.chat.id,
        bcId,
        replyText: deflection,
      });
      try {
        const sent = await bot.api.sendMessage(msg.chat.id, deflection, {
          business_connection_id: bcId,
          reply_parameters: { message_id: msg.message_id },
        });
        await setFloodCooldown(
          msg.chat.id,
          new Date(Date.now() + 5 * 60 * 1000),
        );
        await markBusinessRead(bot, bcId, msg.chat.id, msg.message_id);
        await logOwnerSent({
          bcId,
          chatId: msg.chat.id,
          chatType: msg.chat.type,
          chatTitle: chatTitleOf(msg),
          ownerUserId: null,
          sentMessageId: sent.message_id,
          text: deflection,
          source: "ai_chat",
          ownerLabel:
            settings.ownerDisplayName || settings.ownerName || "owner",
        });
        return true;
      } catch (err) {
        console.error("[ai_chat] flood-deflection send failed:", err);
      }
    }
    return false;
  }

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
      relationshipNotes,
      talkStyleNotes,
      toneProfile,
      chatNotes,
      chatId: msg.chat.id,
      businessConnectionId: bcId,
    });
  } catch (err) {
    console.error("[ai_chat] generation failed:", err);
    return false;
  }
  if (!reply) return false;

  await humanTypingDelay(bot, {
    chatId: msg.chat.id,
    bcId,
    replyText: reply,
  });

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
