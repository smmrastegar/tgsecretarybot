import { NextResponse } from "next/server";
import {
  createSession,
  setSessionCookie,
  userIsAllowed,
  verifyTelegramLogin,
  type TelegramLoginPayload,
} from "@/lib/auth";
import { config } from "@/lib/config";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let body: Partial<TelegramLoginPayload>;
  try {
    body = (await request.json()) as Partial<TelegramLoginPayload>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.id !== "number" || typeof body.auth_date !== "number" || typeof body.hash !== "string") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const payload = body as TelegramLoginPayload;
  if (!verifyTelegramLogin(payload, config.telegramBotToken)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const allowed = await userIsAllowed(payload.id);
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "User is not connected to this bot via Telegram Business. Add the bot under Settings → Telegram Business → Chatbots first.",
      },
      { status: 403 },
    );
  }

  const session = {
    userId: payload.id,
    username: payload.username ?? null,
    firstName: payload.first_name ?? null,
    lastName: payload.last_name ?? null,
    photoUrl: payload.photo_url ?? null,
  };
  const token = await createSession(session);
  await setSessionCookie(token);
  await audit({
    actorId: payload.id,
    actorName: payload.username ?? payload.first_name ?? null,
    action: "auth.login",
  });
  return NextResponse.json({ ok: true, user: session });
}
