import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { authorizeMusic, notFound } from "@/lib/music-token";
import { getMusicTrack } from "@/lib/db";
import { MUSIC_DIR } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rows and tiles ask for small renditions (?w=128|320); the full artwork is
// only needed in the now-playing screen. Resized files are cached on disk,
// so the list view no longer pulls ~90 KB per 52 px thumbnail.
const SIZES = [128, 320];
const HEADERS = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800" };

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const id = Number((await ctx.params).id);
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
