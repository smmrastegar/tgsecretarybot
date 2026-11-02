import { notFound } from "@/lib/music-token";
import { shareAllows, shareGate } from "@/lib/music-share";
import { serveStream } from "@/lib/music-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The audio of one song of a share — and only songs that are in it.
export async function GET(request: Request, ctx: { params: Promise<{ token: string; id: string }> }): Promise<Response> {
  const { token, id } = await ctx.params;
  const g = await shareGate(request, token);
  if ("deny" in g) return g.deny;
  const n = Number(id);
  if (!(await shareAllows(g.share, n))) return notFound();
  return serveStream(request, n);
}
