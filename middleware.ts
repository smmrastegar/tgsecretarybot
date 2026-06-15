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
  // Public share links — the URL token itself is the auth. Anyone
  // holding /share/groups/<token> can view the cached analytics for
  // that chat but cannot trigger a recompute or modify anything.
  "/api/public",
  "/share",
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
