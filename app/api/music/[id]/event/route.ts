import { NextResponse } from "next/server";
import { authorizeMusic, notFound } from "@/lib/music-token";
import { recordMusicEvent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { event: "play" | "complete" | "skip" }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const b = (await request.json().catch(() => ({}))) as { event?: string };
  await recordMusicEvent(Number((await ctx.params).id), String(b.event ?? ""));
  return NextResponse.json({ ok: true });
}
