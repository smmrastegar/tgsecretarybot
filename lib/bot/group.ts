// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot } from "grammy";
import type { Message } from "grammy/types";
import { classify } from "../classifier";
import { maybeRouteMedia } from "../media-router";
import { ensureChatRuleWithDefaults } from "../chat-defaults";
import { fireAlert } from "../alert";
import { getSettings } from "../settings";
import { getChatRule, hasDb, isAllowedUser, logMessage, logMediaRouting, type ChatMode, isChatIgnored, upsertForumTopic, getEmailAccountByChannel, getEmailPendingReply, deleteEmailPendingReply } from "../db";
import { replyToEmail, sendEmail } from "../email";
import { reportError, reportWarn } from "../report";
import { autoExtractAndSave, maybeApplyNoteWatch, maybeDescribeMedia, maybeExtractOtp } from "./business";
import { describeMessage, extractInlineUrlButtons, extractMedia, harvestContactShare } from "./core";
import { maybeMirrorPost } from "./mirror";
import { maybeApplyMessageRules } from "./rules-apply";
import { maybeAutoSummarizeOnArrival } from "./summary";
import { background } from "../background";

// Handles email actions that arrive as plain group messages:
//   (a) a reply to the bot's force-reply prompt → send the email reply
//   (b) "/email to@x.com | subject | body" in the email channel → send
// Returns true when it consumed the message.
export async function handleEmailGroupMessage(m: Message, bot: Bot): Promise<boolean> {
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
export async function handleChannelPost(msg: Message, bot: Bot): Promise<void> {
  await handleAnyChatPost(msg, bot);
}

export async function handleGroupMessage(msg: Message, bot: Bot): Promise<void> {
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
        reportWarn("bot", "[forum] topic_created upsert failed:", err),
      );
    } else if (forum.forum_topic_edited) {
      await upsertForumTopic({
        chatId: msg.chat.id,
        messageThreadId: threadId,
        name: forum.forum_topic_edited.name ?? null,
        iconEmoji: forum.forum_topic_edited.icon_custom_emoji_id ?? null,
      }).catch((err) =>
        reportWarn("bot", "[forum] topic_edited upsert failed:", err),
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
    background("logMediaRouting", logMediaRouting({
      sourceChatId: msg.chat.id,
      sourceMessageId: msg.message_id,
      kind,
      decision: "received_group",
    }));
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
    reportWarn("bot", "[mirror] failed:", err),
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
      reportWarn("bot", "[chat-defaults] ensure failed:", err),
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
      }).catch((err) => reportError("bot", "[db] group mute-log failed:", err));
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
    reportError("bot", "[classify] group failed:", err);
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
    background("autoExtractAndSave", autoExtractAndSave({
      text,
      chatId: msg.chat.id,
      chatTitle,
      senderName,
      messageId: msg.message_id,
      businessConnectionId: null,
    }));
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
      reportError("bot", "[alert] group failed:", err);
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
        reportError("bot", "[notify] group failed:", err);
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
      background("maybeExtractOtp", maybeExtractOtp({ logId, text }));
      // Rules used to run only on the business-connection path, so a
      // rule pointed at a group or one of its forum topics silently
      // never fired — the messages were logged and then dropped on the
      // floor. Groups go through the same evaluator now; the source
      // chat / topic scope is what keeps a rule from over-reaching.
      if (text && text.trim()) {
        await maybeApplyMessageRules({
          logId,
          chatId: msg.chat.id,
          chatTitle,
          messageThreadId: msg.message_thread_id ?? null,
          senderName,
          messageText: text,
          businessConnectionId: null,
          fromOwner: false,
          bot,
        }).catch((err) =>
          reportWarn("bot", "[rules] apply failed (group path):", err),
        );
      }
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
        reportWarn("bot", "[watchlist] apply failed:", err),
      );
      background("maybeDescribeMedia", maybeDescribeMedia({
        mode,
        logId,
        mediaFileId,
        mediaKind,
        chatId: msg.chat.id,
        bcId: null,
      }));
      background("maybeAutoSummarizeOnArrival", maybeAutoSummarizeOnArrival({
        rule,
        msg,
        bot,
      }));
      // SMS routing for channel/group messages too — the operator's
      // SMS-to-Telegram gateway usually delivers into a Channel like
      // "Mahdi SMS1", not the personal business chat.
      try {
        const { routeSmsForward } = await import("../sms-router");
        await routeSmsForward({
          bot,
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          text,
        });
      } catch (err) {
        reportWarn("bot", "[sms] route failed (channel/group):", err);
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
          background("logMediaRouting", logMediaRouting({
            sourceChatId: msg.chat.id,
            sourceMessageId: msg.message_id,
            kind,
            decision: "skipped_owner_self",
          }));
        }
      } else {
        background("maybeRouteMedia", maybeRouteMedia({ rule, msg, bot }).then((r) => {
          if (r.errors.length > 0) {
            reportWarn("bot", "[media-router/group] errors:", r.errors);
          }
        }));
      }
    } catch (err) {
      reportError("bot", "[db] group-log failed:", err);
    }
  }
}
