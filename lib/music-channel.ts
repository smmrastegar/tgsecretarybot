// The intake channel keeps one tidy copy of every song that came in through it. When a song is renamed (or gets a new cover / audio) in the
// player, that copy is edited too: the Telegram message is the same message, only its title, performer, caption, cover and file change.
import { promises as fs } from "node:fs";
import path from "node:path";
import { InputFile, InputMediaBuilder } from "grammy";
import sharp from "sharp";
import { getAllSettings, getChannelCopy, getMusicTrack, listManualWithoutCopy, maxLoggedChannelMessage, setChannelCopy } from "./db";
import { intakeChatId } from "./music-intake";
import { reportInfo, reportWarn } from "./report";

const getBot = async () => (await import("./bot")).getBot();
const TG_UPLOAD_MAX = 49 * 1024 * 1024; // what a bot may upload through the public Bot API
const running = new Map<number, Promise<unknown>>();

/** Older songs: their copy's message id was never stored. The messages in the channel are probed (forwarded silently to the owner, read, deleted) and matched by file size. */
async function discoverCopies(chat: number): Promise<number> {
  const waiting = await listManualWithoutCopy();
  if (waiting.length === 0) return 0;
  const owner = Number((await getAllSettings()).ownerNotifyChatId);
  if (!Number.isFinite(owner) || owner === 0) return 0;
  const bySize = new Map<number, number[]>();
  for (const w of waiting) bySize.set(w.sizeBytes, [...(bySize.get(w.sizeBytes) ?? []), w.id]);
  const bot = await getBot();
  const top = (await maxLoggedChannelMessage(chat)) + 40;
  let found = 0;
  for (let id = 1; id <= top; id++) {
    try {
      const fwd = await bot.api.forwardMessage(owner, chat, id, { disable_notification: true });
      await bot.api.deleteMessage(owner, fwd.message_id).catch(() => {});
      const a = fwd.audio;
      const ours = (fwd.caption ?? "").startsWith("🎵");
      const hit = a && ours ? bySize.get(a.file_size ?? -1) : undefined;
      if (hit?.length) { await setChannelCopy(hit.shift()!, chat, id); found++; }
      await new Promise((r) => setTimeout(r, 350));
    } catch { /* deleted / not a message: next */ }
  }
  if (found) reportInfo("music", `channel copies: found ${found} older song(s) in the intake channel`);
  return found;
}

async function sync(trackId: number): Promise<string> {
  const chat = await intakeChatId();
  const t = await getMusicTrack(trackId);
  if (!chat || !t || t.source !== "manual" || !t.filePath || !t.title) return "none";
  let copy = await getChannelCopy(trackId);
  if (!copy) { await discoverCopies(chat); copy = await getChannelCopy(trackId); }
  if (!copy) return "none"; // this song has no copy in the channel
  const size = (await fs.stat(t.filePath).catch(() => null))?.size ?? 0;
  if (!size || size > TG_UPLOAD_MAX) return "toolarge";
  const ext = path.extname(t.filePath).replace(".", "") || "mp3";
  let thumb: InputFile | undefined;
  if (t.coverPath) {
    const buf = await sharp(t.coverPath).resize(320, 320, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer().catch(() => null);
    if (buf) thumb = new InputFile(buf, "cover.jpg");
  }
  const artist = t.artist ?? "";
  try {
    const bot = await getBot();
    await bot.api.editMessageMedia(copy.chat, copy.msg, InputMediaBuilder.audio(new InputFile(t.filePath, `${artist} - ${t.title}.${ext}`), { title: t.title, performer: artist, duration: t.durationS ?? undefined, thumbnail: thumb, caption: `🎵 ${t.title}\n👤 ${artist}` }));
    return "edited";
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/not modified/i.test(msg)) return "edited";
    if (/not found|MESSAGE_ID_INVALID|can't be edited/i.test(msg)) { await setChannelCopy(trackId, null, null); return "gone"; }
    reportWarn("music", `channel copy of song ${trackId} was not updated:`, e);
    return "failed";
  }
}

/** Bring the channel's copy of this song up to date (name, artist, cover, audio). Safe to call for any song; one run per song at a time. Never throws. */
export function syncChannelCopy(trackId: number): Promise<string> {
  const prev = running.get(trackId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => sync(trackId)).catch((e) => { reportWarn("music", `channel copy sync ${trackId} failed:`, e); return "failed"; });
  running.set(trackId, next);
  void next.finally(() => { if (running.get(trackId) === next) running.delete(trackId); });
  return next;
}
