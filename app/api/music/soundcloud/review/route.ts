import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { getMusicTrack, getOrigMeta, listScReview, scMetaCounts, setTrackMeta, updateMusicTrack } from "@/lib/db";
import { searchArtists } from "@/lib/music-artists";
import { searchSpotifyTracks } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SoundCloud songs whose real artist could not be settled automatically: the owner fixes them by hand.
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  return NextResponse.json({ counts: await scMetaCounts(), items: await listScReview(60) }, { headers: { "Cache-Control": "no-store" } });
}

// POST { action: "apply" | "keep" | "revert" | "search", trackId?, title?, artist?, q? }
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { action?: string; trackId?: number; title?: string; artist?: string; q?: string };
  const id = Number(b.trackId);
  try {
    if (b.action === "search") {
      const q = String(b.q ?? "").trim().slice(0, 120);
      if (q.length < 2) return NextResponse.json({ artists: [], tracks: [] });
      const [artists, tracks] = await Promise.all([searchArtists(q).catch(() => []), searchSpotifyTracks(q).catch(() => [])]);
      return NextResponse.json({ artists: artists.slice(0, 6).map((a) => ({ name: a.name, followers: a.followers })), tracks: tracks.slice(0, 6).map((t) => ({ title: t.title, artist: t.artist })) });
    }
    if (!Number.isFinite(id)) return NextResponse.json({ error: "trackId required" }, { status: 400 });
    const t = await getMusicTrack(id);
    if (!t || t.source !== "soundcloud") return NextResponse.json({ error: "not a SoundCloud song" }, { status: 404 });
    if (b.action === "apply") {
      const title = String(b.title ?? "").trim().slice(0, 200), artist = String(b.artist ?? "").trim().slice(0, 200);
      if (!title || !artist) return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
      await setTrackMeta(id, { title, artist, state: "manual", suggestions: null });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "keep") { await setTrackMeta(id, { state: "done", suggestions: null }); return NextResponse.json({ ok: true }); }
    if (b.action === "revert") {
      const orig = await getOrigMeta(id);
      if (orig?.title) await updateMusicTrack(id, { title: orig.title, artist: orig.artist ?? undefined });
      await setTrackMeta(id, { state: "review", suggestions: null });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
