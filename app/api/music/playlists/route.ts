import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { createMusicPlaylist } from "@/lib/db";
import { sanitizeRules } from "@/lib/music-playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { name?: string; rules?: unknown };
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  // `rules` makes it a smart playlist: its songs are computed from the rules each time.
  const rules = b.rules ? sanitizeRules(b.rules) : null;
  return NextResponse.json({ id: await createMusicPlaylist(name, rules && Object.keys(rules).length ? (rules as Record<string, unknown>) : null) });
}
