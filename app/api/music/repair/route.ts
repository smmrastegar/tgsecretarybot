import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { kickMusicQueue, repairLibrary } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST: one step (40 tracks) of the library repair; the cron continues it
// automatically, this only speeds it along.
export async function POST(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  try {
    const report = await repairLibrary({ limit: 40 });
    if (report.requeued > 0) await kickMusicQueue().catch(() => {});
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
