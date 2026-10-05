import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { requeueFailedTracks } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const n = await requeueFailedTracks();
  if (n > 0) await kickMusicQueue().catch(() => {});
  return NextResponse.json({ requeued: n });
}
