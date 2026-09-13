import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { hasDb } from "@/lib/db";
import { sweepEphemeral } from "@/lib/ephemeral";
import { reportError } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

// Runs every minute (deploy/crontab). The in-process timer usually
// deletes an ephemeral message on the second; this is the safety net
// for timers lost to a restart, so nothing outlives its TTL by more
// than a minute.
async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  try {
    const r = await sweepEphemeral();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    reportError("cron:ephemeral", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
