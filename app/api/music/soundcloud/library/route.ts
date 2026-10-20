import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { ScRateLimited, scPlaylists } from "@/lib/soundcloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?account=<id> → that account's playlists (its likes are always importable).
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  try {
    return NextResponse.json({ playlists: await scPlaylists(Number(new URL(request.url).searchParams.get("account"))) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ScRateLimited ? "SoundCloud is limiting requests; try again in a minute" : e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
