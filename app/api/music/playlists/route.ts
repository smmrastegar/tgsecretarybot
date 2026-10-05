import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { createMusicPlaylist } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { name?: string };
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  return NextResponse.json({ id: await createMusicPlaylist(name) });
}
