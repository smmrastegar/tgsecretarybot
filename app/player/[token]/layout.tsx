import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

// Inter (variable, latin subset 48 KB) self-hosted: the same glyphs, metrics and
// tabular figures on every phone instead of whatever the OS ships. next/font
// preloads it and generates a size-matched fallback so there is no layout jump.
const inter = localFont({
  src: "../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900", display: "swap", variable: "--font-inter",
});

// Private page: no indexing, no link previews, no referrer leak. The
// manifest + Apple tags make it installable on Android and iOS.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Player",
    robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true, noimageindex: true },
    referrer: "no-referrer",
    openGraph: undefined,
    twitter: undefined,
    manifest: `/player/${encodeURIComponent(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Music", statusBarStyle: "black-translucent" },
    icons: { icon: "/icons/player-192.png", apple: "/icons/player-180.png" },
  };
}
export const viewport: Viewport = { themeColor: "#0b0b0f", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return <div className={inter.variable}>{children}</div>;
}
