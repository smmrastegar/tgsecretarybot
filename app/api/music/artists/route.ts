import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { listMusicArtists, unfollowMusicArtist } from "@/lib/db";
import { artistWatchStep, checkArtist, followAndCheck, searchArtists } from "@/lib/music-artists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Followed artists (dashboard owner only). GET → list; POST {action: search|follow|check}; DELETE ?id= → unfollow
// (the songs and the playlist stay).
async function owner() {
  const s = await getCurrentSession();
  return s && !s.scope ? s : null;
}
const no = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

export async function GET(): Promise<NextResponse> {
  if (!(await owner())) return no();
  return NextResponse.json({ artists: await listMusicArtists() });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await owner())) return no();
  const b = (await request.json().catch(() => ({}))) as { action?: string; q?: string; id?: string; name?: string; imageUrl?: string | null; all?: boolean; artistId?: number };
  try {
    if (b.action === "search") {
      if (!b.q?.trim()) return NextResponse.json({ results: [] });
      return NextResponse.json({ results: await searchArtists(b.q.trim()) });
    }
    if (b.action === "follow") {
      if (!b.id || !/^[A-Za-z0-9]{10,40}$/.test(b.id) || !b.name) return NextResponse.json({ error: "id and name required" }, { status: 400 });
      const r = await followAndCheck({ id: b.id, name: b.name, imageUrl: b.imageUrl ?? null }, b.all !== false);
      return NextResponse.json({ ...r, ok: !r.error });
    }
    if (b.action === "check") {
      if (b.artistId != null) {
        const a = (await listMusicArtists()).find((x) => x.id === b.artistId);
        if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
        return NextResponse.json(await checkArtist(a, true));
      }
      return NextResponse.json(await artistWatchStep(true));
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!(await owner())) return no();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  await unfollowMusicArtist(id);
  return NextResponse.json({ ok: true });
}
