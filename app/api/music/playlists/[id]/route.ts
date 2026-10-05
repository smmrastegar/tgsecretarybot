import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteMusicPlaylist, setPlaylistTrack } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// PATCH { trackId, present } — add/remove a track.
export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const b = (await request.json().catch(() => ({}))) as { trackId?: number; present?: boolean };
  if (!Number.isFinite(Number(b.trackId))) return NextResponse.json({ error: "trackId required" }, { status: 400 });
  await setPlaylistTrack(id, Number(b.trackId), b.present !== false);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_r: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  await deleteMusicPlaylist(Number((await ctx.params).id));
  return NextResponse.json({ ok: true });
}
