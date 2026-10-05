import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { authorizeUrl, newState } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const state = newState();
  const url = await authorizeUrl(state);
  if (!url) return NextResponse.redirect(new URL("/music?spotify=nocreds", request.url));
  const res = NextResponse.redirect(url);
  res.cookies.set("spotify_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/music/spotify", maxAge: 600 });
  return res;
}
