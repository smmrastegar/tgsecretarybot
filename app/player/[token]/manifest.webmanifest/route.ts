import { NextResponse } from "next/server";
import { isValidPlayerToken } from "@/lib/music-token";
import { notFound } from "@/lib/music-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-token web app manifest so "Install app" / "Add to Home Screen"
// launches straight into the private player. Wrong token → 404.
export async function GET(_r: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  if (!(await isValidPlayerToken(token))) return notFound();
  const base = `/player/${token}`;
  return NextResponse.json({
    name: "My Music", short_name: "Music", description: "Private music player",
    id: base, start_url: base, scope: "/player/", display: "standalone", orientation: "portrait",
    background_color: "#0b0b0f", theme_color: "#0b0b0f", lang: "en", dir: "ltr",
    icons: [
      { src: "/icons/player-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/player-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/player-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } });
}
