// Per-chat media routing — when a chat has any of the auto_forward_*
// or auto_extract_notes flags on, this module fans the incoming
// message out to the right storage channel and/or pulls structured
// notes out of the text. Called from handleBusinessMessage right
// after the message is logged.
//
// Storage channels are designated via FunctionRole tags. We pick
// the FIRST channel tagged with each role (matches the
// storage/downloader convention).

import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import {
  addChatNote,
  type ChatRule,
  hasDb,
  listChatsByFunction,
  logMediaRouting,
  sql,
} from "./db";
import { getCurrentTenantId } from "./tenant-context";

type RouteResult = {
  routed: Array<{ to: "voice" | "video" | "photo" | "location"; chatId?: number; messageId?: number }>;
  errors: string[];
};

function senderName(msg: Message): string {
  const from = msg.from;
  if (!from) return "unknown";
  const parts = [from.first_name, from.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (from.username) return `@${from.username}`;
  return `user ${from.id}`;
}

function sourceChatLabel(rule: ChatRule | null, msg: Message): string {
  if (rule) {
    const full = [rule.firstName, rule.lastName].filter(Boolean).join(" ").trim();
    if (full) return full;
    if (rule.nickname) return rule.nickname;
    if (rule.chatTitle) return rule.chatTitle;
  }
  return msg.chat.title ?? `chat ${msg.chat.id}`;
}

async function recordCopy(args: {
  storageChatId: number;
  storageMessageId: number;
  fileId: string;
  kind: string;
  sourceChatId: number;
  sourceMessageId: number;
  sourceSenderName: string;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    INSERT INTO media_router_messages (
      storage_chat_id, storage_message_id, file_id, kind,
      source_chat_id, source_message_id, source_sender_name, tenant_id
    )
    VALUES (${args.storageChatId}, ${args.storageMessageId}, ${args.fileId},
            ${args.kind}, ${args.sourceChatId}, ${args.sourceMessageId},
            ${args.sourceSenderName}, ${getCurrentTenantId()})
    ON CONFLICT (storage_chat_id, storage_message_id) DO NOTHING`;
}

function transcribeKeyboard(): InlineKeyboard {
  // callback_data is intentionally a constant. The handler reads the
  // storage chat_id + message_id from ctx.callbackQuery.message itself
  // — the button is always attached to the message it transcribes, so
  // there's no need to encode them here. This lets us attach the
  // button via reply_markup on the original sendVoice call (atomic)
  // instead of an editMessageReplyMarkup follow-up that silently
  // no-ops in channels.
  return new InlineKeyboard().text("📝 Transcribe", "tx:lookup");
}

export async function maybeRouteMedia(args: {
  rule: ChatRule | null;
  msg: Message;
  bot: Bot;
}): Promise<RouteResult> {
  const { rule, msg, bot } = args;
  const result: RouteResult = { routed: [], errors: [] };

  // What kind of payload is this? We use this for logging even when
  // the chat has no rule yet (so the operator can see "voice arrived
  // here but I have no chat_rules row for it").
  const payloadKind = msg.voice
    ? "voice"
    : msg.video_note
      ? "video_note"
      : msg.video
        ? "video"
        : msg.photo
          ? "photo"
          : msg.location
            ? "location"
            : null;

  if (!rule) {
    if (payloadKind) {
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind: payloadKind,
        decision: "no_rule",
      }).catch(() => {});
    }
    return result;
  }

  const sender = senderName(msg);
  const chatLabel = sourceChatLabel(rule, msg);
  const captionPrefix = `🔁 از <b>${escapeHtml(chatLabel)}</b> · ${escapeHtml(sender)}`;

  // Voice → voice_storage. Video-notes → video_note_storage if set,
  // otherwise fall back to voice_storage (so a single channel still
  // works for users who haven't bothered splitting them).
  if (msg.voice || msg.video_note) {
    const kind = msg.voice ? "voice" : "video_note";
    if (!rule.autoForwardVoice) {
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "flag_off",
      }).catch(() => {});
    } else if (rule.muted) {
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "muted",
      }).catch(() => {});
    } else {
    let targets;
    let targetRole: string;
    if (msg.video_note) {
      targets = await listChatsByFunction("video_note_storage");
      targetRole = "video_note_storage";
      if (targets.length === 0) {
        targets = await listChatsByFunction("voice_storage");
        targetRole = "voice_storage";
      }
    } else {
      targets = await listChatsByFunction("voice_storage");
      targetRole = "voice_storage";
    }
    const t = targets[0];
    if (!t) {
      result.errors.push("no voice_storage chat configured");
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind,
        decision: "no_target",
        targetRole,
      }).catch(() => {});
    } else {
      try {
        let sent: Message | null = null;
        if (msg.voice) {
          // Atomic: voice + caption + Transcribe button in one call.
          // No follow-up reply, no editMarkup — both of those failed
          // in channels and left messages without context or button.
          sent = await bot.api.sendVoice(t.chatId, msg.voice.file_id, {
            caption: captionPrefix,
            parse_mode: "HTML",
            reply_markup: transcribeKeyboard(),
          });
        } else if (msg.video_note) {
          // video_note doesn't accept a caption, but it DOES accept
          // reply_markup so we get the Transcribe button attached
          // directly. Source/sender info goes in a follow-up that
          // we attempt to send right after — best-effort.
          sent = await bot.api.sendVideoNote(
            t.chatId,
            msg.video_note.file_id,
            { reply_markup: transcribeKeyboard() },
          );
        }
        if (sent) {
          const fileId = msg.voice?.file_id ?? msg.video_note!.file_id;
          await recordCopy({
            storageChatId: t.chatId,
            storageMessageId: sent.message_id,
            fileId,
            kind: msg.voice ? "voice" : "video_note",
            sourceChatId: msg.chat.id,
            sourceMessageId: msg.message_id,
            sourceSenderName: sender,
          });
          // For video_note, also send a small text companion with the
          // source info. Best-effort — if the channel rejects replies
          // we still have the button on the round bubble itself.
          if (msg.video_note) {
            await bot.api
              .sendMessage(t.chatId, captionPrefix, { parse_mode: "HTML" })
              .catch((err) =>
                console.warn(
                  "[media-router] video_note caption follow-up failed:",
                  err,
                ),
              );
          }
          result.routed.push({
            to: "voice",
            chatId: t.chatId,
            messageId: sent.message_id,
          });
          await logMediaRouting({
            sourceChatId: msg.chat.id,
            sourceMessageId: msg.message_id,
            kind,
            decision: "routed",
            targetRole,
            targetChatId: t.chatId,
            targetMessageId: sent.message_id,
          }).catch(() => {});
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`voice -> ${t.chatId}: ${errMsg}`);
        await logMediaRouting({
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          kind,
          decision: "error",
          targetRole,
          targetChatId: t.chatId,
          error: errMsg.slice(0, 500),
        }).catch(() => {});
      }
    }
    }
  }

  if (msg.video) {
    if (!rule.autoForwardVideo) {
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind: "video",
        decision: "flag_off",
      }).catch(() => {});
    } else {
    const t = (await listChatsByFunction("video_storage"))[0];
    if (!t) {
      result.errors.push("no video_storage chat configured");
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind: "video",
        decision: "no_target",
        targetRole: "video_storage",
      }).catch(() => {});
    } else {
      try {
        const sent = await bot.api.sendVideo(t.chatId, msg.video.file_id, {
          caption: `${captionPrefix}${msg.caption ? "\n\n" + escapeHtml(msg.caption) : ""}`,
          parse_mode: "HTML",
        });
        await recordCopy({
          storageChatId: t.chatId,
          storageMessageId: sent.message_id,
          fileId: msg.video.file_id,
          kind: "video",
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          sourceSenderName: sender,
        });
        result.routed.push({
          to: "video",
          chatId: t.chatId,
          messageId: sent.message_id,
        });
        await logMediaRouting({
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          kind: "video",
          decision: "routed",
          targetRole: "video_storage",
          targetChatId: t.chatId,
          targetMessageId: sent.message_id,
        }).catch(() => {});
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`video -> ${t.chatId}: ${errMsg}`);
        await logMediaRouting({
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          kind: "video",
          decision: "error",
          targetRole: "video_storage",
          targetChatId: t.chatId,
          error: errMsg.slice(0, 500),
        }).catch(() => {});
      }
    }
    }
  }

  if (msg.photo && msg.photo.length > 0) {
    if (!rule.autoForwardPhoto) {
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind: "photo",
        decision: "flag_off",
      }).catch(() => {});
    } else {
    const t = (await listChatsByFunction("photo_storage"))[0];
    const biggest = msg.photo[msg.photo.length - 1];
    if (!t) {
      result.errors.push("no photo_storage chat configured");
      await logMediaRouting({
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
        kind: "photo",
        decision: "no_target",
        targetRole: "photo_storage",
      }).catch(() => {});
    } else if (biggest) {
      try {
        const sent = await bot.api.sendPhoto(t.chatId, biggest.file_id, {
          caption: `${captionPrefix}${msg.caption ? "\n\n" + escapeHtml(msg.caption) : ""}`,
          parse_mode: "HTML",
        });
        await recordCopy({
          storageChatId: t.chatId,
          storageMessageId: sent.message_id,
          fileId: biggest.file_id,
          kind: "photo",
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          sourceSenderName: sender,
        });
        result.routed.push({
          to: "photo",
          chatId: t.chatId,
          messageId: sent.message_id,
        });
        await logMediaRouting({
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          kind: "photo",
          decision: "routed",
          targetRole: "photo_storage",
          targetChatId: t.chatId,
          targetMessageId: sent.message_id,
        }).catch(() => {});
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`photo -> ${t.chatId}: ${errMsg}`);
        await logMediaRouting({
          sourceChatId: msg.chat.id,
          sourceMessageId: msg.message_id,
          kind: "photo",
          decision: "error",
          targetRole: "photo_storage",
          targetChatId: t.chatId,
          error: errMsg.slice(0, 500),
        }).catch(() => {});
      }
    }
    }
  }

  if (rule.autoForwardLocation && msg.location) {
    const loc = msg.location;
    const venue = msg.venue;
    const title = venue?.title ?? `لوکیشن از ${chatLabel}`;
    const content = venue?.address ?? `${loc.latitude}, ${loc.longitude}`;
    await addChatNote({
      chatId: msg.chat.id,
      tenantId: getCurrentTenantId(),
      sourceMessageId: msg.message_id,
      kind: "location",
      title,
      content,
      senderName: sender,
      metadata: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        venue: venue
          ? {
              title: venue.title,
              address: venue.address,
              foursquareId: venue.foursquare_id,
            }
          : null,
        gmaps: `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`,
      },
    }).catch((err) =>
      result.errors.push(
        `location note: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    // Also forward to a notes_inbox channel if configured.
    const notesInbox = (await listChatsByFunction("notes_inbox"))[0];
    if (notesInbox) {
      try {
        await bot.api.sendLocation(
          notesInbox.chatId,
          loc.latitude,
          loc.longitude,
        );
        await bot.api.sendMessage(
          notesInbox.chatId,
          `📍 <b>${escapeHtml(title)}</b>\n${escapeHtml(content)}\n\n${captionPrefix}`,
          { parse_mode: "HTML" },
        );
        result.routed.push({ to: "location", chatId: notesInbox.chatId });
      } catch (err) {
        result.errors.push(
          `location -> ${notesInbox.chatId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return result;
}

// Look up the row a 📝 Transcribe button refers to.
export async function getRoutedMessage(args: {
  storageChatId: number;
  storageMessageId: number;
}): Promise<{
  fileId: string;
  kind: string;
  transcript: string | null;
  sourceSenderName: string | null;
} | null> {
  if (!hasDb()) return null;
  const rows = await sql()`
    SELECT file_id, kind, transcript, source_sender_name
    FROM media_router_messages
    WHERE storage_chat_id = ${args.storageChatId}
      AND storage_message_id = ${args.storageMessageId}
    LIMIT 1`;
  const r = rows[0] as
    | {
        file_id: string;
        kind: string;
        transcript: string | null;
        source_sender_name: string | null;
      }
    | undefined;
  if (!r) return null;
  return {
    fileId: r.file_id,
    kind: r.kind,
    transcript: r.transcript,
    sourceSenderName: r.source_sender_name,
  };
}

export async function markTranscribed(args: {
  storageChatId: number;
  storageMessageId: number;
  transcript: string;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE media_router_messages
    SET transcript = ${args.transcript},
        transcribed_at = NOW()
    WHERE storage_chat_id = ${args.storageChatId}
      AND storage_message_id = ${args.storageMessageId}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
