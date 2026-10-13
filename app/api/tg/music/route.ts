import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { isAllowedUser } from "@/lib/db";
import { getLegacyToken, isLegacyActive } from "@/lib/music-token";
import { verifyInitData } from "@/lib/tg-webapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { initData } from the Telegram Mini App: proves the opener is the owner (signed by Telegram with the bot token)
// and hands back the Main link's token so the player can open inside Telegram.
export async function POST(request: Request): Promise<NextResponse> {
  const b = (await request.json().catch(() => ({}))) as { initData?: unknown };
  const u = typeof b.initData === "string" ? verifyInitData(b.initData, config.telegramBotToken) : null;
  if (!u) return NextResponse.json({ error: "Open this from the Telegram bot." }, { status: 401 });
  if (!(await isAllowedUser(u.id).catch(() => false))) return NextResponse.json({ error: "This Telegram account is not connected to the bot." }, { status: 403 });
  if (!(await isLegacyActive())) return NextResponse.json({ error: "The Main link is switched off (dashboard → Music → links)." }, { status: 409 });
  return NextResponse.json({ token: await getLegacyToken() }, { headers: { "Cache-Control": "no-store" } });
}
