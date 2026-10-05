// Personal music library, download side. A track is requested by
// sending its Spotify link to the paid downloader bot AS THE OWNER (the
// same business-connection route the chat relay uses); the bot's cover
// card and audio come back through maybeReturnDownloadedMedia, which
// hands them to the functions here. Files live on this server's disk.
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { reportWarn } from "./report";
import {
  activeMusicJob,
  attachMusicJob,
  getMusicTrack,
  listLinkDownloaders,
  nextQueuedTrack,
  updateMusicTrack,
} from "./db";
import { downloadTelegramFile } from "./stt";

export const MUSIC_DIR = process.env.MUSIC_DIR || "/var/lib/tgsb-music";
// A job that has seen no result for this long is given up on.
const STALE_MS = 8 * 60 * 1000;

async function ensureDir(): Promise<void> {
  await fs.mkdir(MUSIC_DIR, { recursive: true });
}

/** Parse the downloader's card caption ("🎧 Title : …" lines). */
export function parseTrackCard(caption: string): {
  title: string | null; artist: string | null; album: string | null; releaseDate: string | null;
} {
  const pick = (label: RegExp): string | null => {
    for (const raw of caption.split("\n")) {
      const m = label.exec(raw);
      if (m) {
        const v = raw.slice(m.index + m[0].length).trim().replace(/^[:：]\s*/, "").trim();
        if (v && v !== "-" && v !== "—") return v;
      }
    }
    return null;
  };
  return {
    title: pick(/\btitle\b\s*/i),
    artist: pick(/\bartist\b\s*/i),
    album: pick(/\balbum\b\s*/i),
    releaseDate: pick(/release\s*date\s*/i),
  };
}

function ext(name: string, mime: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return m[1]!.toLowerCase();
  if (/flac/i.test(mime)) return "flac";
  if (/ogg/i.test(mime)) return "ogg";
  if (/mp4|m4a|aac/i.test(mime)) return "m4a";
  return "mp3";
}

export async function saveMusicCover(trackId: number, fileId: string, caption: string): Promise<void> {
  try {
    await ensureDir();
    const f = await downloadTelegramFile(config.telegramBotToken, fileId);
    const p = path.join(MUSIC_DIR, `${trackId}.cover.jpg`);
    await fs.writeFile(p, f.data);
    const meta = parseTrackCard(caption);
    await updateMusicTrack(trackId, { coverPath: p, ...meta });
  } catch (err) {
    reportWarn("music", `cover for track ${trackId} failed:`, err);
  }
}

/** The audio arrived: download, store, mark ready. Throws on failure. */
export async function saveMusicAudio(trackId: number, fileId: string, info: {
  title?: string | null; performer?: string | null; duration?: number | null; fileName?: string | null; size?: number | null;
}): Promise<void> {
  if ((info.size ?? 0) > 20 * 1024 * 1024) {
    throw new Error(`فایل ${Math.round((info.size ?? 0) / 1048576)}MB است (کیفیت بات روی FLAC است). در چت بات دانلودر Menu ← Quality را روی MP3 بگذار و ↻ بزن`);
  }
  await ensureDir();
  const f = await downloadTelegramFile(config.telegramBotToken, fileId);
  const e = ext(info.fileName ?? f.name, f.mime);
  const p = path.join(MUSIC_DIR, `${trackId}.${e}`);
  await fs.writeFile(p, f.data);
  const cur = await getMusicTrack(trackId);
  await updateMusicTrack(trackId, {
    filePath: p,
    mime: e === "flac" ? "audio/flac" : e === "ogg" ? "audio/ogg" : e === "m4a" ? "audio/mp4" : "audio/mpeg",
    sizeBytes: f.data.length,
    durationS: info.duration ?? null,
    title: cur?.title ?? info.title ?? null,
    artist: cur?.artist ?? info.performer ?? null,
    status: "ready",
    error: null,
  });
}

export async function failMusicTrack(trackId: number, error: string): Promise<void> {
  await updateMusicTrack(trackId, { status: "failed", error: error.slice(0, 300) });
}

export async function removeMusicFiles(paths: Array<string | null>): Promise<void> {
  for (const p of paths) {
    if (p) await fs.unlink(p).catch(() => {});
  }
}

/**
 * Start the next queued track if the downloader is idle (it handles one
 * link at a time). Safe to call from anywhere, any number of times.
 */
export async function kickMusicQueue(): Promise<{ started: number | null }> {
  const active = await activeMusicJob();
  if (active) {
    const age = Date.now() - Date.parse(active.createdAt.replace(" ", "T"));
    if (age < STALE_MS) return { started: null };
    // Give up on a stuck job so the queue moves on.
    const { finishLinkJob } = await import("./db");
    await finishLinkJob(active.jobId, 0);
    await failMusicTrack(active.trackId, "بات دانلودر جوابی نداد (تایم‌اوت)");
  }
  const track = await nextQueuedTrack();
  if (!track) return { started: null };
  const downloader = (await listLinkDownloaders()).find((d) => d.kind === "spotify");
  if (!downloader) {
    await failMusicTrack(track.id, "دانلودر اسپاتیفای تنظیم نشده");
    return { started: null };
  }
  const { getBot, activeBusinessConnectionId } = await import("./bot");
  const bcId = await activeBusinessConnectionId();
  if (!bcId) {
    reportWarn("music", "no active business connection; track stays queued");
    return { started: null };
  }
  try {
    const sent = await getBot().api.sendMessage(downloader.botId, track.spotifyUrl, {
      business_connection_id: bcId,
    });
    const { createLinkJob } = await import("./db");
    const jobId = await createLinkJob({
      kind: "spotify",
      relayBotId: downloader.botId,
      sourceChatId: downloader.botId,
      sourceMessageId: null,
      link: track.spotifyUrl,
      relayMessageId: sent.message_id,
    });
    if (jobId != null) await attachMusicJob(jobId, track.id);
    await updateMusicTrack(track.id, { status: "downloading", error: null });
    return { started: track.id };
  } catch (err) {
    await failMusicTrack(track.id, `ارسال به بات ناموفق: ${String(err).slice(0, 150)}`);
    return { started: null };
  }
}
