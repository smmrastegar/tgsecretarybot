import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { hasDb } from "@/lib/db";
import { getExternalMonitorConfig } from "@/lib/external-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public lightweight health endpoint that the external monitor can
// poll. No auth — we don't return secrets. Just enough for the other
// side to know we're up and ready to receive notifications.
export async function GET(): Promise<NextResponse> {
  const cfg = await getExternalMonitorConfig();
  return NextResponse.json({
    ok: true,
    service: "tgsecretarybot",
    notifyEndpoint: "/api/monitored/notify",
    hasDb: hasDb(),
    hikerConfigured: !!config.hikerApiKey,
    externalMonitorEnabled: cfg.enabled,
    secretConfigured: !!cfg.secret,
    time: new Date().toISOString(),
  });
}
