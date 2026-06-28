import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getSiteMonitor } from "@/lib/db";
import { fetchMonitoredPage, runSiteMonitor, tehranNow } from "@/lib/site-monitor";
import { analyzeSiteChange } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST ?dryRun=1 → fetch + analyze but DON'T notify/record (for tuning
// the login). Without dryRun → full run (notifies + records).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;
  const mid = Number(id);
  const m = await getSiteMonitor(mid);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  if (dryRun) {
    const page = await fetchMonitoredPage(m);
    const analysis = page.status === "ok"
      ? await analyzeSiteChange({ monitorName: m.name, url: m.checkUrl, text: page.text })
      : null;
    return NextResponse.json({
      ok: page.status === "ok",
      status: page.status,
      error: page.error,
      loginInfo: page.loginInfo,
      textPreview: page.text.slice(0, 1500),
      analysis,
    });
  }
  const slot = tehranNow(new Date()).slot;
  const res = await runSiteMonitor(m, slot);
  return NextResponse.json({ ok: true, ...res });
}
