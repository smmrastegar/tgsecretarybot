import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { config } from "@/lib/config";
import { authorizeUrl, newState } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Behind Caddy/Cloudflare request.url is the internal http://localhost:3000;
// redirects must go to the public origin.
function publicBase(): string {
  return (config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "");
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const state = newState();
  const url = await authorizeUrl(state);
  if (!url) return NextResponse.redirect(new URL("/music?spotify=nocreds", publicBase()));
  const res = NextResponse.redirect(url);
  res.cookies.set("spotify_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/music/spotify", maxAge: 600 });
  return res;
}
