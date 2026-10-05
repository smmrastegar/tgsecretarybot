import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { config } from "@/lib/config";
import { exchangeCode } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Behind Caddy/Cloudflare request.url is the internal http://localhost:3000;
// redirects must go to the public origin.
function publicBase(): string {
  return (config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "");
}

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return NextResponse.redirect(new URL("/login?next=/music", publicBase()));
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const cookie = /(?:^|;\s*)spotify_state=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/music?spotify=${q}`, publicBase()));
    r.cookies.set("spotify_state", "", { path: "/api/music/spotify", maxAge: 0 });
    return r;
  };
  if (u.searchParams.get("error")) return back("denied");
  if (!code || !state || !cookie || state !== cookie) return back("state");
  try {
    await exchangeCode(code);
    return back("connected");
  } catch {
    return back("failed");
  }
}
