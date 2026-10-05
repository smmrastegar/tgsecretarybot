import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { kickMusicQueue } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every minute: moves the library queue along and times out stuck jobs.
export async function GET(request: Request): Promise<NextResponse> {
  const secret = config.cronSecret;
  const ok = secret && (request.headers.get("authorization") === `Bearer ${secret}` || new URL(request.url).searchParams.get("secret") === secret);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await kickMusicQueue()) });
}
