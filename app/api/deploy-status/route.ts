import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { reportError, reportWarn } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status sink for the deploy box. deploy/auto-deploy.sh runs as root on
// the server and can self-heal things the app can't reach (the Caddy
// vhost, systemd units) — but its only output was a log file nobody
// reads, so a failed self-heal was indistinguishable from one that
// never ran. Posting here puts those events in the same System Log as
// everything else.
//
// Authed by WEBHOOK_SECRET_TOKEN, which the deploy script already has
// in .env. Not the dashboard session — the caller is a shell script.
function authorized(request: Request): boolean {
  const expected = (config.webhookSecretToken ?? "").trim();
  if (!expected) return false;
  const presented = (request.headers.get("x-deploy-token") ?? "").trim();
  if (presented.length !== expected.length || !presented) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    level?: unknown;
    message?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.slice(0, 1000) : "";
  if (!message) {
    return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
  }
  const source =
    typeof body.source === "string" && body.source.trim()
      ? `deploy:${body.source.trim().slice(0, 40)}`
      : "deploy";
  if (body.level === "error") reportError(source, message);
  else reportWarn(source, message);
  return NextResponse.json({ ok: true });
}
