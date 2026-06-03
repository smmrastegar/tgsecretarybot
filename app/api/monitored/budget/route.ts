import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getHikerSpentBuckets,
  listRecentHikerCalls,
} from "@/lib/db";
import { getBudgetState } from "@/lib/hikerapi-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const state = await getBudgetState();
  const now = Date.now();
  const [hourly, daily, recent] = await Promise.all([
    getHikerSpentBuckets({
      bucket: "hour",
      since: new Date(now - 24 * 60 * 60 * 1000),
    }),
    getHikerSpentBuckets({
      bucket: "day",
      since: new Date(now - 14 * 24 * 60 * 60 * 1000),
    }),
    listRecentHikerCalls(20),
  ]);
  return NextResponse.json({
    ok: true,
    state,
    hourly: hourly.map((b) => ({
      at: b.at,
      calls: b.calls,
      costUsd: b.costUsd,
    })),
    daily: daily.map((b) => ({
      at: b.at,
      calls: b.calls,
      costUsd: b.costUsd,
    })),
    recent,
  });
}
