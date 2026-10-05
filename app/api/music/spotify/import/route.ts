import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { addMusicTrack, createMusicPlaylist, listMusicPlaylists, setPlaylistTrack } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";
import { fetchTrackIds } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { id: "<playlist id>" | "liked", name } — queue every track and
// mirror the list as a library playlist.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { id?: string; name?: string };
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const items = await fetchTrackIds(b.id);
    const name = (b.name ?? (b.id === "liked" ? "لایک‌ها" : "Spotify")).slice(0, 100);
    const existing = (await listMusicPlaylists()).find((p) => p.name === name);
    const plId = existing?.id ?? (await createMusicPlaylist(name));
    let added = 0, already = 0;
    for (const t of items) {
      const r = await addMusicTrack(t.id, `https://open.spotify.com/track/${t.id}`);
      if (r.created) added++; else already++;
      await setPlaylistTrack(plId, r.track.id, true);
    }
    if (added > 0) await kickMusicQueue().catch(() => {});
    return NextResponse.json({ total: items.length, added, already, playlistId: plId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
