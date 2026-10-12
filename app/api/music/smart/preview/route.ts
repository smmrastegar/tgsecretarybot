import { NextResponse } from "next/server";
import { listMusicTracks } from "@/lib/db";
import { allowedTrackIds, guardTrack, musicAccess, notFound } from "@/lib/music-token";
import { resolveRules, sanitizeRules } from "@/lib/music-playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { rules } from a player link: how many songs a "more like this song" rule set picks right now.
// The rules must be seeded on a song this link can see.
export async function POST(request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { rules?: unknown };
  const rules = sanitizeRules(b.rules);
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
  const allowed = await allowedTrackIds(access);
  const tracks = (await listMusicTracks()).filter((t) => !allowed || allowed.has(t.id));
  const ids = await resolveRules(rules, tracks);
  const by = new Map(tracks.map((t) => [t.id, t]));
  return NextResponse.json({ count: ids.length, sample: ids.slice(0, 5).map((id) => `${by.get(id)?.title ?? "?"} — ${by.get(id)?.artist ?? ""}`) });
}
