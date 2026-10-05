import type { MetadataRoute } from "next";

// Nothing on this host is meant for search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
