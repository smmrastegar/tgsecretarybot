import type { IncomingMessage, ServerResponse } from "node:http";
import { bot, ALLOWED_UPDATES } from "../src/bot.js";
import { config } from "../src/config.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const host = req.headers.host;
  const url = new URL(req.url ?? "/", `https://${host ?? "localhost"}`);
  const secret = url.searchParams.get("secret");

  if (!config.setupSecret) {
    res.statusCode = 500;
    res.end("SETUP_SECRET env var is not configured");
    return;
  }
  if (secret !== config.setupSecret) {
    res.statusCode = 401;
    res.end("unauthorized");
    return;
  }
  if (!host) {
    res.statusCode = 400;
    res.end("missing Host header");
    return;
  }

  const action = url.searchParams.get("action") ?? "set";
  res.setHeader("content-type", "application/json");

  try {
    if (action === "delete") {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, action: "deleted" }));
      return;
    }

    if (action === "info") {
      const info = await bot.api.getWebhookInfo();
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, info }, null, 2));
      return;
    }

    const webhookUrl = `https://${host}/api/telegram`;
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: [...ALLOWED_UPDATES],
      secret_token: config.webhookSecretToken,
      drop_pending_updates: url.searchParams.get("drop") === "1",
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, action: "set", url: webhookUrl }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
}
