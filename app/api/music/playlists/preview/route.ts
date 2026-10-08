import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listMusicTracks } from "@/lib/db";
import { resolveRules, sanitizeRules } from "@/lib/music-playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { rules } → how many songs a smart-playlist rule set selects right now (+ a few titles).
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { rules?: unknown };
  const tracks = await listMusicTracks();
  const ids = await resolveRules(sanitizeRules(b.rules), tracks);
  const by = new Map(tracks.map((t) => [t.id, t]));
  return NextResponse.json({ count: ids.length, sample: ids.slice(0, 6).map((id) => `${by.get(id)?.title ?? "?"} — ${by.get(id)?.artist ?? ""}`) });
}
