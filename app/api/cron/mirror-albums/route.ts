import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getBot, flushReadyMirrorAlbums } from "@/lib/bot";
import { hasDb } from "@/lib/db";

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

// Flushes channel-mirror album groups that have gone quiet (all parts
// arrived). Runs every minute as the reliable backstop for the trailing
// album — the ones a webhook's opportunistic sweep didn't catch because
// no further message followed.
async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const flushed = await flushReadyMirrorAlbums(getBot());
  return NextResponse.json({ ok: true, flushed });
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
