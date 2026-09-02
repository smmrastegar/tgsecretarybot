import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listNoteWatchMatches } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const itemRaw = url.searchParams.get("itemId");
  const itemId = itemRaw ? Number(itemRaw) : undefined;
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "50"), 1),
    200,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const matches = await listNoteWatchMatches({
    itemId: Number.isFinite(itemId) ? itemId : undefined,
    limit,
    offset,
  });
  return NextResponse.json({ matches });
}
