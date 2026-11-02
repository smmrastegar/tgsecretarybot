import { guardTrack } from "@/lib/music-token";
import { serveStream } from "@/lib/music-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Audio with HTTP Range support (seeking, iOS/Safari need it).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  return serveStream(request, id);
}
