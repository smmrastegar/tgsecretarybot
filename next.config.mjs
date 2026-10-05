/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["grammy", "@neondatabase/serverless"],
  async headers() {
    const priv = [
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
    ];
    return [
      { source: "/player/:path*", headers: priv },
      { source: "/api/music/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "t.me" },
      { protocol: "https", hostname: "telegram.org" },
    ],
  },
};

export default nextConfig;
