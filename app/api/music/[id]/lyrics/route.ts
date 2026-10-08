import { NextResponse } from "next/server";
import { guardTrack } from "@/lib/music-token";
import { getAllSettings, getMusicTrack, setSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Lyrics = { synced: string | null; plain: string | null; found: boolean };

// Lyrics come from LRCLIB (free, keyless). Results, including misses, are
// cached in settings so each track is looked up at most once.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const key = `lyrics.${id}`;
  const cached = (await getAllSettings())[key];
  if (cached) { try { return NextResponse.json(JSON.parse(cached) as Lyrics); } catch { /* refetch */ } }
  const t = await getMusicTrack(id);
  if (!t?.title) return NextResponse.json({ synced: null, plain: null, found: false } satisfies Lyrics);
  const artist = (t.artist ?? "").split(/,\s*/)[0] ?? "";
  const qs = new URLSearchParams({ track_name: t.title, artist_name: artist });
  if (t.durationS) qs.set("duration", String(Math.round(t.durationS)));
  let out: Lyrics = { synced: null, plain: null, found: false };
  try {
    const r = await fetch(`https://lrclib.net/api/get?${qs}`, { headers: { "User-Agent": "tgsecretarybot-personal-player" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = (await r.json()) as { syncedLyrics?: string | null; plainLyrics?: string | null };
      out = { synced: j.syncedLyrics ?? null, plain: j.plainLyrics ?? null, found: !!(j.syncedLyrics || j.plainLyrics) };
    } else if (r.status !== 404) {
      return NextResponse.json(out); // transient: don't cache
    }
  } catch { return NextResponse.json(out); }
  await setSetting(key, JSON.stringify(out));
  return NextResponse.json(out);
}
