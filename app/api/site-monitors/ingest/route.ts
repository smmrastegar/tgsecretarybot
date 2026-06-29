import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getSiteMonitor, getSiteMonitorByName, hasDb } from "@/lib/db";
import { processScrapedText, tehranNow } from "@/lib/site-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/site-monitors/ingest
//   Authorization: Bearer <SITE_MONITOR_INGEST_SECRET>
//   body: { id?: number, name?: string, text: string }
// Receives page text scraped by the external browser runner (GitHub
// Action) for a browser-mode monitor, runs the AI analysis + notify +
// record pipeline. This is how JS-SPA sites get monitored — the cron
// can't render them, so a real browser elsewhere does and hands us the
// text.
export async function POST(request: Request): Promise<NextResponse> {
  const secret = config.siteMonitorIngestSecret;
  if (!secret) {
    return NextResponse.json({ error: "ingest disabled (no secret set)" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) return NextResponse.json({ error: "no db" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as {
    id?: number;
    name?: string;
    text?: string;
  };
  const text = typeof b.text === "string" ? b.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const m = b.id
    ? await getSiteMonitor(Number(b.id))
    : b.name
      ? await getSiteMonitorByName(String(b.name))
      : null;
  if (!m) return NextResponse.json({ error: "monitor not found" }, { status: 404 });
  if (!m.enabled) return NextResponse.json({ ok: true, skipped: "disabled" });
  const slot = tehranNow(new Date()).slot;
  const res = await processScrapedText(m, text, slot);
  return NextResponse.json({ ok: true, monitor: m.name, ...res });
}
