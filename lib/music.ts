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
  // Best effort, off the critical path: authoritative metadata + cover,
  // and a check that the audio really is this track.
  void verifyDownloadedTrack(trackId);
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
    if (active.ageSeconds * 1000 < STALE_MS) return { started: null };
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
  // Expected length first, so the audio that comes back can be matched
  // to THIS track and a stray one rejected (best effort: rate limits).
  if (track.spotifyDurationS == null && track.spotifyId) {
    await repairLibrary({ onlyIds: [track.id] }).catch(() => {});
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

// ---- metadata from Spotify (authoritative) + wrong-audio detection ----

/**
 * Is this audio file the wrong length for the track? The downloader's
 * reported duration is often 0, so when it is missing the length is
 * estimated from the file size: the downloader serves 320 kbps MP3, so
 * seconds ≈ bytes × 8 / 320 000. A file whose implied bitrate for
 * Spotify's length falls outside 300–345 kbps belongs to another track.
 */
export function durationMismatch(audioS: number | null, spotifyS: number | null, sizeBytes?: number | null): boolean {
  if (spotifyS == null || spotifyS <= 0) return false;
  if (audioS != null && audioS > 0) return Math.abs(audioS - spotifyS) > 6;
  if (sizeBytes != null && sizeBytes > 0) {
    const kbps = (sizeBytes * 8) / spotifyS / 1000;
    return kbps < 300 || kbps > 345;
  }
  return false;
}

async function saveCoverFromUrl(trackId: number, url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    await ensureDir();
    const p = path.join(MUSIC_DIR, `${trackId}.cover.jpg`);
    await fs.writeFile(p, new Uint8Array(await res.arrayBuffer()));
    return p;
  } catch {
    return null;
  }
}

export type RepairReport = { checked: number; metaUpdated: number; coversSaved: number; wrongAudio: number; requeued: number; notFound: number; lastId: number; done: boolean; rateLimitedFor: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * For tracks with id > afterId (in id order, at most `limit` per call):
 * take title / artist / album / date / cover from Spotify (the truth),
 * then compare the stored audio length with Spotify's. A mismatch
 * means the downloader's audio was attached to the wrong job: the file
 * is dropped and the track goes back to the queue. Tracks are read one
 * at a time with a pause between them; on a Spotify 429 the call stops
 * and reports how long to wait, so a long library repair is a series
 * of small, resumable steps.
 */
export async function repairLibrary(opts?: { onlyIds?: number[]; afterId?: number; limit?: number }): Promise<RepairReport> {
  const { makeMetaFetcher, SpotifyRateLimited } = await import("./spotify");
  const { listTracksForMeta } = await import("./db");
  let tracks = await listTracksForMeta();
  if (opts?.onlyIds) tracks = tracks.filter((t) => opts.onlyIds!.includes(t.id));
  if (opts?.afterId != null) tracks = tracks.filter((t) => t.id > opts.afterId!);
  const total = tracks.length;
  if (opts?.limit) tracks = tracks.slice(0, opts.limit);
  const report: RepairReport = { checked: 0, metaUpdated: 0, coversSaved: 0, wrongAudio: 0, requeued: 0, notFound: 0, lastId: opts?.afterId ?? 0, done: false, rateLimitedFor: 0 };
  const fetchMeta = await makeMetaFetcher();
  for (const t of tracks) {
    let m;
    try {
      m = await fetchMeta(t.spotifyId);
    } catch (err) {
      if (err instanceof SpotifyRateLimited) { report.rateLimitedFor = err.retryAfterSeconds; return report; }
      throw err;
    }
    report.checked++;
    report.lastId = t.id;
    if (!m) { report.notFound++; await sleep(250); continue; }
    const patch: Parameters<typeof updateMusicTrack>[1] = { title: m.title, artist: m.artist, album: m.album, releaseDate: m.releaseDate, spotifyDurationS: m.durationS };
    if (m.coverUrl) {
      const cp = await saveCoverFromUrl(t.id, m.coverUrl);
      if (cp) { patch.coverPath = cp; report.coversSaved++; }
    }
    if (t.status === "ready" && durationMismatch(t.durationS, m.durationS, t.sizeBytes)) {
      report.wrongAudio++;
      await removeMusicFiles([t.filePath]);
      patch.status = "queued"; patch.error = null; patch.filePath = null; patch.mime = null; patch.sizeBytes = null; patch.durationS = null;
      report.requeued++;
    }
    await updateMusicTrack(t.id, patch);
    report.metaUpdated++;
    await sleep(300);
  }
  report.done = tracks.length >= total;
  return report;
}

/**
 * No Spotify calls: check every stored file against the Spotify length
 * already on record, drop the ones that are the wrong length and put
 * them back in the queue.
 */
export async function verifyLibraryLocal(): Promise<{ checked: number; requeued: number }> {
  const { listTracksForMeta } = await import("./db");
  const tracks = (await listTracksForMeta()).filter((t) => t.status === "ready");
  let requeued = 0;
  for (const t of tracks) {
    if (!durationMismatch(t.durationS, t.spotifyDurationS, t.sizeBytes)) continue;
    await removeMusicFiles([t.filePath]);
    await updateMusicTrack(t.id, { status: "queued", error: null, filePath: null, mime: null, sizeBytes: null, durationS: null });
    requeued++;
  }
  return { checked: tracks.length, requeued };
}

/** Fill in Spotify metadata for tracks that have none yet (small, rate-limit aware). */
export async function fillMissingMeta(limit = 15): Promise<RepairReport | null> {
  const { listTracksForMeta } = await import("./db");
  const ids = (await listTracksForMeta()).filter((t) => t.spotifyDurationS == null).slice(0, limit).map((t) => t.id);
  if (ids.length === 0) return null;
  return repairLibrary({ onlyIds: ids });
}

/** After a fresh download: fix metadata from Spotify and reject audio of the wrong length. */
export async function verifyDownloadedTrack(trackId: number): Promise<void> {
  try {
    let t = await getMusicTrack(trackId);
    if (!t?.spotifyId) return;
    if (t.spotifyDurationS == null) {
      // repairLibrary may requeue a mismatch itself; park it instead.
      await repairLibrary({ onlyIds: [trackId] });
      t = await getMusicTrack(trackId);
    }
    if (!t) return;
    if (t.status === "queued" || durationMismatch(t.durationS, t.spotifyDurationS, t.sizeBytes)) {
      await removeMusicFiles([t.filePath]);
      await updateMusicTrack(trackId, { status: "failed", error: "فایلِ بات با این آهنگ نمی‌خواند (طول متفاوت). بعداً ↻ بزن", filePath: null, mime: null, sizeBytes: null, durationS: null });
    }
  } catch (err) {
    reportWarn("music", `verify track ${trackId} failed:`, err);
  }
}
