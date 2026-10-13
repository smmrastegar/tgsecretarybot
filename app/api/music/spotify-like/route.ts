import { NextResponse } from "next/server";
import { accountAllowed, allowedTrackIds, canSpotifyLike, musicAccess, notFound } from "@/lib/music-token";
import { listMusicTracks, listSpotifyAccounts, recordTrackSources } from "@/lib/db";
import { likeOnSpotify } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 200;

// POST { accountId, trackIds } → add those songs to that Spotify account's Liked Songs, and remember they now belong to it.
export async function POST(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  if (!canSpotifyLike(access)) return NextResponse.json({ error: "This link can't add to Spotify likes." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { accountId?: number; trackIds?: unknown };
  const accountId = Number(b.accountId);
  const want = Array.isArray(b.trackIds) ? [...new Set(b.trackIds.map(Number).filter(Number.isFinite))].slice(0, MAX) : [];
  const [all, accounts, allowed] = await Promise.all([listMusicTracks(), listSpotifyAccounts(), allowedTrackIds(access)]);
  if (!accountAllowed(access, accountId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc || want.length === 0) return NextResponse.json({ error: "songs or account not found" }, { status: 404 });
  const byId = new Map(all.map((t) => [t.id, t]));
  const tracks = want.filter((id) => (!allowed || allowed.has(id)) && byId.get(id)?.spotifyId).map((id) => byId.get(id)!);
  if (tracks.length === 0) return NextResponse.json({ error: "songs not found" }, { status: 404 });
  try {
    for (let i = 0; i < tracks.length; i += 50) await likeOnSpotify(accountId, tracks.slice(i, i + 50).map((t) => t.spotifyId!));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "NEEDS_RECONNECT") return NextResponse.json({ error: `"${acc.displayName ?? acc.spotifyUserId}" must be connected again once (dashboard → Music → Spotify) to allow saving songs.`, reconnect: true }, { status: 409 });
    return NextResponse.json({ error: m }, { status: 502 });
  }
  await recordTrackSources(accountId, tracks.map((t) => t.id));
  return NextResponse.json({ ok: true, added: tracks.length });
}
