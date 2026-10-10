import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { addMusicTrack, ensureSpotifyPlaylist, setPlaylistTrack } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";
import { registerSyncSource } from "@/lib/music-sync";
import { fetchTrackIds, listSpotifyAccounts } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { id: "<playlist id>" | "liked", name } — queue every track and
// mirror the list as a library playlist.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { id?: string; name?: string; accountId?: number };
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const items = await fetchTrackIds(Number(b.accountId), b.id);
    const name = (b.name ?? (b.id === "liked" ? "لایک‌ها" : "Spotify")).slice(0, 100);
    const acct = (await listSpotifyAccounts()).find((a) => a.id === Number(b.accountId));
    const plId = await ensureSpotifyPlaylist(Number(b.accountId), b.id, name, acct?.displayName ?? acct?.spotifyUserId ?? `#${b.accountId}`);
    let added = 0, already = 0, skipped = 0;
    for (const t of items) {
      const r = await addMusicTrack(t.id, `https://open.spotify.com/track/${t.id}`);
      if (r.removed) { skipped++; continue; }
      if (r.created) added++; else already++;
      if (r.track) await setPlaylistTrack(plId, r.track.id, true);
    }
    await registerSyncSource({ accountId: Number(b.accountId), id: b.id, name }).catch(() => {});
    if (added > 0) await kickMusicQueue().catch(() => {});
    return NextResponse.json({ total: items.length, added, already, skipped, playlistId: plId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
