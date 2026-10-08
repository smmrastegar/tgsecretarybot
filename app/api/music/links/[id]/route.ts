import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { updatePlayerLink } from "@/lib/db";
import { setLegacyActive } from "@/lib/music-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { name?, active?, playlistIds? }. Links are switched on/off, never deleted.
// id 0 is the original Main link: only its on/off switch can change.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const b = (await request.json().catch(() => ({}))) as { name?: string; active?: boolean; playlistIds?: number[]; canCreate?: boolean };
  if (id === 0) {
    if (typeof b.active === "boolean") await setLegacyActive(b.active);
    return NextResponse.json({ ok: true });
  }
  await updatePlayerLink(id, {
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined,
    active: typeof b.active === "boolean" ? b.active : undefined,
    playlistIds: Array.isArray(b.playlistIds) ? b.playlistIds.map(Number) : undefined,
    canCreate: typeof b.canCreate === "boolean" ? b.canCreate : undefined,
  });
  return NextResponse.json({ ok: true });
}
