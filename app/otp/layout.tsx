import type { Metadata, Viewport } from "next";

// Installable as a standalone app (Safari "Add to Dock", Chrome
// "Install"): the manifest gives it its own window, icon and name.
export const metadata: Metadata = {
  title: "کدهای یک‌بارمصرف",
  manifest: "/otp.webmanifest",
  appleWebApp: { capable: true, title: "OTP", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/otp-180.png", icon: "/icons/otp-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function OtpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
