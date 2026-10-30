// Editing the library from the player / dashboard: a new cover for a song, and songs added by uploading a file.
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createManualTrack, getMusicTrack, updateMusicTrack } from "./db";
import { MUSIC_DIR } from "./music";
import { probe } from "./music-intake";
import { guessFromFileName } from "./music-names";
import { attachPendingLyrics } from "./music-lyrics";

export const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", wav: "audio/wav" };
export const MAX_UPLOAD = 120 * 1024 * 1024;

/** Replace a song's cover with this picture (any common format → a square-friendly JPEG). The file name carries a version so caches never show the old one. */
export async function saveCover(trackId: number, image: Uint8Array): Promise<string> {
  const t = await getMusicTrack(trackId);
  if (!t) throw new Error("no such song");
  const jpg = await sharp(image).rotate().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  const dest = path.join(MUSIC_DIR, `${trackId}.cover.${Date.now()}.jpg`);
  await fs.writeFile(dest, jpg);
  const old = (await getMusicTrack(trackId))?.coverPath ?? null;
  await updateMusicTrack(trackId, { coverPath: dest });
  if (old && old !== dest) await fs.unlink(old).catch(() => {});
  for (const w of [128, 320]) await fs.unlink(path.join(MUSIC_DIR, ".thumbs", `${trackId}-${w}.jpg`)).catch(() => {});
  return dest;
}

/** A song uploaded by hand: names from the form (else the file's tags, else its name), cover from the form (else the one inside the file). */
export async function addUploadedSong(file: { data: Uint8Array; name: string }, opts: { title?: string; artist?: string; album?: string; cover?: Uint8Array | null }): Promise<{ id: number; title: string; artist: string }> {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1] ?? "").toLowerCase();
  if (!AUDIO_TYPES[ext]) throw new Error("supported: mp3, m4a, aac, ogg, opus, flac, wav");
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  const tmp = path.join(MUSIC_DIR, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  await fs.writeFile(tmp, file.data);
  try {
    const tags = await probe(tmp);
    const g = guessFromFileName(file.name);
    const title = (opts.title?.trim() || tags.title || g.title || file.name.replace(/\.[a-z0-9]+$/i, "")).slice(0, 200);
    const artist = (opts.artist?.trim() || tags.artist || g.artist || "Unknown").slice(0, 200);
    const id = await createManualTrack({ spotifyId: null, title, artist, album: opts.album?.trim() || tags.album || "Single", releaseDate: tags.date?.slice(0, 10) ?? null, durationS: tags.durationS, filePath: tmp, mime: AUDIO_TYPES[ext]!, sizeBytes: file.data.length });
    const finalPath = path.join(MUSIC_DIR, `${id}.${ext}`);
    await fs.rename(tmp, finalPath);
    await updateMusicTrack(id, { filePath: finalPath });
    if (opts.cover && opts.cover.length > 0) await saveCover(id, opts.cover).catch(() => {});
    else {
      // the picture inside the file, if there is one
      const emb = path.join(MUSIC_DIR, `${id}.cover.${Date.now()}.jpg`);
      const { spawn } = await import("node:child_process");
      const { ffmpegPath } = await import("./music-analysis");
      const ok = await new Promise<boolean>(async (resolve) => {
        const c = spawn(await ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-i", finalPath, "-an", "-frames:v", "1", emb], { stdio: "ignore" });
        const timer = setTimeout(() => c.kill("SIGKILL"), 30_000);
        c.on("close", (code) => { clearTimeout(timer); resolve(code === 0); }); c.on("error", () => { clearTimeout(timer); resolve(false); });
      });
      if (ok && (await fs.stat(emb).then((s) => s.size > 0).catch(() => false))) await updateMusicTrack(id, { coverPath: emb }); else await fs.unlink(emb).catch(() => {});
    }
    await attachPendingLyrics(id, title);
    return { id, title, artist };
  } catch (e) { await fs.unlink(tmp).catch(() => {}); throw e; }
}
