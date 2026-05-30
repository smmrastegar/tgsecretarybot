import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, readSessionFromToken } from "@/lib/session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/telegram",
  "/api/setup",
  "/api/auth",
  "/api/cron",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
