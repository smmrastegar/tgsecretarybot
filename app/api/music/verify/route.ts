import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { acceptVerify, listVerify, verifyCounts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard: result of the content check (counts + the suspicious files).
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  return NextResponse.json({ counts: await verifyCounts(), suspicious: await listVerify(["mismatch", "unsure"]) });
}

// POST { trackId, action: "accept" }: "I listened, it is fine" — the song leaves the suspicious list.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { trackId?: number; action?: string };
  const id = Number(b.trackId);
  if (b.action !== "accept" || !Number.isFinite(id)) return NextResponse.json({ error: "trackId and action required" }, { status: 400 });
  await acceptVerify(id);
  return NextResponse.json({ ok: true });
}
