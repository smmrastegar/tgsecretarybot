import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { getMusicTrack } from "./db";
import { MUSIC_DIR } from "./music";

/** The audio file with HTTP Range support. The caller has already decided the viewer may have this song. */
export async function serveStream(request: Request, id: number): Promise<Response> {
  const t = await getMusicTrack(id);
  if (!t?.filePath) return new Response("not found", { status: 404 });
  const st = await fs.stat(t.filePath).catch(() => null);
  if (!st) return new Response("missing", { status: 404 });
  const size = st.size;
  const headers: Record<string, string> = {
    "Content-Type": t.mime ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (m) {
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : size - 1;
    if (!m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    end = Math.min(end, size - 1);
    const stream = Readable.toWeb(createReadStream(t.filePath, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(t.filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

// Rows and tiles ask for small renditions (?w=128|320); the full artwork is
// only needed in the now-playing screen. Resized files are cached on disk,
// so the list view no longer pulls ~90 KB per 52 px thumbnail.
const SIZES = [128, 320];
const HEADERS = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800" };

/** The cover (?w=128|320 for thumbnails). The caller has already decided the viewer may have this song. */
export async function serveCover(request: Request, id: number): Promise<Response> {
  const t = await getMusicTrack(id);
  if (!t?.coverPath) return new Response("none", { status: 404 });
  const w = Number(new URL(request.url).searchParams.get("w"));
  if (SIZES.includes(w)) {
    const cached = path.join(MUSIC_DIR, ".thumbs", `${id}-${w}.jpg`);
    const hit = await fs.readFile(cached).catch(() => null);
    if (hit) return new Response(new Uint8Array(hit), { headers: HEADERS });
    const src = await fs.readFile(t.coverPath).catch(() => null);
    if (!src) return new Response("missing", { status: 404 });
    try {
      const out = await sharp(src).resize(w, w, { fit: "cover" }).jpeg({ quality: 76, mozjpeg: true }).toBuffer();
      await fs.mkdir(path.dirname(cached), { recursive: true });
      await fs.writeFile(cached, out).catch(() => {});
      return new Response(new Uint8Array(out), { headers: HEADERS });
    } catch {
      return new Response(new Uint8Array(src), { headers: HEADERS }); // unreadable image: serve as is
    }
  }
  const buf = await fs.readFile(t.coverPath).catch(() => null);
  if (!buf) return new Response("missing", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: HEADERS });
}
