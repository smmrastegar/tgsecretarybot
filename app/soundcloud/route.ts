import { NextResponse } from "next/server";
import { reportWarn } from "@/lib/report";
import { scFinishSignIn } from "@/lib/soundcloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The redirect URI registered with SoundCloud (https://playlist.bz/soundcloud): SoundCloud sends the browser back here with ?code & ?state.
// The state is a signed one-time nonce, so this needs no login of its own; it then sends the browser on to the music page.
const ALLOWED = new Set(["playlist.bz", "chatbot.bz", "bot.text.bz"]);

export async function GET(request: Request): Promise<NextResponse> {
  const u = new URL(request.url);
  const back = (host: string, q: string) => NextResponse.redirect(new URL(`/music?soundcloud=${q}`, `https://${ALLOWED.has(host) ? host : "playlist.bz"}`));
  if (u.searchParams.get("error")) return back("playlist.bz", "denied");
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (!code || !state) return back("playlist.bz", "state");
  try {
    const r = await scFinishSignIn(code, state);
    return back(r.host, "connected");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reportWarn("music", `SoundCloud connect failed: ${msg}`);
    return back("playlist.bz", /expired|bad state/.test(msg) ? "state" : "failed");
  }
}
