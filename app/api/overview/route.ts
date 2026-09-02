import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { aiUsageOverview, listMessages, overviewStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const [stats, latestUrgent, latestAll, ai] = await Promise.all([
    overviewStats(),
    listMessages({ urgentOnly: true, limit: 5 }),
    listMessages({ limit: 8 }),
    aiUsageOverview(),
  ]);
  return NextResponse.json({ stats, latestUrgent, latestAll, ai });
}
