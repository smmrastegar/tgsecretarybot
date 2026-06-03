import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getHikerSpentBuckets,
  getHikerWindowSummary,
  listRecentHikerCalls,
} from "@/lib/db";
import { getBudgetState } from "@/lib/hikerapi-budget";
import { getTenant, requireAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin drill-down: financial details for any tenant. Same shape as
// /api/monitored/budget but scoped to the requested tenant.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const tenant = await getTenant(n);
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }
  const state = await getBudgetState(n);
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
    getHikerWindowSummary(sinceHour, n),
    getHikerWindowSummary(sinceDay, n),
    getHikerWindowSummary(sinceWeek, n),
    getHikerWindowSummary(sinceMonth, n),
    getHikerWindowSummary(null, n),
    getHikerSpentBuckets({ bucket: "hour", since: sinceHourly, tenantId: n }),
    getHikerSpentBuckets({ bucket: "day", since: sinceDaily, tenantId: n }),
    getHikerSpentBuckets({ bucket: "week", since: sinceWeekly, tenantId: n }),
    getHikerSpentBuckets({ bucket: "month", since: sinceMonthly, tenantId: n }),
    listRecentHikerCalls(50, n),
  ]);
  return NextResponse.json({
    ok: true,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
    state,
    summary: { lastHour, today, last7d, last30d, allTime },
    hourly,
    daily,
    weekly,
    monthly,
    recent,
  });
}
