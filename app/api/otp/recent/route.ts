import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getCodeFeedByToken, stampCodeFeedAccess } from "@/lib/db";
import { background } from "@/lib/background";
import { clientIp, ipAllowed } from "@/lib/ip-allow";
import { recentOtpItems } from "@/lib/otp-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two callers: the /otp page (dashboard session) and the native Mac
// menu-bar app (a code-feed token, Authorization: Bearer <token> or
// ?token=). Fail closed: no session and no valid token → 401. Feed IP
// allowlists apply to the token path exactly as they do to /api/feeds.
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  let ok = Boolean(await getCurrentSession().catch(() => null));
  if (!ok) {
    const header = request.headers.get("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    const token = (m?.[1] ?? url.searchParams.get("token") ?? "").trim();
    if (token) {
      const feed = await getCodeFeedByToken(token).catch(() => null);
      if (feed && feed.enabled) {
        if (!ipAllowed(clientIp(request), feed.allowedIps)) {
          return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }
        ok = true;
        background("stampCodeFeedAccess", stampCodeFeedAccess(feed.id, clientIp(request)));
      }
    }
  }
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const hours = Number(url.searchParams.get("hours") ?? "24");
  const items = await recentOtpItems(Number.isFinite(hours) ? hours : 24);
  return NextResponse.json(
    { items, now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
