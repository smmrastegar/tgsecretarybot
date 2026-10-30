/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["grammy", "@neondatabase/serverless"],
  // Bodies are buffered for the middleware and cut at 10 MB by default; 130 MB covers the largest accepted upload (120 MB) wherever a route is still behind it.
  experimental: { middlewareClientMaxBodySize: "130mb" },
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
