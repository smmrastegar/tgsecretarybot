import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { allowedTrackIds, musicAccess, notFound } from "@/lib/music-token";
import { resolvedPlaylists } from "@/lib/music-playlists";
import { addMusicTrack, listMusicTracks, parseSpotifyTrackUrl } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";
import { reportError } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  try {
    const all = await listMusicTracks();
    const [pls, allowed] = await Promise.all([resolvedPlaylists(all), allowedTrackIds(access)]);
    // A player link only ever sees its own playlists and the songs in them.
    const tracks = allowed ? all.filter((t) => allowed.has(t.id)) : all;
    const lists = access.kind === "link" && access.playlistIds ? pls.filter((p) => access.playlistIds!.includes(p.id)) : pls;
    const playlists = lists.map((p) => ({ id: p.id, name: p.name, trackIds: allowed ? p.trackIds.filter((id) => allowed.has(id)) : p.trackIds, smart: p.smart, ...(access.kind === "session" ? { rules: p.rules } : {}) }));
    return NextResponse.json({ tracks, playlists });
  } catch (err) {
    reportError("music", "list failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// POST { text }: any text containing Spotify track links (one or many).
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const links = [...new Set((String(body.text ?? "").match(/https?:\/\/open\.spotify\.com\/\S+/g) ?? []))];
  let added = 0, existing = 0, unsupported = 0;
  for (const l of links.slice(0, 100)) {
    const p = parseSpotifyTrackUrl(l);
    if (!p) { unsupported++; continue; }
    const r = await addMusicTrack(p.id, p.url);
    if (r.created) added++; else existing++;
  }
  if (added > 0) await kickMusicQueue().catch(() => {});
  return NextResponse.json({ added, existing, unsupported });
}
