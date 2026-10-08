import { NextResponse } from "next/server";
import { allowedTrackIds, musicAccess, notFound } from "@/lib/music-token";
import { analysisProgress } from "@/lib/db";
import { descriptors, vibes } from "@/lib/music-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vibe groups + per-track descriptors (bpm, key, energy, genres) for the player.
export async function GET(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  const [v, d, progress, allowed] = await Promise.all([vibes(), descriptors(), analysisProgress(), allowedTrackIds(access)]);
  // Per link: only its own songs, and only vibes that still have a few of them.
  const scoped = allowed ? v.map((x) => ({ ...x, trackIds: x.trackIds.filter((id) => allowed.has(id)) })).filter((x) => x.trackIds.length >= 3) : v;
  const tracks = Object.fromEntries([...d].filter(([id]) => !allowed || allowed.has(id)));
  return NextResponse.json({ vibes: scoped, tracks, progress });
}
