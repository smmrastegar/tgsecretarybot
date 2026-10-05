import type { Metadata, Viewport } from "next";

// Private page: no indexing, no link previews, no referrer leak.
export const metadata: Metadata = {
  title: "Player",
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
  openGraph: undefined,
  twitter: undefined,
};
export const viewport: Viewport = { themeColor: "#0b0b0f", width: "device-width", initialScale: 1 };

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
