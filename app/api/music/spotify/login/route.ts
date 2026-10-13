import { NextResponse } from "next/server";
import { getCurrentSession, requireSessionOr401 } from "@/lib/auth";
import { pinState } from "@/lib/pin-session";
import { config } from "@/lib/config";
import { authorizeUrl, isReturnHost, signedState } from "@/lib/spotify";

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
  const st = await pinState(await getCurrentSession()); // a limited password may only reconnect its own accounts
  // Remember which host started this (playlist.bz or bot.text.bz) so the callback can return there.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0] ?? "";
  const state = signedState(host, st.scope ? st.scope.ids.filter((id) => id > 0) : undefined);
  const url = await authorizeUrl(state);
  const base = isReturnHost(host) ? `https://${host}` : publicBase();
  if (!url) return NextResponse.redirect(new URL("/music?spotify=nocreds", base));
  return NextResponse.redirect(url);
}
