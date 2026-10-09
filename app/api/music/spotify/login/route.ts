import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { config } from "@/lib/config";
import { authorizeUrl, signedState } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Behind Caddy/Cloudflare request.url is the internal http://localhost:3000;
// redirects must go to the public origin.
function publicBase(): string {
  return (config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "");
}

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  // Remember which host started this (playlist.bz or bot.text.bz) so the callback can return there.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0] ?? "";
  const state = signedState(host);
  const url = await authorizeUrl(state);
  const base = host === "playlist.bz" || host === "www.playlist.bz" ? `https://${host}` : publicBase();
  if (!url) return NextResponse.redirect(new URL("/music?spotify=nocreds", base));
  return NextResponse.redirect(url);
}
