import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBot } from "@/lib/bot";
import { createLoginRequest } from "@/lib/db";
import { reportError } from "@/lib/report";
import { LOGIN_COOKIE, newToken, sha256 } from "@/lib/tg-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: begin "Login with Telegram". Returns the deep link that opens the bot;
// the browser then polls /api/auth/tg-poll. The poll must come from the same
// browser (httpOnly cookie holding a secret), so a leaked nonce is useless.
export async function POST(): Promise<NextResponse> {
  try {
    return await start();
  } catch (err) {
    reportError("auth", "tg-start failed:", err);
    return NextResponse.json({ error: `Could not start Telegram login: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}

async function start(): Promise<NextResponse> {
  const nonce = newToken(), secret = newToken();
  if (!(await createLoginRequest(sha256(nonce), sha256(secret)).catch(() => false))) {
    return NextResponse.json({ error: "Too many login attempts right now. Try again in a minute." }, { status: 429 });
  }
  const bot = getBot();
  const username = bot.botInfo?.username ?? (await bot.api.getMe()).username;
  (await cookies()).set(LOGIN_COOKIE, secret, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth", maxAge: 600 });
  return NextResponse.json({
    nonce, expiresIn: 300, bot: username,
    url: `https://t.me/${username}?start=login_${nonce}`,
    app: `tg://resolve?domain=${username}&start=login_${nonce}`,
  });
}
