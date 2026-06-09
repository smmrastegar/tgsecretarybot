import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listRecentRuleMatches } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const matches = await listRecentRuleMatches(
    Number.isFinite(limit) ? limit : 50,
  );
  return NextResponse.json({ matches });
}
