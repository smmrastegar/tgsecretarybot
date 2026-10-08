import { NextResponse } from "next/server";
import { authorizeMusic, notFound } from "@/lib/music-token";
import { listMusicTracks } from "@/lib/db";
import { radioFrom, similarTo } from "@/lib/music-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?mode=radio|similar&n=40 — songs that sound like this one. `radio` is an
// ordered, smooth queue starting with the song itself; `similar` is the plain top-N.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const id = Number((await ctx.params).id);
  const url = new URL(request.url);
  const n = Math.min(100, Math.max(5, Number(url.searchParams.get("n") ?? 40) || 40));
  if (url.searchParams.get("mode") === "similar") return NextResponse.json({ ids: (await similarTo(id, n)).map((s) => s.id) });
  const artist = new Map((await listMusicTracks()).map((t) => [t.id, (t.artist ?? "").split(/,\s*/)[0] ?? ""]));
  const q = await radioFrom(id, n, (x) => artist.get(x) ?? "");
  return NextResponse.json({ ids: q.map((s) => s.id), analysed: q.length > 0 });
}
