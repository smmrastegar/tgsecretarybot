import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { listRemovedTracks, restoreRemovedTrack } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Songs the owner deleted. They are blocked from every way in (sync, import, pasted links) until restored here.
async function owner() {
  const s = await getCurrentSession();
  return s && !s.scope ? s : null;
}

export async function GET(): Promise<NextResponse> {
  if (!(await owner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ removed: await listRemovedTracks() });
}

// POST { spotifyId } → allow it again and queue it for download.
export async function POST(request: Request): Promise<NextResponse> {
  if (!(await owner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { spotifyId?: string };
  if (!b.spotifyId || !/^[A-Za-z0-9]{10,40}$/.test(b.spotifyId)) return NextResponse.json({ error: "spotifyId required" }, { status: 400 });
  const ok = await restoreRemovedTrack(b.spotifyId);
  if (ok) await kickMusicQueue().catch(() => {});
  return NextResponse.json({ ok });
}
