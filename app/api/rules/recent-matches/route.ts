import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listRecentRuleMatches } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const matches = await listRecentRuleMatches({
    limit: Number.isFinite(limit) ? limit : 10,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return NextResponse.json({ matches });
}
