import { bumpShareView } from "@/lib/db";
import { shareGate, shareJson, shareTracks } from "@/lib/music-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What a share shows: its title and songs. Nothing else about the library.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const g = await shareGate(request, (await ctx.params).token);
  if ("deny" in g) return g.deny;
  const tracks = await shareTracks(g.share);
  void bumpShareView(g.share.id);
  return shareJson({
    kind: g.share.kind, visibility: g.share.visibility, title: g.share.title,
    tracks: tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, durationS: t.durationS, hasCover: t.hasCover })),
  });
}
