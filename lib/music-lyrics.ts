// Lyrics put in by hand: plain text typed/pasted by the owner, and/or a picture of the lyrics page (a booklet's handwritten page).
// Stored where the automatic LRCLIB result is cached (settings "lyrics.<id>"), so the player reads both the same way.
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getAllSettings, setSetting } from "./db";
import { MUSIC_DIR } from "./music";

export type StoredLyrics = { synced: string | null; plain: string | null; found: boolean; image?: boolean; manual?: boolean };
const DIR = path.join(MUSIC_DIR, "lyrics");
const PENDING = path.join(MUSIC_DIR, "lyrics-pending");
export const lyricsImagePath = (id: number) => path.join(DIR, `${id}.jpg`);

/** "Mitaravad Mahtab" / "Mitaravad-Mahtab" → "mitaravadmahtab": the same song however its name is spaced or cased. */
export const titleKey = (title: string): string => title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

async function toJpeg(image: Uint8Array): Promise<Buffer> {
  return sharp(image).rotate().resize(1800, 3600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

/** Save text and/or a picture as this song's lyrics. `text` "" removes the typed text; an image replaces the picture. */
export async function setManualLyrics(id: number, input: { text?: string | null; image?: Uint8Array | null }): Promise<StoredLyrics> {
  const prev = (await readStored(id)) ?? { synced: null, plain: null, found: false };
  let image = prev.image === true;
  if (input.image && input.image.length > 0) {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(lyricsImagePath(id), await toJpeg(input.image));
    image = true;
  }
  const plain = input.text === undefined ? (prev.manual ? prev.plain : null) : (input.text?.trim() ? input.text.trim().slice(0, 20000) : null);
  const out: StoredLyrics = { synced: null, plain, found: !!(plain || image), image, manual: true };
  await setSetting(`lyrics.${id}`, JSON.stringify(out));
  return out;
}

async function readStored(id: number): Promise<StoredLyrics | null> {
  const raw = (await getAllSettings())[`lyrics.${id}`];
  if (!raw) return null;
  try { return JSON.parse(raw) as StoredLyrics; } catch { return null; }
}

/** A lyrics picture for a song that is not in the library yet (an album booklet, uploaded before the songs): kept by title. */
export async function savePendingLyricsImage(title: string, image: Uint8Array): Promise<string> {
  const key = titleKey(title);
  if (!key) throw new Error("title required");
  await fs.mkdir(PENDING, { recursive: true });
  await fs.writeFile(path.join(PENDING, `${key}.jpg`), await toJpeg(image));
  return key;
}

/** When a song with this title is added, give it the lyrics picture waiting for that title. Never throws. */
export async function attachPendingLyrics(trackId: number, title: string): Promise<boolean> {
  try {
    const file = path.join(PENDING, `${titleKey(title)}.jpg`);
    const data = await fs.readFile(file).catch(() => null);
    if (!data) return false;
    await setManualLyrics(trackId, { image: data });
    await fs.unlink(file).catch(() => {});
    return true;
  } catch { return false; }
}
