import { NextResponse } from "next/server";
import { getBot, ALLOWED_UPDATES } from "@/lib/bot";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!config.setupSecret) {
    return NextResponse.json(
      { error: "SETUP_SECRET env var not configured" },
      { status: 500 },
    );
  }
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== config.setupSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bot = getBot();
  const action = url.searchParams.get("action") ?? "set";

  try {
    if (action === "delete") {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      return NextResponse.json({ ok: true, action: "deleted" });
    }
    if (action === "info") {
      const info = await bot.api.getWebhookInfo();
      return NextResponse.json({ ok: true, info });
    }
    const host = request.headers.get("host");
    if (!host) {
      return NextResponse.json({ error: "missing host" }, { status: 400 });
    }
    const webhookUrl = `https://${host}/api/telegram`;
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: [...ALLOWED_UPDATES],
      secret_token: config.webhookSecretToken,
      drop_pending_updates: url.searchParams.get("drop") === "1",
    });
    return NextResponse.json({ ok: true, action: "set", url: webhookUrl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
