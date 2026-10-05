import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteMusicTrack, updateMusicTrack } from "@/lib/db";
import { kickMusicQueue, removeMusicFiles } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_r: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const gone = await deleteMusicTrack(id);
  if (gone) await removeMusicFiles([gone.filePath, gone.coverPath]);
  return NextResponse.json({ ok: true });
}

// POST = retry a failed track.
export async function POST(_r: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  await updateMusicTrack(id, { status: "queued", error: null });
  await kickMusicQueue().catch(() => {});
  return NextResponse.json({ ok: true });
}
