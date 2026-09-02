import { Bot } from "grammy";
import { requireSessionOr401 } from "@/lib/auth";
import { ALLOWED_UPDATES } from "@/lib/bot";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheap, focused version of the full /api/health check — used by the
// Shell banner to nag the owner when the webhook subscription is out
// of sync with the code's ALLOWED_UPDATES. Returns 200 in both cases,
// the client just checks `missing.length === 0`.
export async function GET(): Promise<Response> {
  try {
    const guard = await requireSessionOr401();
    if (guard) return guard;
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const bot = new Bot(config.telegramBotToken);
    const info = await bot.api.getWebhookInfo();
    const registered = new Set((info.allowed_updates ?? []) as string[]);
    const expected = ALLOWED_UPDATES as readonly string[];
    const missing = expected.filter((u) => !registered.has(u));
    // Empty allowed_updates means Telegram falls back to a default
    // subset that does NOT include business / channel_post / reaction
    // — treat that as "missing everything".
    const usingDefault = (info.allowed_updates?.length ?? 0) === 0;
    return new Response(
      JSON.stringify({
        ok: missing.length === 0 && !usingDefault,
        missing: usingDefault ? [...expected] : missing,
        usingDefault,
        webhookUrl: info.url ?? "",
        pendingUpdateCount: info.pending_update_count ?? 0,
        lastErrorMessage: info.last_error_message ?? "",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
