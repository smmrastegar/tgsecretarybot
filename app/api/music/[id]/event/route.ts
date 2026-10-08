import { NextResponse } from "next/server";
import { guardTrack } from "@/lib/music-token";
import { recordListen } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { seconds, duration, completed } — one listening session.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const b = (await request.json().catch(() => ({}))) as { seconds?: number; duration?: number; completed?: boolean };
  await recordListen(id, Number(b.seconds ?? 0) || 0, Number(b.duration ?? 0) || 0, b.completed === true);
  return NextResponse.json({ ok: true });
}
