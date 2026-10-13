import type { Viewport } from "next";

export const metadata = { title: "My Music", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#0b0b0f", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default function TgLayout({ children }: { children: React.ReactNode }) {
  return children;
}
