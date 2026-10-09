import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { setSetting } from "@/lib/db";
import { reportWarn } from "@/lib/report";
import { exchangeCode, readSignedState } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Behind Caddy/Cloudflare request.url is the internal http://localhost:3000;
// redirects must go to the public origin.
function publicBase(): string {
  return (config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "");
}

export async function GET(request: Request): Promise<NextResponse> {
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  // The browser may have started on playlist.bz while this callback lands on bot.text.bz (no cookies here):
  // the signed state proves a signed-in session began the flow and says where to send the browser back.
  const st = state ? readSignedState(state) : null;
  const base = st ? `https://${st.host}` : publicBase();
  const back = (q: string) => NextResponse.redirect(new URL(`/music?spotify=${q}`, base));
  if (u.searchParams.get("error")) return back("denied");
  if (!code || !st) return back("state");
  try {
    await exchangeCode(code);
    return back("connected");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reportWarn("music", `Spotify connect failed: ${msg}`);
    await setSetting("spotifyLastError", `${new Date().toISOString()} ${msg}`.slice(0, 300)).catch(() => {});
    // In development mode Spotify only lets accounts listed under the app's User Management sign in: /me answers 403.
    return back(/\b403\b/.test(msg) ? "notallowed" : "failed");
  }
}
