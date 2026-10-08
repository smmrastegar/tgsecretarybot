import { guardTrack } from "@/lib/music-token";
import { getTrackHistory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  return Response.json(await getTrackHistory(id, g.access.kind === "link" ? g.access.linkId : undefined), { headers: { "Cache-Control": "no-store" } });
}
