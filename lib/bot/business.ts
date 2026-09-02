// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Message } from "grammy/types";
import { config } from "../config";
import { aiConversationReply, classify, describeMedia, extractActions, friendlyAutoReply, scanForWatchlistConcepts } from "../classifier";
import { sttConfigured, transcribeAudio } from "../stt";
import { generatePersonalPhoto, looksLikePhotoRequest } from "../image-gen";
import { maybeRouteMedia } from "../media-router";
import { ensureChatRuleWithDefaults } from "../chat-defaults";
import { defaultSecretary } from "../secretaries";
import { redisEnabled, redisGet, redisSet } from "../redis";
import { fireAlert } from "../alert";
import { getSettings } from "../settings";
import { autoFillChatNames, endSecretarySession, findActiveSecretarySessionForSender, getChatRule, hasDb, lastOwnerMessageAt, logMessage, recentIncomingCount, recordMessageEdit, saveMediaDescription, saveTranscript, setFloodCooldown, sql, type ChatRule, recentConversation, saveExtractedItems, logMediaRouting, type ChatMode, isChatIgnored, listNoteWatchItemsWithAliases, hasRecentNoteWatchMatch, recordNoteWatchMatch, addChatNote, listChatsByFunction, shouldNotifyAiActivity } from "../db";
import { isTransientDbError } from "../pg-driver";
import { reportError, reportWarn } from "../report";
import { CHAT_MODE_FA, autoReplyCache, chatTitleOf, chunkText, describeMessage, extractInlineUrlButtons, extractMedia, faNum, harvestContactShare, humanTypingDelay, logOwnerSent, markBusinessRead, mediaFileId, resolveOwner, safeDate, sleep } from "./core";
import { maybeMirrorBusinessMessage } from "./mirror";
import { maybeForwardToSecretary, maybeForwardViaRelays, maybeRelayDownloadLink, maybeRelayRecipientReplyBusiness, maybeReturnDownloadedMedia } from "./relay";
import { maybeApplyMessageRules, maybeReleaseGatedRules } from "./rules-apply";
import { maybeAutoSummarizeOnArrival } from "./summary";

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

export async function autoExtractAndSave(args: {
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
      reportWarn("bot", "[extract] auto skipped (transient DB)");
    } else {
      reportError("bot", "[extract] auto failed:", err);
    }
  }
}

// Run multimodal analysis only on chats the owner has put in ai_listen
// mode — for other modes the dashboard either gets a reply (so the
// visual doesn't matter much) or has a separate per-feature transcribe
// path (secretary forwarding already STTs voice messages). Images go
// through Gemini multimodal; voice/audio/video_note go through STT.
export async function maybeDescribeMedia(args: {
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
      reportWarn("bot", "[ai_listen] transcribe failed:", err);
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
      reportWarn("bot", "[ai_listen] describe failed:", err);
    }
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

export async function maybeExtractOtp(args: {
  logId: number;
  text: string;
}): Promise<void> {
  if (!looksLikePossibleOtp(args.text)) return;
  try {
    const { extractOtpCodeAi } = await import("../rules");
    const { saveOtpCode } = await import("../db");
    const code = await extractOtpCodeAi(args.text);
    if (code) {
      await saveOtpCode(args.logId, code);
      console.log(`[otp] saved code=${code} for log=${args.logId}`);
    }
  } catch (err) {
    reportWarn("bot", `[otp] extract failed for log=${args.logId}:`, err);
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
    reportWarn("bot", "[watchlist] scan failed:", err);
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
      reportWarn("bot", `[watchlist] record failed item=${item.id}:`, err);
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
        reportWarn("bot", 
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
      reportWarn("bot", `[watchlist] addChatNote failed item=${item.id}:`, err),
    );
    console.log(
      `[watchlist] match item=${item.id} chat=${args.chatId} concept="${item.concept}"`,
    );
  }
}

// The owner's OWN voice note, transcribed straight back under itself.
// Deliberately narrow, because that's exactly what was asked for:
//   * only msg.voice — not video notes, not audio files
//   * only the owner's own voices — the other party's already go
//     through the classifier / Transcribe-button path
//   * the reply is the bare transcript: no header, no rule label,
//     no emoji. Anything prepended shows up in the other person's
//     chat too, so "no preamble" is a real requirement, not polish.
// Gated per-chat by chat_rules.self_voice_transcript.
async function maybeTranscribeOwnVoice(args: {
  msg: Message;
  bot: Bot;
  bcId: string;
  rule: ChatRule | null;
  logId: number | null;
}): Promise<void> {
  const { msg, bot, bcId, rule } = args;
  if (!msg.voice) return;
  if (!rule?.selfVoiceTranscript) return;
  if (!sttConfigured()) return;
  const settings = await getSettings();
  const { text } = await transcribeAudio({
    botToken: config.telegramBotToken,
    fileId: msg.voice.file_id,
    language: settings.sttLanguage || "fa",
    chatId: msg.chat.id,
    businessConnectionId: bcId,
  });
  const transcript = (text ?? "").trim();
  if (!transcript) return;
  if (args.logId != null) {
    await saveTranscript(args.logId, transcript).catch(() => {});
  }
  // Sent WITH business_connection_id so it lands as the owner's own
  // message, and reply_parameters so it sits under the voice it
  // belongs to. Chunked because Telegram caps a text message at 4096.
  for (const chunk of chunkText(transcript, 4000)) {
    await bot.api.sendMessage(msg.chat.id, chunk, {
      business_connection_id: bcId,
      reply_parameters: { message_id: msg.message_id },
    });
  }
}

export async function handleBusinessMessage(msg: Message, bot: Bot): Promise<void> {
  // Hard ignore: operator marked this chat as "do not process". Bail
  // before any classifier / log / route / rule work. Cached briefly
  // in lib/db so a burst of messages from the same chat doesn't
  // round-trip per message.
  if (await isChatIgnored(msg.chat.id).catch(() => false)) {
    console.log(`[ignore] dropping business_message in chat=${msg.chat.id} (ignored=true)`);
    return;
  }
  harvestContactShare(msg);
  // Media-link relay. Runs before the rest of the pipeline (and before
  // the active-grace gate) because it is a service to the sender, not a
  // reply the bot decides to make. PRIVATE CHATS ONLY — a group is
  // never allowed to drive the owner's account into messaging bots.
  if (msg.chat.type === "private") {
    await maybeRelayDownloadLink(msg, bot).catch((err) =>
      reportWarn("link-relay", "relay failed:", err),
    );
    if (await maybeReturnDownloadedMedia(msg, bot).catch((err) => {
      reportWarn("link-relay", "return failed:", err);
      return false;
    })) {
      return; // downloader's reply — already handed back, don't log/classify
    }
  }
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
        reportError("bot", "[db] bot-outgoing-log failed:", err);
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
        reportError("bot", "[secretary] takeover notice failed:", err);
      }
    }
    let ownerLogId: number | null = null;
    if (hasDb()) {
      try {
        ownerLogId = await logMessage({
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
        reportError("bot", "[db] owner-log failed:", err);
      }
    }
    // AWAITED, not detached: on a frozen serverless invocation a void
    // promise here would drop the transcript silently. Bounded by the
    // STT timeouts in lib/stt.ts, well inside the webhook budget.
    if (msg.voice) {
      const ownRule = await getChatRule(msg.chat.id).catch(() => null);
      await maybeTranscribeOwnVoice({
        msg,
        bot,
        bcId,
        rule: ownRule,
        logId: ownerLogId,
      }).catch((err) => reportWarn("self-voice", "transcribe failed:", err));
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
    reportWarn("bot", "[mirror-dm] failed:", err),
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
      reportWarn("bot", "[chat-defaults] ensure failed:", err),
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
        reportWarn("bot", "[media-router/main-early] errors:", r.errors);
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
    }).catch((err) => reportError("bot", "[db] autoFillChatNames failed:", err));
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
        reportError("bot", "[db] mute-log failed:", err);
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
          reportError("bot", "[secretary] mode-switch notice failed:", err);
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
          reportError("bot", "[db] relay-log failed:", err);
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
        reportError("bot", "[db] media-log failed:", err);
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
              const graceLogId = await logMessage({
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
              // The grace window exists to stop the bot REPLYING while the
              // owner is mid-conversation. Rule forwarding is routing, not
              // a reply — suppressing it silently drops messages the
              // operator explicitly asked to be delivered elsewhere.
              if (text && text.trim()) {
                await maybeApplyMessageRules({
                  logId: graceLogId,
                  chatId: msg.chat.id,
                  chatTitle,
                  messageThreadId: msg.message_thread_id ?? null,
                  senderName,
                  messageText: text,
                  businessConnectionId: bcId,
                  fromOwner: false,
                  bot,
                }).catch((err) =>
                  reportWarn("bot", "[rules] apply failed (grace path):", err),
                );
              }
            } catch (err) {
              reportError("bot", "[db] grace-log failed:", err);
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
    reportError("bot", "[classify] failed:", err);
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
  const chatLabel =
    chatTitle ??
    (msg.chat.type === "private"
      ? `پیام خصوصی از ${senderName}`
      : `گروه ${msg.chat.id}`);

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
      reportError("bot", "[alert] failed:", err);
    }
    const notifyChat = settings.ownerNotifyChatId;
    if (notifyChat) {
      try {
        await bot.api.sendMessage(
          notifyChat,
          `🚨 فوری (حالت: ${CHAT_MODE_FA[mode] ?? mode})\n` +
            `از: ${senderName}\n` +
            `در: ${chatLabel}\n` +
            `اهمیت: ${faNum(verdict.importance)}/${faNum(10)}\n` +
            `دلیل: ${verdict.reason}\n\n` +
            text.slice(0, 500),
        );
      } catch (err) {
        reportError("bot", "[notify] failed:", err);
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
      reportError("bot", "[relay] recipient-reply failed:", err);
      return false;
    });
    if (!replied) {
      const relayed = await maybeForwardViaRelays({
        msg,
        bcId,
        senderName,
        bot,
      }).catch((err) => {
        reportError("bot", "[relay] forward failed:", err);
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
          .catch((err) => reportWarn("bot", "[ai-notify] failed:", err));
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
        reportWarn("bot", "[watchlist] apply failed:", err),
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
        messageThreadId: msg.message_thread_id ?? null,
        senderName,
        messageText: text,
        businessConnectionId: bcId,
        fromOwner: false,
        bot,
      }).catch((err) =>
        reportWarn("bot", "[rules] apply failed:", err),
      );
      // If this message is itself from a rule-recipient and looks like a
      // trigger ("send me the code"), release any held matches for them
      // that fell inside the rule's window.
      await maybeReleaseGatedRules({
        senderChatId: msg.chat.id,
        messageText: text,
        bot,
      }).catch((err) =>
        reportWarn("bot", "[rules] release failed:", err),
      );
      // SMS routing: when the message starts with "☎️ +PHONE …" we
      // treat it as an SMS forward (from the operator's SMS-to-
      // Telegram gateway) and route the body to every chat tagged
      // sms_inbox, prepended with the resolved owner name when we
      // can find one in past chats.
      try {
        const { routeSmsForward } = await import("../sms-router");
        await routeSmsForward({
          bot,
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          text,
        });
      } catch (err) {
        reportWarn("bot", "[sms] route failed:", err);
      }
      // media-router was already fired at the top of this function
      // (early-call right after we resolved the rule), so we don't
      // double-route here.
    } catch (err) {
      reportError("bot", "[db] log failed:", err);
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
    reportError("bot", "[autoreply] failed:", err);
    return false;
  }
}

// Edited DM messages from either side arrive here. We snapshot the
// previous text into message_edits and overwrite the live row, but we
// don't re-classify or re-reply — the original handleBusinessMessage
// already did that and re-running it would either dedupe (logMessage
// returns the existing id) or worse, generate a second AI reply for
// the same conversation turn.
export async function handleBusinessEdit(msg: Message, bot: Bot): Promise<void> {
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
    reportError("bot", "[edit] recordMessageEdit failed:", err);
  }
  // Silence the no-unused-param lint while keeping the bot arg available
  // for future use (e.g. re-classifying or notifying the secretary).
  void bot;
}

async function sendFriendlyReply(args: {
  msg: Message;
  bcId: string;
  senderName: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  customReply: string | null;
  nickname: string | null;
  relationship: import("../db").Relationship | null;
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
    reportError("bot", "[friendly] history fetch failed:", err);
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
    reportError("bot", "[friendly] AI failed; falling back to literal:", err);
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
    reportError("bot", "[friendly] send failed:", err);
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
  relationship: import("../db").Relationship | null;
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
  relationship: import("../db").Relationship | null;
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
      reportWarn("bot", "[ai_chat] voice STT failed:", err);
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
      reportWarn("bot", "[ai_chat] video_note STT failed:", err);
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
        reportWarn("bot", 
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
        reportWarn("bot", "[ai_chat] persist transcript/description failed:", err);
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
        reportError("bot", "[ai_chat] flood-deflection send failed:", err);
      }
    }
    return false;
  }

  let history: Awaited<ReturnType<typeof recentConversation>> = [];
  try {
    history = await recentConversation(msg.chat.id, 40);
  } catch (err) {
    reportError("bot", "[ai_chat] history fetch failed:", err);
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
    reportError("bot", "[ai_chat] generation failed:", err);
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
    reportError("bot", "[ai_chat] send failed:", err);
    return false;
  }
}
