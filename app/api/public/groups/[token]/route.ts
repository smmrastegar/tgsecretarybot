import { NextResponse } from "next/server";
import {
  findChatByAnalyticsShareToken,
  getCachedGroupAnalytics,
  listCachedAnalyticsWindows,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Epoch-ish values mean "from the beginning" — the analyzer stores
// 1970-01-01 for the days=0 window. Rendering that as a real date is
// nonsense, so normalise it away here rather than in every consumer.
function normalizeSince(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  // Anything before 2000 is a sentinel, not a real window start.
  if (t < Date.UTC(2000, 0, 1)) return null;
  return iso;
}

// Public, no-auth read of a previously-cached group analytics. The
// operator generates a token on /groups/<chatId> via the Share button;
// anyone holding the URL can view but never trigger a recompute or
// expose anything that isn't already in the cached payload.
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
  const requested =
    daysRaw === "0" || daysRaw === "all"
      ? 0
      : Math.min(Math.max(Number(daysRaw) || 0, 0), 90);

  // Which windows actually have data? The UI uses this so a viewer is
  // never offered a button that dead-ends on an empty report.
  const available = await listCachedAnalyticsWindows(chat.chatId).catch(
    () => [] as Array<{ windowDays: number; createdAt: string }>,
  );
  const availableWindows = available.map((w) => w.windowDays);

  // Serve the requested window; if it was never computed, fall back to
  // the closest one we do have instead of showing a dead end.
  let served = requested;
  let cached = await getCachedGroupAnalytics(chat.chatId, requested).catch(
    () => null,
  );
  if (!cached && availableWindows.length > 0) {
    served = availableWindows.reduce((best, w) =>
      Math.abs(w - requested) < Math.abs(best - requested) ? w : best,
    );
    cached = await getCachedGroupAnalytics(chat.chatId, served).catch(() => null);
  }

  if (!cached) {
    return NextResponse.json({
      ok: true,
      empty: true,
      chatTitle: chat.chatTitle,
      sinceIso: null,
      messageCount: 0,
      analysis: null,
      requestedDays: requested,
      servedDays: null,
      availableWindows,
    });
  }

  const cachedAt = cached.createdAt;
  const ageMs = cachedAt ? Date.now() - new Date(cachedAt).getTime() : null;
  return NextResponse.json({
    ok: true,
    chatTitle: cached.chatTitle ?? chat.chatTitle,
    sinceIso: normalizeSince(cached.sinceIso),
    messageCount: cached.messageCount,
    analysis: cached.analysis,
    cachedAt,
    // Everything the viewer needs to judge how much to trust this.
    ageDays:
      ageMs != null && Number.isFinite(ageMs)
        ? Math.floor(ageMs / 86_400_000)
        : null,
    requestedDays: requested,
    servedDays: served,
    fellBack: served !== requested,
    availableWindows,
  });
}
