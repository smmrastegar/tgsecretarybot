import { NextResponse } from "next/server";
import { guardTrack } from "@/lib/music-token";
import { rateMusicTrack } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { rating: -1 | 0 | 1 }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const b = (await request.json().catch(() => ({}))) as { rating?: number };
  // Player links keep their own likes; Main link and dashboard share the global rating.
  await rateMusicTrack(id, Number(b.rating ?? 0), g.access.kind === "link" ? g.access.linkId : 0);
  return NextResponse.json({ ok: true });
}
