import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import {
  audit,
  hasDb,
  openSecretarySession,
  recordSecretaryLink,
  sql,
  upsertChatRule,
} from "@/lib/db";
import { getSecretaries } from "@/lib/secretaries";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

type Row = {
  chat_id: string | number;
  chat_type: string;
  chat_title: string | null;
  sender_id: string | number | null;
  sender_username: string | null;
  sender_name: string;
  message_id: string | number;
  message_text: string;
  media_file_id: string | null;
  media_kind: string | null;
  business_connection_id: string;
  owner_user_id: string | number | null;
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "db not configured" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    secretaryUserId?: number;
    note?: string;
  };
  const settings = await getSettings();
  const secList = getSecretaries(settings);
  if (secList.length === 0) {
    return NextResponse.json(
      { error: "no secretaries configured" },
      { status: 400 },
    );
  }
  const target =
    secList.find((s) => s.userId === Number(body.secretaryUserId)) ??
    secList[0];
  if (!target) {
    return NextResponse.json({ error: "secretary not found" }, { status: 400 });
  }

  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, sender_id, sender_username,
           sender_name, message_id, message_text, media_file_id, media_kind,
           business_connection_id, owner_user_id
    FROM messages_log WHERE id = ${messageId} LIMIT 1`;
  const row = rows[0] as Row | undefined;
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const bot = getBot();
  const ownerLabel =
    settings.ownerDisplayName || settings.ownerName || "the owner";
  const chatId = Number(row.chat_id);
  const senderMessageId = Number(row.message_id);

  // 1. Header
  const headerLines = [
    `👤 ${row.sender_name}` +
      (row.sender_username ? ` (@${row.sender_username})` : ""),
    `🆔 user ${chatId}`,
    `📨 Forwarded manually by ${ownerLabel} for ${target.name}`,
    ...(body.note ? [`📝 ${body.note}`] : []),
    "",
    `↩️ Reply to any message in this thread to respond as ${ownerLabel}.`,
  ];
  let header;
  try {
    header = await bot.api.sendMessage(target.userId, headerLines.join("\n"));
  } catch (err) {
    return NextResponse.json(
      {
        error:
          `Couldn't DM ${target.name} (${target.userId}). Ask them to /start the bot first. ${String(err).slice(0, 200)}`,
      },
      { status: 500 },
    );
  }

  // 2. Open session + link the header
  const sessionRow = await openSecretarySession({
    businessConnectionId: row.business_connection_id,
    senderChatId: chatId,
    senderName: row.sender_name,
    senderUsername: row.sender_username,
    secretaryUserId: target.userId,
    secretaryChatId: target.userId,
    headerMessageId: header.message_id,
    ownerUserId: row.owner_user_id != null ? Number(row.owner_user_id) : null,
  });
  await recordSecretaryLink({
    sessionId: sessionRow.id,
    secretaryChatId: target.userId,
    secretaryMessageId: header.message_id,
    direction: "inbound",
    senderMessageId,
  });

  // 3. Send the actual content (media via file_id, text otherwise) as a reply
  //    to the header so the thread structure is consistent with auto-forwards.
  const prefix = `📩 ${row.sender_name}: `;
  const captionPrefix = (raw: string | null): string => {
    const merged = prefix + (raw ?? "");
    return merged.slice(0, 1024);
  };
  const replyOpts = { reply_parameters: { message_id: header.message_id } };

  async function logSentLink(sentMessageId: number): Promise<void> {
    await recordSecretaryLink({
      sessionId: sessionRow.id,
      secretaryChatId: target!.userId,
      secretaryMessageId: sentMessageId,
      direction: "inbound",
      senderMessageId,
    });
  }

  try {
    if (row.media_file_id && row.media_kind) {
      const fid = row.media_file_id;
      const captionMaybe = row.message_text || "";
      switch (row.media_kind) {
        case "photo": {
          const m = await bot.api.sendPhoto(target.userId, fid, {
            ...replyOpts,
            caption: captionPrefix(captionMaybe),
          });
          await logSentLink(m.message_id);
          break;
        }
        case "video": {
          const m = await bot.api.sendVideo(target.userId, fid, {
            ...replyOpts,
            caption: captionPrefix(captionMaybe),
          });
          await logSentLink(m.message_id);
          break;
        }
        case "voice": {
          const m = await bot.api.sendVoice(target.userId, fid, {
            ...replyOpts,
            caption: captionPrefix(captionMaybe),
          });
          await logSentLink(m.message_id);
          break;
        }
        case "audio": {
          const m = await bot.api.sendAudio(target.userId, fid, {
            ...replyOpts,
            caption: captionPrefix(captionMaybe),
          });
          await logSentLink(m.message_id);
          break;
        }
        case "document": {
          const m = await bot.api.sendDocument(target.userId, fid, {
            ...replyOpts,
            caption: captionPrefix(captionMaybe),
          });
          await logSentLink(m.message_id);
          break;
        }
        case "animation": {
          const m = await bot.api.sendAnimation(target.userId, fid, {
            ...replyOpts,
            caption: captionPrefix(captionMaybe),
          });
          await logSentLink(m.message_id);
          break;
        }
        case "sticker": {
          const hdr = await bot.api.sendMessage(
            target.userId,
            prefix + "[sticker]",
            replyOpts,
          );
          await logSentLink(hdr.message_id);
          const m = await bot.api.sendSticker(target.userId, fid, replyOpts);
          await logSentLink(m.message_id);
          break;
        }
        case "video_note": {
          const hdr = await bot.api.sendMessage(
            target.userId,
            prefix + "[video note]",
            replyOpts,
          );
          await logSentLink(hdr.message_id);
          const m = await bot.api.sendVideoNote(target.userId, fid, replyOpts);
          await logSentLink(m.message_id);
          break;
        }
        default: {
          const m = await bot.api.sendMessage(
            target.userId,
            prefix + row.message_text,
            replyOpts,
          );
          await logSentLink(m.message_id);
        }
      }
    } else {
      const m = await bot.api.sendMessage(
        target.userId,
        prefix + row.message_text,
        replyOpts,
      );
      await logSentLink(m.message_id);
    }
  } catch (err) {
    console.error("[forward] content send failed:", err);
  }

  // Switching to a manual forward implies the owner wants the secretary
  // path for future incoming messages from this sender, so set the chat
  // mode to 'secretary' (the default, but explicit if it was changed).
  try {
    await upsertChatRule({
      chatId,
      chatType: row.chat_type,
      chatTitle: row.chat_title,
      vip: false,
      muted: false,
      customReply: null,
      notes: null,
      mode: "secretary",
    });
  } catch (err) {
    console.error("[forward] mode update failed:", err);
  }

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "message.forward",
    target: String(messageId),
    details: { to: target.userId, name: target.name, sessionId: sessionRow.id },
  });
  return NextResponse.json({
    ok: true,
    sessionId: sessionRow.id,
    secretary: { userId: target.userId, name: target.name },
  });
}
