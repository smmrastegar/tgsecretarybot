import { promises as fs } from "node:fs";
import { authorizeMusic, notFound } from "@/lib/music-token";
import { getMusicTrack } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const t = await getMusicTrack(Number((await ctx.params).id));
  if (!t?.coverPath) return new Response("none", { status: 404 });
  const buf = await fs.readFile(t.coverPath).catch(() => null);
  if (!buf) return new Response("missing", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
