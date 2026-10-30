import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { setSetting, updatePlayerLink } from "@/lib/db";
import { setLegacyActive, setMainCanEdit, setMainCanLike, setMainScope } from "@/lib/music-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { name?, active?, playlistIds?, accountIds?, accountsMode? }. Links are switched on/off, never deleted.
// id 0 is the original Main link: only its on/off switch and account scope can change.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const id = Number((await ctx.params).id);
  const b = (await request.json().catch(() => ({}))) as { name?: string; active?: boolean; playlistIds?: number[]; canCreate?: boolean; accountIds?: number[]; accountsMode?: "any" | "all"; canLikeSpotify?: boolean; canEdit?: boolean; allLibrary?: boolean; tgSignup?: boolean };
  const ids = Array.isArray(b.accountIds) ? b.accountIds.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : undefined;
  if (id === 0) {
    if (typeof b.active === "boolean") await setLegacyActive(b.active);
    if (typeof b.canLikeSpotify === "boolean") await setMainCanLike(b.canLikeSpotify);
    if (typeof b.canEdit === "boolean") await setMainCanEdit(b.canEdit);
    if (typeof b.tgSignup === "boolean") await setSetting("musicTgSignup", b.tgSignup ? "1" : "0");
    if (ids) await setMainScope(ids.length ? { ids, mode: b.accountsMode === "all" ? "all" : "any" } : null);
    return NextResponse.json({ ok: true });
  }
  await updatePlayerLink(id, {
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined,
    active: typeof b.active === "boolean" ? b.active : undefined,
    playlistIds: Array.isArray(b.playlistIds) ? b.playlistIds.map(Number) : undefined,
    canCreate: typeof b.canCreate === "boolean" ? b.canCreate : undefined,
    canLikeSpotify: typeof b.canLikeSpotify === "boolean" ? b.canLikeSpotify : undefined,
    canEdit: typeof b.canEdit === "boolean" ? b.canEdit : undefined,
    allLibrary: typeof b.allLibrary === "boolean" ? b.allLibrary : undefined,
    accountIds: ids,
    accountsMode: b.accountsMode === "all" || b.accountsMode === "any" ? b.accountsMode : undefined,
  });
  return NextResponse.json({ ok: true });
}
