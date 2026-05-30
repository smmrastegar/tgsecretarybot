import { webhookCallback } from "grammy";
import { config } from "@/lib/config";
import { getBot } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const handler = webhookCallback(getBot(), "std/http", {
  secretToken: config.webhookSecretToken,
  timeoutMilliseconds: 25_000,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
