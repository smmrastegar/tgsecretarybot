import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, readSessionFromToken } from "./lib/session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/telegram",
  "/api/setup",
  "/api/auth",
  "/api/cron",
  // Inbound SMS webhook — has its own per-row token auth via the
  // sms_webhooks table. Session-gating it would lock out the
  // Android SMS-Forwarder app (which sees the middleware's
  // {"error":"unauthorized"} response and retries forever).
  "/api/sms-webhook",
  // Insta-notify webhook — token in the URL is the auth, same as
  // /api/sms-webhook. Session-gating would lock out the operator's
  // external change-detector service.
  "/api/insta-webhook",
  // Resend inbound-email webhook — token in ?token= is the auth.
  "/api/email-webhook",
  // Public share links — the URL token itself is the auth. Anyone
  // holding /share/groups/<token> can view the cached analytics for
  // that chat but cannot trigger a recompute or modify anything.
  "/api/public",
  "/share",
  // Public email view — the ?t= HMAC token in the URL is the auth, so
  // Telegram email-card links open without a dashboard login.
  "/e",
  // MCP endpoint — authed by its own Authorization: Bearer <MCP_SECRET>
  // check, not the dashboard session cookie. Session-gating it would
  // break every MCP client (which sends a bearer token, not a cookie).
  "/api/mcp",
  // Ingest endpoint for the external browser scraper — authed by its
  // own Bearer <SITE_MONITOR_INGEST_SECRET>, not the dashboard session.
  // Note: only the /ingest sub-path is public; /api/site-monitors
  // itself stays session-gated.
  "/api/site-monitors/ingest",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await readSessionFromToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
