import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listMetricsSnapshots } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  const snapshots = await listMetricsSnapshots(Number.isFinite(days) ? days : 30);
  return NextResponse.json({ snapshots });
}
