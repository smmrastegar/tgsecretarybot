import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getChatRule, listChatMessagesForAnalysis } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { analyzeGroupTasks } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
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
    Math.max(Number(url.searchParams.get("days") ?? "14"), 1),
    90,
  );
  const since = new Date(Date.now() - days * 86400_000);

  const { chatTitle, messages } = await listChatMessagesForAnalysis({
    chatId,
    since,
    limit: 1500,
  });
  if (messages.length === 0) {
    return NextResponse.json({
      ok: true,
      empty: true,
      chatTitle,
      sinceIso: since.toISOString(),
      messageCount: 0,
      analysis: null,
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
  return NextResponse.json({
    ok: true,
    chatTitle,
    sinceIso: since.toISOString(),
    messageCount: messages.length,
    analysis,
  });
}
