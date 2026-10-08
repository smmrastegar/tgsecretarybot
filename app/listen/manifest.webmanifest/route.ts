import { NextResponse } from "next/server";

export const dynamic = "force-static";

// Manifest of the launcher app (no token in it): install once, paste any player link inside.
export function GET(): Response {
  return NextResponse.json({
    name: "My Music", short_name: "Music", description: "Your private music player", id: "/listen", start_url: "/listen", scope: "/",
    display: "standalone", orientation: "portrait", background_color: "#0b0b0f", theme_color: "#0b0b0f", lang: "en", dir: "ltr",
    icons: [
      { src: "/icons/player-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/player-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/player-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
