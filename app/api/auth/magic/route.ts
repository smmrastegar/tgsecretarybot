import { NextResponse } from "next/server";
import { readMagicToken } from "@/lib/magic";
import { createSession, setSessionCookie } from "@/lib/auth";
import { audit, isAllowedUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = body.token;
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }
  const payload = await readMagicToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: "Link is invalid or expired. Send /login to the bot again." },
      { status: 401 },
    );
  }
  const allowed = await isAllowedUser(payload.userId).catch(() => false);
  if (!allowed) {
    return NextResponse.json(
      { error: "This Telegram account is not connected to the bot." },
      { status: 403 },
    );
  }
  const sessionToken = await createSession(payload);
  await setSessionCookie(sessionToken);
  await audit({
    actorId: payload.userId,
    actorName: payload.username ?? null,
    action: "auth.magic",
  });
  return NextResponse.json({ ok: true, user: payload });
}
