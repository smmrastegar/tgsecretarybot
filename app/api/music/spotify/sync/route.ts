import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { runSync } from "@/lib/music-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST: re-read every imported Spotify list now and queue what is new.
export async function POST(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  try { return NextResponse.json(await runSync()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
