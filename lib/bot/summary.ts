// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { aiConversationReply, summarizeGroup } from "../classifier";
import { getSettings } from "../settings";
import { hasDb, getPrimarySummaryInbox, listChatThreaded, markAutoSummaryDelivered, setThreadSummaryInbox, sql, upsertThreadSummary, type ChatRule } from "../db";
import { reportError, reportWarn } from "../report";

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
    reportError("bot", "[auto_summary] reactive trigger failed:", err);
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
    reportWarn("bot", 
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
    reportError("bot", "[auto_summary] summarise failed:", err);
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
    reportError("bot", "[auto_summary] upsertThreadSummary failed:", err),
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
    reportWarn("bot", "[auto_summary] suggested reply failed:", err);
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
      reportError("bot", "[auto_summary] setThreadSummaryInbox failed:", err),
    );
    return true;
  } catch (err) {
    reportError("bot", 
      `[auto_summary] send to inbox=${inbox.chatId} failed:`,
      err,
    );
    return false;
  }
}
