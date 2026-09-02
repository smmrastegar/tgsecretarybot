// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot, InputFile } from "grammy";
import type { Message } from "grammy/types";
import { config } from "../config";
import { downloadTelegramFile, sttConfigured, transcribeAudio } from "../stt";
import { defaultSecretary, getSecretaries, type Secretary } from "../secretaries";
import { getSettings } from "../settings";
import { findActiveSecretarySessionForSender, findLinkWithSenderMessage, findOnlyActiveSessionForSecretary, findSecretaryLinkForSenderMessage, findSessionByLinkedMessage, getChatRule, getSenderStats, hasDb, openSecretarySession, recentConversation, recordSecretaryLink, touchSecretarySession, type SecretarySession, findEnabledRelaysForSource, findSecretaryRelayLinkByRecipientMessage, findLatestInboundLinkForRecipient, recordSecretaryRelayLink, recordOwnerReaction } from "../db";
import type { MessageReactionUpdated, ReactionType } from "grammy/types";
import { reportError, reportWarn } from "../report";
import { MediaKind, OwnerCacheEntry, SendCommon, activeBusinessConnectionId, isFileIdProblem, markBusinessRead, mediaFileId, messageKind, relTime, resolveOwner } from "./core";

// --- Media-link download relay -------------------------------------
// A contact drops an Instagram/Spotify link in a DM. We forward the URL
// to the matching downloader bot AS THE OWNER (bots cannot message
// bots; the business connection makes us the user), then hand whatever
// the downloader sends back to the person who asked.

export async function maybeRelayDownloadLink(msg: Message, bot: Bot): Promise<void> {
  if (msg.chat.type !== "private") return;
  // Only links a PERSON sends. Bots in the owner's DMs (SMS forwarders,
  // monitoring bots, newsletters) routinely carry links that have
  // nothing to do with a download request, and relaying those would
  // burn the downloader on every notification.
  if (msg.from?.is_bot) return;
  const text = msg.text ?? msg.caption ?? "";
  if (!text) return;
  const { findDownloadableLink, createLinkJob, listLinkDownloaders } =
    await import("../db");
  // Never relay a downloader's own chat back into itself, or we'd loop.
  const downloaders = await listLinkDownloaders();
  if (downloaders.some((d) => d.botId === msg.chat.id)) return;
  const hit = await findDownloadableLink(text);
  if (!hit) return;
  const bcId = await activeBusinessConnectionId();
  if (!bcId) return;
  try {
    const sent = await bot.api.sendMessage(hit.botId, hit.url, {
      business_connection_id: bcId,
    });
    await createLinkJob({
      kind: hit.kind,
      relayBotId: hit.botId,
      sourceChatId: msg.chat.id,
      sourceMessageId: msg.message_id,
      link: hit.url,
      relayMessageId: sent.message_id,
    });
    console.log(
      `[link-relay] ${hit.kind} link from chat=${msg.chat.id} → bot=${hit.botId}`,
    );
  } catch (err) {
    reportWarn("link-relay", `send to ${hit.label} bot failed:`, err);
  }
}

// Returns true when this message WAS a downloader reply we consumed.
export async function maybeReturnDownloadedMedia(
  msg: Message,
  bot: Bot,
): Promise<boolean> {
  const { listLinkDownloaders, findPendingLinkJob, finishLinkJob } =
    await import("../db");
  const downloader = (await listLinkDownloaders()).find(
    (d) => d.botId === msg.chat.id,
  );
  if (!downloader) return false;
  const hasMedia = !!(
    msg.photo || msg.video || msg.audio || msg.document ||
    msg.animation || msg.voice
  );
  // Status chatter ("downloading…", menus) carries no media — leave it.
  if (!hasMedia) return false;
  const replyTo = msg.reply_to_message?.message_id ?? null;
  const job = await findPendingLinkJob(downloader.botId, replyTo);
  if (!job) return false;
  const bcId = await activeBusinessConnectionId();
  if (!bcId) return false;
  // copyMessage cannot address a message that arrived over a business
  // connection ("message to copy not found"), so re-send the media by
  // its file_id instead.
  const media = mediaFileId(msg);
  if (!media) return false;
  try {
    await sendMediaAsOwner({
      bot,
      toChatId: job.sourceChatId,
      businessConnectionId: bcId,
      kind: media.kind,
      file: media.fileId,
      caption: msg.caption ?? undefined,
      replyToMessageId: job.sourceMessageId ?? undefined,
    });
    await finishLinkJob(job.id, 1);
    console.log(
      `[link-relay] returned ${downloader.kind} ${media.kind} to chat=${job.sourceChatId}`,
    );
    return true;
  } catch (err) {
    // Leave the job pending and DON'T swallow the message: a consumed
    // message that never arrived would vanish from the log too.
    reportWarn("link-relay", "send back to requester failed:", err);
    return false;
  }
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
  reportWarn("bot", 
    `[relay] no handler for message type; payload keys: ${keys.join(", ")}`,
  );
  return sent;
}

export async function maybeForwardToSecretary(args: {
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
        reportError("bot", "[secretary] context send failed:", err);
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
              `📝 متن پیاده‌شده:\n${tr.text}`.slice(0, 4096),
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
          reportError("bot", "[secretary] auto-transcribe failed:", err);
        }
      }
    }

    return true;
  } catch (err) {
    const e = err as { error_code?: number; description?: string };
    if (e?.error_code === 403) {
      reportError("bot", 
        `[secretary] cannot DM secretary ${secId}: bot is blocked or /start was never sent.`,
      );
    } else {
      reportError("bot", "[secretary] forward failed:", err);
    }
    return false;
  }
}

// Per-media-type send via business_connection_id. file is either the
// raw file_id (fast path) or an InputFile after download+reupload
// (fallback). Caption (where supported) carries the source caption.
export async function sendMediaAsOwner(args: {
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
      reportWarn("bot", 
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

export async function maybeForwardViaRelays(args: {
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
          reportWarn("bot", 
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
          reportWarn("bot", 
            `[relay] recipient ${rcpt.chatId} not reachable via business (no existing chat / blocked / privacy)`,
          );
        } else {
          reportError("bot", 
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
export async function maybeRelayRecipientReplyBusiness(args: {
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
      reportWarn("bot", 
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
    reportError("bot", "[relay] reply (business) failed:", err);
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
    reportError("bot", "[relay] reply failed:", err);
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

export async function handleSecretaryReply(msg: Message, bot: Bot): Promise<void> {
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
      "گفتگوی فعالی برای ارسال وجود ندارد. برای پاسخ، روی یکی از پیام‌های فوروارد‌شده ریپلای کن.",
      { reply_parameters: { message_id: msg.message_id } },
    );
    return;
  }
  if (session.endedAt) {
    await bot.api.sendMessage(
      msg.chat.id,
      "این گفتگو بسته شده (صاحب اکانت خودش وارد شد یا منقضی شد).",
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
    reportError("bot", "[secretary] relay failed:", err);
    await bot.api
      .sendMessage(
        msg.chat.id,
        `❌ Failed to relay: ${String(err).slice(0, 200)}`,
        { reply_parameters: { message_id: msg.message_id } },
      )
      .catch(() => {});
  }
}

export async function handleSecretaryReaction(
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
          reportWarn("bot", `[reaction] owner-log DB write failed chat=${upd.chat.id}:`, err);
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
      reportError("bot", "[reaction] sender→secretary failed:", err);
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
    reportError("bot", "[reaction] text relay failed:", err);
  }
}
