import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  aiUsageByDay,
  aiUsageByModel,
  aiUsageByPurpose,
  aiUsageOverview,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const daysBack = Math.min(
    Math.max(Number(url.searchParams.get("days") ?? "30"), 1),
    365,
  );
  const [overview, byPurpose, byModel, byDay] = await Promise.all([
    aiUsageOverview().catch(() => null),
    aiUsageByPurpose(daysBack).catch(() => []),
    aiUsageByModel(daysBack).catch(() => []),
    aiUsageByDay(Math.min(daysBack, 30)).catch(() => []),
  ]);
  return NextResponse.json({ overview, byPurpose, byModel, byDay, daysBack });
}
