import { promises as fs } from "node:fs";
import { guardTrack } from "@/lib/music-token";
import { lyricsImagePath } from "@/lib/music-lyrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The picture of a song's lyrics page (when one was added by hand).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const buf = await fs.readFile(lyricsImagePath(id)).catch(() => null);
  if (!buf) return new Response("none", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
