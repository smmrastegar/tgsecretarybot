// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot, InputFile } from "grammy";
import type { Message } from "grammy/types";
import { config } from "../config";
import { downloadTelegramFile } from "../stt";
import { getSettings } from "../settings";
import { bufferMirrorAlbumPart, claimMirrorAlbumFlush, getMirrorAlbumParts, deleteMirrorAlbumBuffer, deleteMirrorAlbumClaim, getReadyMirrorAlbumGroups, type MirrorAlbumPart } from "../db";
import { parseChannelMirrors, type MirrorRule } from "../channel-mirror";
import { reportWarn } from "../report";
import { FORWARDER_JUNK_RX, MediaKind, isFileIdProblem, mediaFileId } from "./core";
import { sendMediaAsOwner } from "./relay";

// Copy every incoming post from a mirrored source chat into its
// destination(s). copyMessage handles all media/text types cleanly and
// posts as a fresh message (no "forwarded from" header). Loop-guarded:
// a chat that is any rule's destination is never used as a source.
export async function maybeMirrorPost(args: { msg: Message; bot: Bot }): Promise<void> {
  const { msg, bot } = args;
  let rules: MirrorRule[];
  try {
    const settings = await getSettings();
    rules = parseChannelMirrors(settings.channelMirrors ?? "");
  } catch (err) {
    reportWarn("bot", "[mirror] settings read failed:", err);
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
      reportWarn("bot", `[mirror] copy ${msg.chat.id}→${r.to} failed:`, err);
    }
  }
}

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
    reportWarn("bot", "[mirror-dm] ready-groups query failed:", err);
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
      reportWarn("bot", `[mirror-dm] album flush failed group=${groupKey}:`, err);
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
      reportWarn("bot", 
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
          reportWarn("bot", "[mirror-dm] album fallback part failed:", e);
        }
      }
    }
  }
}

// Mirror an incoming business-DM message (from a forwarder bot) into
// its configured destination(s), skipping commands and bot chatter.
// Album (media_group) posts are buffered and re-sent as a single
// grouped album instead of separate photos.
export async function maybeMirrorBusinessMessage(args: {
  msg: Message;
  bot: Bot;
}): Promise<void> {
  const { msg, bot } = args;
  let rules: MirrorRule[];
  try {
    const settings = await getSettings();
    rules = parseChannelMirrors(settings.channelMirrors ?? "");
  } catch (err) {
    reportWarn("bot", "[mirror-dm] settings read failed:", err);
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
        reportWarn("bot", `[mirror-dm] buffer failed group=${groupKey}:`, err);
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
      reportWarn("bot", `[mirror-dm] resend ${msg.chat.id}→${r.to} failed:`, err);
    }
  }
}
