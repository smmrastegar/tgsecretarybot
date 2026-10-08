import { NextResponse } from "next/server";
import { allowedTrackIds, guardTrack } from "@/lib/music-token";
import { listMusicTracks } from "@/lib/db";
import { radioFrom, similarTo } from "@/lib/music-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?mode=radio|similar&n=40 — songs that sound like this one. `radio` is an
// ordered, smooth queue starting with the song itself; `similar` is the plain top-N.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const url = new URL(request.url);
  const n = Math.min(100, Math.max(5, Number(url.searchParams.get("n") ?? 40) || 40));
  const allowed = await allowedTrackIds(g.access);
  if (url.searchParams.get("mode") === "similar") return NextResponse.json({ ids: (await similarTo(id, n, new Set(), allowed)).map((s) => s.id) });
  const artist = new Map((await listMusicTracks()).map((t) => [t.id, (t.artist ?? "").split(/,\s*/)[0] ?? ""]));
  const q = await radioFrom(id, n, (x) => artist.get(x) ?? "", allowed);
  return NextResponse.json({ ids: q.map((s) => s.id), analysed: q.length > 0 });
}
