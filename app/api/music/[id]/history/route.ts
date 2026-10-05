import { authorizeMusic, notFound } from "@/lib/music-token";
import { getTrackHistory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) return notFound();
  return Response.json(await getTrackHistory(id), { headers: { "Cache-Control": "no-store" } });
}
