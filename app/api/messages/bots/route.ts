import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, listBotSummaries, markBotMessagesHandled, setBotInMain } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The separate "ربات‌ها" view: every bot with its last-30-day volume, and two actions per bot —
// pin it into the main message feed (for the few bots that matter) or clear its backlog.
export async function GET(): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  return NextResponse.json({ bots: await listBotSummaries() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const b = (await request.json().catch(() => ({}))) as { chatId?: number; inMain?: boolean; markAllHandled?: boolean };
  const chatId = Number(b.chatId);
  if (!Number.isFinite(chatId)) return NextResponse.json({ error: "chatId required" }, { status: 400 });
  if (typeof b.inMain === "boolean") {
    await setBotInMain(chatId, b.inMain);
    await audit({ actorId: session.userId, actorName: session.username ?? null, action: "bot.pin", target: String(chatId), details: { inMain: b.inMain } });
  }
  let cleared = 0;
  if (b.markAllHandled) {
    cleared = await markBotMessagesHandled(chatId, session.userId);
    await audit({ actorId: session.userId, actorName: session.username ?? null, action: "bot.clear", target: String(chatId), details: { cleared } });
  }
  return NextResponse.json({ ok: true, cleared });
}
