import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { addMusicTrack, listMusicPlaylists, listMusicTracks, parseSpotifyTrackUrl } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const [tracks, playlists] = await Promise.all([listMusicTracks(), listMusicPlaylists()]);
  return NextResponse.json({ tracks, playlists });
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
