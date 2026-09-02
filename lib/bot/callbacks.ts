// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot, type Context, InlineKeyboard } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { Message } from "grammy/types";
import { config } from "../config";
import { aiConversationReply, summarizeGroup } from "../classifier";
import { sttConfigured, transcribeAudio } from "../stt";
import { getRoutedMessage, markTranscribed } from "../media-router";
import { getSettings } from "../settings";
import { getChatRule, isAllowedUser, setBoardMemberStatus, getBoardMember, findThreadByInboxMessage, listChatThreaded, sql, upsertThreadSummary, ackChatFollowUp, addSmsAcceptSignature, createSmsBlockRule, deleteSmsDedup, expediteMonitoredAccountFetch, getMessageFullText, getNoteWatchMatch, getPrivateMessage, getSmsDedup, revealPrivateMessage, markNoteWatchMatchConfirmed, markNoteWatchMatchWrong, getEmail, setEmailSummary, createEmailPendingReply } from "../db";
import { buildEmailCard, resolveEmailAccount } from "../email";
import { summarizeEmail } from "../classifier";
import { reportError, reportWarn } from "../report";
import { _bot, chunkText, escapeForHtml } from "./core";

export function buildMainMenu(isOwner: boolean): InlineKeyboard {
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

export function menuGreeting(isOwner: boolean, name: string | null): string {
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
export async function handleFollowUpCallback(
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
    reportWarn("bot", "[fu_cb] ack failed:", err);
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
export async function handleNoteWatchCallback(
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
        reportWarn("bot", 
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
      reportWarn("bot", "[nw_cb] full-text fresh send failed:", err);
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
      reportWarn("bot", "[nw_cb] mark-wrong failed:", err);
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
      reportWarn("bot", "[nw_cb] mark-confirmed failed:", err);
      await ctx
        .answerCallbackQuery({ text: "ثبت نشد." })
        .catch(() => {});
    }
    return;
  }
  // Unknown action (or "noop" for the post-report badge) — silent ack.
  await ctx.answerCallbackQuery().catch(() => {});
}

export async function handleInstaCallback(
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
    reportWarn("bot", "[insta_cb] expedite failed:", err);
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
export async function handleSmsCallback(
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
      reportWarn("bot", "[sms_cb] delete failed:", err);
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
      reportWarn("bot", "[sms_cb] accept failed:", err);
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
      reportWarn("bot", "[sms_cb] block failed:", err);
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
export async function handleBoardAccessCallback(
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

export async function handleEmailCallback(
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
    reportWarn("bot", "[sms_cb] reveal/hide failed:", err);
    await ctx.answerCallbackQuery({ text: "خطا." }).catch(() => {});
  }
}

// 📝 Transcribe button on voice / video-note copies forwarded into
// the voice_storage channel. callback_data is the constant "tx:lookup"
// — the button is always attached to the storage message itself, so
// we recover the chat + message ids from ctx.callbackQuery.message and
// look up the source file_id in media_router_messages.
export async function handleTranscribeCallback(
  ctx: Context,
  _data: string,
  bot: Bot,
): Promise<void> {
  const cbMsg = ctx.callbackQuery?.message;
  if (!cbMsg) {
    await ctx.answerCallbackQuery({ text: "پیام مرجع پیدا نشد", show_alert: true });
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
  const senderName: string | null = row?.sourceSenderName ?? null;
  const alreadyTranscribed: string | null = row?.transcript ?? null;
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
      text: "اطلاعات این فایل پیدا نشد",
      show_alert: true,
    });
    return;
  }
  if (alreadyTranscribed) {
    await ctx.answerCallbackQuery({ text: "قبلاً پیاده‌سازی شده." });
    return;
  }
  await ctx.answerCallbackQuery({ text: "در حال پیاده‌سازی متن…" });
  try {
    // Without an explicit language hint Whisper auto-detects, and short
    // or noisy Persian clips (especially video notes) routinely come back
    // as English/Arabic. Always pass the configured language.
    const sttSettings = await getSettings();
    const { text } = await transcribeAudio({
      botToken: config.telegramBotToken,
      fileId,
      language: sttSettings.sttLanguage || "fa",
      chatId: storageChatId,
    });
    const transcript = (text ?? "").trim();
    if (!transcript) {
      await bot.api.sendMessage(
        storageChatId,
        "📝 متنی از این فایل استخراج نشد.",
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
    reportError("bot", "[transcribe] failed:", msg);
    await bot.api.sendMessage(
      storageChatId,
      `📝 پیاده‌سازی متن ناموفق بود: ${msg.slice(0, 200)}`,
      { reply_to_message_id: storageMessageId },
    ).catch(() => {});
  }
}

export async function handleAutoSummaryCallback(
  ctx: Context,
  data: string,
  bot: Bot,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length < 4) {
    await ctx.answerCallbackQuery({ text: "درخواست نامعتبر", show_alert: true });
    return;
  }
  const action = parts[1]!;
  const chatId = Number(parts[2]);
  const startSec = Number(parts[3]);
  if (!Number.isFinite(chatId) || !Number.isFinite(startSec)) {
    await ctx.answerCallbackQuery({ text: "درخواست نامعتبر", show_alert: true });
    return;
  }
  const cb = ctx.callbackQuery;
  if (!cb) return;
  const rule = await getChatRule(chatId).catch(() => null);
  if (!rule) {
    await ctx.answerCallbackQuery({
      text: "تنظیمات این چت پیدا نشد",
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
      text: "گفتگو پیدا نشد",
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
        reportWarn("bot", "[as_callback] editMessageText failed:", err);
      }
    } catch (err) {
      reportError("bot", "[as_callback] resum failed:", err);
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
      reportError("bot", "[as_callback] generate reply failed:", err);
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
      reportWarn("bot", "[as_callback] editMessageText failed:", err);
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
      reportError("bot", "[as_callback] send failed:", err);
      await ctx.answerCallbackQuery({
        text: "ارسال نشد: " + String(err).slice(0, 80),
        show_alert: true,
      });
    }
    return;
  }

  await ctx.answerCallbackQuery({ text: "عملیات ناشناخته" });
}

// Owner typed a reply (or any message) inside the summary_inbox
// channel/group. If it's a reply to one of our delivered summaries,
// forward the text back to the original chat — over the same
// business_connection if available, otherwise plain sendMessage.
// Returns true when the message was a recognised inbox reply and we
// handled it (so the normal classify/log path should skip it).
export async function handleInboxReply(msg: Message, bot: Bot): Promise<boolean> {
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
    reportWarn("bot", "[inbox_reply] bcId lookup failed:", err);
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
    reportError("bot", "[inbox_reply] send failed:", err);
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
