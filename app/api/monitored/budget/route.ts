import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getHikerSpentBuckets,
  getHikerWindowSummary,
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
  const now = new Date();
  // Precise sliding windows (since N ago) — these are what the
  // owner reads in the dialog as "exactly how much I'm spending
  // per hour / day / week / month right now".
  const sinceHour = new Date(now.getTime() - 60 * 60 * 1000);
  const sinceDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sinceWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Calendar-aligned buckets for the histograms.
  const sinceHourly = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sinceDaily = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sinceWeekly = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
  const sinceMonthly = new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000);
  const [
    lastHour,
    today,
    last7d,
    last30d,
    allTime,
    hourly,
    daily,
    weekly,
    monthly,
    recent,
  ] = await Promise.all([
    getHikerWindowSummary(sinceHour),
    getHikerWindowSummary(sinceDay),
    getHikerWindowSummary(sinceWeek),
    getHikerWindowSummary(sinceMonth),
    getHikerWindowSummary(null),
    getHikerSpentBuckets({ bucket: "hour", since: sinceHourly }),
    getHikerSpentBuckets({ bucket: "day", since: sinceDaily }),
    getHikerSpentBuckets({ bucket: "week", since: sinceWeekly }),
    getHikerSpentBuckets({ bucket: "month", since: sinceMonthly }),
    listRecentHikerCalls(30),
  ]);
  return NextResponse.json({
    ok: true,
    state,
    summary: { lastHour, today, last7d, last30d, allTime },
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
    weekly: weekly.map((b) => ({
      at: b.at,
      calls: b.calls,
      costUsd: b.costUsd,
    })),
    monthly: monthly.map((b) => ({
      at: b.at,
      calls: b.calls,
      costUsd: b.costUsd,
    })),
    recent,
  });
}
