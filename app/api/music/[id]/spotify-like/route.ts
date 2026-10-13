import { NextResponse } from "next/server";
import { canSpotifyLike, guardTrack } from "@/lib/music-token";
import { getMusicTrack, listSpotifyAccounts, recordTrackSources } from "@/lib/db";
import { likeOnSpotify } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { accountId } → add this song to that Spotify account's Liked Songs, and remember the song now belongs to it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  if (!canSpotifyLike(g.access)) return NextResponse.json({ error: "This link can't add to Spotify likes." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { accountId?: number };
  const accountId = Number(b.accountId);
  const [t, accounts] = await Promise.all([getMusicTrack(id), listSpotifyAccounts()]);
  const acc = accounts.find((a) => a.id === accountId);
  if (!t?.spotifyId || !acc) return NextResponse.json({ error: "song or account not found" }, { status: 404 });
  try {
    await likeOnSpotify(accountId, [t.spotifyId]);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "NEEDS_RECONNECT") return NextResponse.json({ error: `"${acc.displayName ?? acc.spotifyUserId}" must be connected again once (dashboard → Music → Spotify) to allow saving songs.`, reconnect: true }, { status: 409 });
    return NextResponse.json({ error: m }, { status: 502 });
  }
  await recordTrackSources(accountId, [id]);
  return NextResponse.json({ ok: true });
}
