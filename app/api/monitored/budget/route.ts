import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getHikerSpentBuckets,
  getHikerWindowSummary,
  listRecentHikerCalls,
} from "@/lib/db";
import { getBudgetState } from "@/lib/hikerapi-budget";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  const state = await getBudgetState(tenant.id);
  const now = new Date();
  const sinceHour = new Date(now.getTime() - 60 * 60 * 1000);
  const sinceDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sinceWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
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
    getHikerWindowSummary(sinceHour, tenant.id),
    getHikerWindowSummary(sinceDay, tenant.id),
    getHikerWindowSummary(sinceWeek, tenant.id),
    getHikerWindowSummary(sinceMonth, tenant.id),
    getHikerWindowSummary(null, tenant.id),
    getHikerSpentBuckets({ bucket: "hour", since: sinceHourly, tenantId: tenant.id }),
    getHikerSpentBuckets({ bucket: "day", since: sinceDaily, tenantId: tenant.id }),
    getHikerSpentBuckets({ bucket: "week", since: sinceWeekly, tenantId: tenant.id }),
    getHikerSpentBuckets({ bucket: "month", since: sinceMonthly, tenantId: tenant.id }),
    listRecentHikerCalls(30, tenant.id),
  ]);
  return NextResponse.json({
    ok: true,
    state,
    summary: { lastHour, today, last7d, last30d, allTime },
    hourly: hourly.map((b) => ({ at: b.at, calls: b.calls, costUsd: b.costUsd })),
    daily: daily.map((b) => ({ at: b.at, calls: b.calls, costUsd: b.costUsd })),
    weekly: weekly.map((b) => ({ at: b.at, calls: b.calls, costUsd: b.costUsd })),
    monthly: monthly.map((b) => ({ at: b.at, calls: b.calls, costUsd: b.costUsd })),
    recent,
  });
}
