import { guardTrack } from "@/lib/music-token";
import { serveCover } from "@/lib/music-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rows and tiles ask for small renditions (?w=128|320); the full artwork is only needed in the now-playing screen.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  return serveCover(request, id);
}
