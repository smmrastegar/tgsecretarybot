import { NextResponse } from "next/server";
import {
  getCodeFeedByToken,
  recentChatMessagesForFeed,
  stampCodeFeedAccess,
} from "@/lib/db";
import { extractCodes, renderFeed, type FeedFormat } from "@/lib/code-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real client IP. Behind Cloudflare the socket peer is Cloudflare, so the
// only trustworthy client address is CF-Connecting-IP, which Cloudflare
// sets and overwrites on every proxied request. X-Forwarded-For is the
// fallback for direct/origin access — its LAST entry is the one added by
// our own reverse proxy, so we take the FIRST only when CF is absent.
function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

// Supports plain IPs and CIDR (v4). An empty allowlist means "any".
function ipAllowed(ip: string | null, allow: string[]): boolean {
  if (allow.length === 0) return true;
  if (!ip) return false;
  const toInt = (s: string): number | null => {
    const p = s.split(".");
    if (p.length !== 4) return null;
    let n = 0;
    for (const part of p) {
      const v = Number(part);
      if (!Number.isInteger(v) || v < 0 || v > 255) return null;
      n = (n << 8) | v;
    }
    return n >>> 0;
  };
  const ipInt = toInt(ip);
  for (const entry of allow) {
    if (entry === ip) return true;
    const [net, bitsRaw] = entry.split("/");
    if (!bitsRaw || ipInt == null) continue;
    const netInt = toInt(net ?? "");
    const bits = Number(bitsRaw);
    if (netInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      continue;
    }
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((ipInt & mask) === (netInt & mask)) return true;
  }
  return false;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const feed = await getCodeFeedByToken(token).catch(() => null);
  // Unknown and disabled tokens look identical from outside — no probing.
  if (!feed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ip = clientIp(req);
  if (!ipAllowed(ip, feed.allowedIps)) {
    return NextResponse.json(
      { error: "forbidden", ip },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  // ?window= may only NARROW the configured window, never widen it.
  const asked = Number(url.searchParams.get("window") ?? 0);
  const windowSeconds =
    Number.isFinite(asked) && asked > 0
      ? Math.min(asked, feed.windowSeconds)
      : feed.windowSeconds;

  const rows = await recentChatMessagesForFeed(feed.chatId, windowSeconds);
  const items = rows
    .map((r) => ({
      at: r.createdAt.toISOString(),
      text: r.text,
      codes: extractCodes(r.text),
    }))
    .filter((i) => (feed.codesOnly ? i.codes.length > 0 : true));

  void stampCodeFeedAccess(feed.id, ip).catch(() => {});

  const fmt = (url.searchParams.get("format") ?? feed.format) as FeedFormat;
  const { body, contentType } = renderFeed(
    ["json", "text", "codes", "html"].includes(fmt) ? fmt : "json",
    items,
  );
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Never let a CDN or browser hold on to one-time codes.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
