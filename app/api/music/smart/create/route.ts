import { NextResponse } from "next/server";
import { addPlaylistToLink, createMusicPlaylist, listMusicPlaylists } from "@/lib/db";
import { guardTrack, musicAccess, notFound } from "@/lib/music-token";
import { sanitizeRules } from "@/lib/music-playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_LINK = 30;

// POST { name, rules } from a player link: build a smart playlist "more like <song>" and
// give it to THIS link only. Needs a seed song the link can see; the link must be allowed to
// (dashboard switch), and is capped at 30 playlists.
export async function POST(request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { name?: string; rules?: unknown };
  const rules = sanitizeRules(b.rules);
  // Two kinds: "more like <seed song>", or "songs from these Spotify accounts" (no seed; any / all of them).
  let access;
  if (rules.seed) {
    const g = await guardTrack(request, rules.seed.trackId);
    if ("deny" in g) return g.deny;
    access = g.access;
  } else if (rules.accounts?.length) {
    access = await musicAccess(request);
    if (!access) return notFound();
  } else {
    return NextResponse.json({ error: "seed song or accounts required" }, { status: 400 });
  }
  if (access.kind !== "link") return NextResponse.json({ error: "use the dashboard" }, { status: 400 });
  if (!access.canCreate) return NextResponse.json({ error: "This link can't create playlists." }, { status: 403 });
  const name = String(b.name ?? "").trim().slice(0, 80) || (rules.seed ? "More like this" : "From accounts");
  if (access.linkId > 0) {
    const mine = new Set(access.playlistIds ?? []);
    const count = (await listMusicPlaylists()).filter((p) => mine.has(p.id) && p.rules).length;
    if (count >= MAX_PER_LINK) return NextResponse.json({ error: `Limit of ${MAX_PER_LINK} smart playlists reached.` }, { status: 409 });
  }
  const id = await createMusicPlaylist(name, rules as Record<string, unknown>);
  if (access.linkId > 0) await addPlaylistToLink(access.linkId, id);
  return NextResponse.json({ ok: true, id });
}
