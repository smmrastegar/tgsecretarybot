import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listMyPlaylists } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  try {
    return NextResponse.json(await listMyPlaylists());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
