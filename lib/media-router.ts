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

function transcribeKeyboard(
  storageChatId: number,
  storageMessageId: number,
): InlineKeyboard {
  // callback_data is capped at 64 bytes. tx:<chatId>:<msgId> stays
  // well under that. The handler reads the row from
  // media_router_messages to recover the file_id.
  return new InlineKeyboard().text(
    "📝 Transcribe",
    `tx:${storageChatId}:${storageMessageId}`,
  );
}

export async function maybeRouteMedia(args: {
  rule: ChatRule | null;
  msg: Message;
  bot: Bot;
}): Promise<RouteResult> {
  const { rule, msg, bot } = args;
  const result: RouteResult = { routed: [], errors: [] };
  if (!rule) return result;

  const sender = senderName(msg);
  const chatLabel = sourceChatLabel(rule, msg);
  const captionPrefix = `🔁 از <b>${escapeHtml(chatLabel)}</b> · ${escapeHtml(sender)}`;

  // Voice + video-note share the same target channel.
  if (
    rule.autoForwardVoice &&
    (msg.voice || msg.video_note) &&
    !rule.muted
  ) {
    const targets = await listChatsByFunction("voice_storage");
    const t = targets[0];
    if (!t) {
      result.errors.push("no voice_storage chat configured");
    } else {
      try {
        let sent: Message | null = null;
        if (msg.voice) {
          sent = await bot.api.sendVoice(t.chatId, msg.voice.file_id, {
            caption: captionPrefix,
            parse_mode: "HTML",
            reply_markup: transcribeKeyboard(t.chatId, 0).inline_keyboard
              ? undefined // placeholder; will edit after send to attach with real id
              : undefined,
          });
        } else if (msg.video_note) {
          // video_note has no caption support; we send the note then
          // a separate text reply with the button so transcribe still
          // works.
          sent = await bot.api.sendVideoNote(
            t.chatId,
            msg.video_note.file_id,
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
          // Attach the 📝 Transcribe button now that we know the
          // sent message id. For voice we edit reply_markup; for
          // video_note (which doesn't support markup directly) we
          // send a follow-up text message with the button.
          if (msg.voice) {
            await bot.api
              .editMessageReplyMarkup(t.chatId, sent.message_id, {
                reply_markup: transcribeKeyboard(t.chatId, sent.message_id),
              })
              .catch((err) =>
                console.warn("[media-router] editMarkup failed:", err),
              );
          } else {
            await bot.api
              .sendMessage(t.chatId, captionPrefix, {
                parse_mode: "HTML",
                reply_to_message_id: sent.message_id,
                reply_markup: transcribeKeyboard(t.chatId, sent.message_id),
              })
              .catch((err) =>
                console.warn("[media-router] follow-up failed:", err),
              );
          }
          result.routed.push({
            to: "voice",
            chatId: t.chatId,
            messageId: sent.message_id,
          });
        }
      } catch (err) {
        result.errors.push(
          `voice -> ${t.chatId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (rule.autoForwardVideo && msg.video) {
    const t = (await listChatsByFunction("video_storage"))[0];
    if (!t) result.errors.push("no video_storage chat configured");
    else {
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
      } catch (err) {
        result.errors.push(
          `video -> ${t.chatId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (rule.autoForwardPhoto && msg.photo && msg.photo.length > 0) {
    const t = (await listChatsByFunction("photo_storage"))[0];
    const biggest = msg.photo[msg.photo.length - 1];
    if (!t) result.errors.push("no photo_storage chat configured");
    else if (biggest) {
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
      } catch (err) {
        result.errors.push(
          `photo -> ${t.chatId}: ${err instanceof Error ? err.message : String(err)}`,
        );
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
