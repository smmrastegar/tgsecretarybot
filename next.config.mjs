/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["grammy", "@neondatabase/serverless"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "t.me" },
      { protocol: "https", hostname: "telegram.org" },
    ],
  },
};

export default nextConfig;
