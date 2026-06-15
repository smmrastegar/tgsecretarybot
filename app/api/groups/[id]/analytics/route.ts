import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getCachedGroupAnalytics,
  getChatRule,
  getGroupAnalyticsShareToken,
  listChatMessagesForAnalysis,
  upsertGroupAnalytics,
} from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { analyzeGroupTasks } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST recomputes (manual refresh button); GET returns cache and only
// computes when there's nothing cached yet.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, ctx, { allowCompute: true, preferCache: false });
}
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, ctx, { allowCompute: true, preferCache: true });
}

async function handle(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  opts: { allowCompute: boolean; preferCache: boolean },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const days = Math.min(
    Math.max(Number(url.searchParams.get("days") ?? "7"), 1),
    90,
  );
  const force = url.searchParams.get("force") === "1";

  // Cache hit: serve unless ?force=1.
  if (opts.preferCache && !force) {
    const cached = await getCachedGroupAnalytics(chatId, days).catch(
      () => null,
    );
    if (cached) {
      const token = await getGroupAnalyticsShareToken(chatId).catch(() => null);
      return NextResponse.json({
        ok: true,
        cached: true,
        chatTitle: cached.chatTitle,
        sinceIso: cached.sinceIso,
        messageCount: cached.messageCount,
        analysis: cached.analysis,
        cachedAt: cached.createdAt,
        shareToken: token,
      });
    }
    if (!opts.allowCompute) {
      return NextResponse.json({
        ok: true,
        empty: true,
        chatTitle: null,
        sinceIso: null,
        messageCount: 0,
        analysis: null,
      });
    }
  }

  const since = new Date(Date.now() - days * 86400_000);
  const { chatTitle, messages } = await listChatMessagesForAnalysis({
    chatId,
    since,
    limit: 1500,
  });
  const token = await getGroupAnalyticsShareToken(chatId).catch(() => null);
  if (messages.length === 0) {
    return NextResponse.json({
      ok: true,
      empty: true,
      chatTitle,
      sinceIso: since.toISOString(),
      messageCount: 0,
      analysis: null,
      shareToken: token,
    });
  }
  const settings = await getSettings();
  const rule = await getChatRule(chatId).catch(() => null);

  const analysis = await analyzeGroupTasks({
    chatId,
    chatTitle,
    ownerName: settings.ownerName,
    ownerContext: settings.ownerContext,
    chatNotes: rule?.notes ?? null,
    messages: messages.map((m) => ({
      sender: m.fromOwner
        ? settings.ownerDisplayName || settings.ownerName || "owner"
        : m.sender,
      text: m.text,
      at: m.at,
    })),
  });
  await upsertGroupAnalytics({
    chatId,
    chatTitle,
    windowDays: days,
    sinceIso: since.toISOString(),
    messageCount: messages.length,
    analysis,
  }).catch((err) => console.warn("[groups] cache write failed:", err));
  return NextResponse.json({
    ok: true,
    cached: false,
    chatTitle,
    sinceIso: since.toISOString(),
    messageCount: messages.length,
    analysis,
    shareToken: token,
  });
}
