import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ALLOWED_UPDATES, getBot } from "@/lib/bot";
import { config } from "@/lib/config";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const host = request.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "missing host" }, { status: 400 });
  }
  const webhookUrl = `https://${host}/api/telegram`;
  const bot = getBot();
  try {
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: [...ALLOWED_UPDATES],
      secret_token: config.webhookSecretToken,
      drop_pending_updates: false,
    });
    const info = await bot.api.getWebhookInfo();
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "webhook.refresh",
      details: { url: webhookUrl, allowed_updates: [...ALLOWED_UPDATES] },
    });
    return NextResponse.json({ ok: true, info });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err).slice(0, 400) },
      { status: 500 },
    );
  }
}
