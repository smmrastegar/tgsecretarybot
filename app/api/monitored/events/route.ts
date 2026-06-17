import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { listRecentMonitorEvents } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paginated reads for the "📬 رویدادهای اخیر" list on /monitored.
// Initial page is 10; the page itself fetches more on scroll.
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
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
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "20"), 1),
    100,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const events = await listRecentMonitorEvents(limit, tenant.id, offset);
  return NextResponse.json({ events, limit, offset });
}
