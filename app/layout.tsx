import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tgsecretarybot",
  description: "Telegram Business secretary bot dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
