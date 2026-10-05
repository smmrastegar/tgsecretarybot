import { NextResponse } from "next/server";
import { authorizeMusic, notFound } from "@/lib/music-token";
import { rateMusicTrack } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { rating: -1 | 0 | 1 }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const b = (await request.json().catch(() => ({}))) as { rating?: number };
  await rateMusicTrack(Number((await ctx.params).id), Number(b.rating ?? 0));
  return NextResponse.json({ ok: true });
}
