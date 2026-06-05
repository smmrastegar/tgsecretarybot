import { Bot, type Context, GrammyError, HttpError, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { config } from "./config";
import {
  aiConversationReply,
  classify,
  describeMedia,
  extractActions,
  friendlyAutoReply,
  summarizeGroup,
} from "./classifier";
import { sttConfigured, transcribeAudio } from "./stt";
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
} from "./db";
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
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "message_reaction",
  "channel_post",
  "edited_channel_post",
  "callback_query",
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
    console.error("[extract] auto failed:", err);
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
        bot,
      });
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
      });
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
      // media-router was already fired at the top of this function
      // (early-call right after we resolved the rule), so we don't
      // double-route here.
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
  await handleAnyChatPost(msg, bot);
}

async function handleAnyChatPost(msg: Message, bot: Bot): Promise<void> {
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
      });
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

  if (!userText) {
    // voice + audio share the aiProcessVoice toggle; video_note has
    // its own (📹) since the visual circle is a separate experience.
    const voiceId = msg.voice?.file_id ?? msg.audio?.file_id ?? null;
    const videoNoteId = msg.video_note?.file_id ?? null;
    const stickerId = msg.sticker?.file_id ?? null;
    const animationId = msg.animation?.file_id ?? null;
    const photoId =
      msg.photo && msg.photo.length > 0
        ? msg.photo[msg.photo.length - 1]?.file_id ?? null
        : null;
    if (voiceId && aiProcessVoice && sttConfigured()) {
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
    } else if (videoNoteId && aiProcessVideoNotes && sttConfigured()) {
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
    } else if (stickerId && aiProcessStickers) {
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
        userText = `[sticker] ${text}`;
        processedMediaDescription = text;
        processedMediaKind = "sticker";
      }
    } else if (animationId && aiProcessGifs) {
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
        userText = `[GIF] ${text}`;
        processedMediaDescription = text;
        processedMediaKind = "animation";
      }
    } else if (photoId && aiProcessPhotos) {
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
        userText = `[photo] ${text}`;
        processedMediaDescription = text;
        processedMediaKind = "photo";
      }
    }
  }

  if (!userText) return false;

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
