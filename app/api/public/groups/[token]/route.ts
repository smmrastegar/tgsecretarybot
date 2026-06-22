import { NextResponse } from "next/server";
import {
  findChatByAnalyticsShareToken,
  getCachedGroupAnalytics,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, no-auth read of a previously-cached group analytics. The
// operator generates a token on /groups/<chatId> via the Share button;
// anyone holding the URL can view but never trigger a recompute or
// expose anything that isn't already in the cached payload. Window
// defaults to the operator's most recent compute (any cached row); we
// pick the smallest window we have to keep the URL stable.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 404 });
  }
  const chat = await findChatByAnalyticsShareToken(token).catch(() => null);
  if (!chat) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  // days=0 / days=all → operator's "از ابتدا" cache (window_days=0).
  // Anything else gets clamped to 1..90.
  const daysRaw = url.searchParams.get("days") ?? "0";
  const days =
    daysRaw === "0" || daysRaw === "all"
      ? 0
      : Math.min(Math.max(Number(daysRaw), 1), 90);
  const cached = await getCachedGroupAnalytics(chat.chatId, days).catch(
    () => null,
  );
  if (!cached) {
    return NextResponse.json({
      ok: true,
      empty: true,
      chatTitle: chat.chatTitle,
      sinceIso: null,
      messageCount: 0,
      analysis: null,
    });
  }
  return NextResponse.json({
    ok: true,
    chatTitle: cached.chatTitle ?? chat.chatTitle,
    sinceIso: cached.sinceIso,
    messageCount: cached.messageCount,
    analysis: cached.analysis,
    cachedAt: cached.createdAt,
  });
}
