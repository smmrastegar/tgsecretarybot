import { webhookCallback } from "grammy";
import { config } from "@/lib/config";
import { getBot } from "@/lib/bot";
import { markUpdateProcessed } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const handler = webhookCallback(getBot(), "std/http", {
  secretToken: config.webhookSecretToken,
  timeoutMilliseconds: 25_000,
});

export async function POST(request: Request): Promise<Response> {
  // Read once, peek at update_id for idempotency, then forward a fresh
  // Request to grammy with the same body. Without this, Telegram's
  // 25s-timeout retries get processed a second time and the user sees
  // duplicate replies (sometimes attached to an older message because
  // the chat had moved on by the time the retry was handled).
  const text = await request.text();
  let updateId: number | null = null;
  try {
    const u = JSON.parse(text) as { update_id?: unknown };
    if (typeof u.update_id === "number") updateId = u.update_id;
  } catch {}
  if (updateId !== null) {
    try {
      const isNew = await markUpdateProcessed(updateId);
      if (!isNew) {
        console.warn(`[webhook] dup update_id=${updateId}, skipping`);
        return new Response("OK (dup)", { status: 200 });
      }
    } catch (err) {
      console.warn("[webhook] dedup check failed, processing anyway:", err);
    }
  }
  const cloned = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: text,
  });
  return handler(cloned);
}
