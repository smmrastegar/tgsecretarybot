import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteMusicPlaylist, renameMusicPlaylist, setPlaylistTrack, setPlaylistTracks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// PATCH { name } renames; { trackId, present } or { trackIds, present }
// adds/removes one or many tracks.
export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const b = (await request.json().catch(() => ({}))) as { name?: string; trackId?: number; trackIds?: number[]; present?: boolean };
  if (typeof b.name === "string" && b.name.trim()) {
    await renameMusicPlaylist(id, b.name.trim());
    return NextResponse.json({ ok: true });
  }
  if (Array.isArray(b.trackIds)) {
    const n = await setPlaylistTracks(id, b.trackIds.map(Number), b.present !== false);
    return NextResponse.json({ ok: true, count: n });
  }
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
