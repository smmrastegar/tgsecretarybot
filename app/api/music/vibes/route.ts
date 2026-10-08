import { NextResponse } from "next/server";
import { authorizeMusic, notFound } from "@/lib/music-token";
import { analysisProgress } from "@/lib/db";
import { descriptors, vibes } from "@/lib/music-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vibe groups + per-track descriptors (bpm, key, energy, genres) for the player.
export async function GET(request: Request): Promise<Response> {
  if (!(await authorizeMusic(request))) return notFound();
  const [v, d, progress] = await Promise.all([vibes(), descriptors(), analysisProgress()]);
  return NextResponse.json({ vibes: v, tracks: Object.fromEntries(d), progress });
}
