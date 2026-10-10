import type { Metadata, Viewport } from "next";

// The installable launcher: one app for any player link. Not indexed, no previews.
export const metadata: Metadata = {
  title: "My Music",
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
  manifest: "/listen/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Music", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/player-192.png", apple: "/icons/player-180.png" },
};
export const viewport: Viewport = { themeColor: "#0b0b0f", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default function ListenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{"html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%;text-size-adjust:100%}"}</style>
      {children}
    </>
  );
}
