// Uploads are staged first: the file is saved and read (length, tags) but NOT added to the library until the owner confirms —
// after listening to it, or after choosing another file. A song's audio can also be replaced by a better file the same way.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MUSIC_DIR } from "./music";
import { probe } from "./music-intake";
import { AUDIO_TYPES } from "./music-edit";

const DIR = path.join(MUSIC_DIR, "staged");
export type Staged = { token: string; name: string; ext: string; sizeBytes: number; durationS: number | null; tags: { title: string | null; artist: string | null; album: string | null } };

const valid = (t: string) => /^[a-f0-9]{24}$/.test(t);
const filePath = (token: string, ext: string) => path.join(DIR, `${token}.${ext}`);

export async function stageFile(file: { data: Uint8Array; name: string }): Promise<Staged> {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1] ?? "").toLowerCase();
  if (!AUDIO_TYPES[ext]) throw new Error("supported: mp3, m4a, aac, ogg, opus, flac, wav");
  await fs.mkdir(DIR, { recursive: true });
  // staged files nobody confirmed within a day are removed
  for (const f of await fs.readdir(DIR).catch(() => [] as string[])) {
    const p = path.join(DIR, f);
    if (Date.now() - (await fs.stat(p).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 24 * 3600_000) await fs.unlink(p).catch(() => {});
  }
  const token = randomBytes(12).toString("hex");
  const p = filePath(token, ext);
  await fs.writeFile(p, file.data);
  const tags = await probe(p);
  const meta: Staged = { token, name: file.name, ext, sizeBytes: file.data.length, durationS: tags.durationS, tags: { title: tags.title, artist: tags.artist, album: tags.album } };
  await fs.writeFile(path.join(DIR, `${token}.json`), JSON.stringify(meta));
  return meta;
}

export async function getStaged(token: string): Promise<(Staged & { path: string }) | null> {
  if (!valid(token)) return null;
  try {
    const meta = JSON.parse(await fs.readFile(path.join(DIR, `${token}.json`), "utf8")) as Staged;
    const p = filePath(token, meta.ext);
    await fs.stat(p);
    return { ...meta, path: p };
  } catch { return null; }
}

export async function discardStaged(token: string): Promise<void> {
  const s = await getStaged(token);
  if (s) await fs.unlink(s.path).catch(() => {});
  if (valid(token)) await fs.unlink(path.join(DIR, `${token}.json`)).catch(() => {});
}
