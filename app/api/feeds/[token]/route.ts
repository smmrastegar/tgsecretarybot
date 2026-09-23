import { NextResponse } from "next/server";
import {
  getCodeFeedByToken,
  recentChatMessagesForFeed,
  stampCodeFeedAccess,
} from "@/lib/db";
import { extractCodes, renderFeed, type FeedFormat } from "@/lib/code-feed";
import { background } from "@/lib/background";
import { clientIp, ipAllowed } from "@/lib/ip-allow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real client IP. Behind Cloudflare the socket peer is Cloudflare, so the
// only trustworthy client address is CF-Connecting-IP, which Cloudflare
// sets and overwrites on every proxied request. X-Forwarded-For is the
// fallback for direct/origin access — its LAST entry is the one added by
// our own reverse proxy, so we take the FIRST only when CF is absent.
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

  background("stampCodeFeedAccess", stampCodeFeedAccess(feed.id, ip));

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
