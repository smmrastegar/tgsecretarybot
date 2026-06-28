import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getCurrentSession } from "@/lib/auth";
import { hasDb, listSiteMonitors } from "@/lib/db";
import { isMonitorDue, runSiteMonitor } from "@/lib/site-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function authorized(request: Request): Promise<boolean> {
  const session = await getCurrentSession().catch(() => null);
  if (session) return true;
  const secret = config.cronSecret;
  if (!secret) return true;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function GET(request: Request): Promise<NextResponse> { return run(request); }
export async function POST(request: Request): Promise<NextResponse> { return run(request); }

async function run(request: Request): Promise<NextResponse> {
  if (!(await authorized(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no db" }, { status: 500 });
  const now = new Date();
  const monitors = await listSiteMonitors();
  const ran: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const m of monitors) {
    const { due, slot, reason } = isMonitorDue(m, now);
    if (!due) { skipped++; continue; }
    try {
      const r = await runSiteMonitor(m, slot);
      ran.push({ id: m.id, name: m.name, slot, ...r });
    } catch (err) {
      ran.push({ id: m.id, name: m.name, slot, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, ran, skipped, total: monitors.length });
}
