import type { Metadata, Viewport } from "next";
import "./globals.css";
import ClientErrorHooks from "@/components/ui/ClientErrorHooks";

export const metadata: Metadata = {
  title: "tgsecretarybot",
  description: "Telegram Business secretary bot dashboard",
};

// viewport-fit=cover lets the bottom navigation respect the iPhone home-indicator safe area.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#09090b" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body><ClientErrorHooks />{children}</body>
    </html>
  );
}
