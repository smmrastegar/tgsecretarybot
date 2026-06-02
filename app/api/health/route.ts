import { Bot } from "grammy";
import { config } from "@/lib/config";
import { hasDb, sql } from "@/lib/db";
import { ALLOWED_UPDATES } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = {
  ok: boolean;
  detail?: string;
  ms: number;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; detail?: string; ms: number; value?: T }> {
  const t = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t, value };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : String(err).slice(0, 200);
    return { ok: false, detail, ms: Date.now() - t };
  }
}

export async function GET(): Promise<Response> {
  const checks: Record<string, Check> = {};
  let activity: Record<string, unknown> = {};

  if (hasDb()) {
    const db = await timed(async () => {
      const rows = await sql()`SELECT 1 AS ok`;
      return rows.length > 0;
    });
    checks.database = { ok: db.ok, detail: db.detail, ms: db.ms };

    const act = await timed(async () => {
      const rows = (await sql()`
        SELECT
          (SELECT MAX(created_at) FROM messages_log)            AS last_msg_at,
          (SELECT MAX(created_at) FROM ai_usage)                AS last_ai_at,
          (SELECT COUNT(*) FROM messages_log
            WHERE created_at > NOW() - INTERVAL '1 hour')::int  AS msgs_1h,
          (SELECT COUNT(*) FROM ai_usage
            WHERE created_at > NOW() - INTERVAL '1 hour')::int  AS ai_1h,
          (SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM ai_usage
            WHERE created_at > NOW() - INTERVAL '24 hours')     AS ai_cost_24h,
          (SELECT COUNT(*) FROM processed_updates
            WHERE processed_at > NOW() - INTERVAL '1 hour')::int AS updates_1h,
          (SELECT COUNT(*) FROM business_connections
            WHERE is_enabled = TRUE)::int                       AS bcs_enabled
      `) as Array<Record<string, unknown>>;
      return rows[0] ?? {};
    });
    checks.activity = { ok: act.ok, detail: act.detail, ms: act.ms };
    if (act.value) activity = act.value as Record<string, unknown>;
  } else {
    checks.database = { ok: false, detail: "DATABASE_URL not set", ms: 0 };
  }

  const tg = await timed(async () => {
    const bot = new Bot(config.telegramBotToken);
    const me = await bot.api.getMe();
    return `@${me.username} (${me.id})`;
  });
  checks.telegram = { ok: tg.ok, detail: tg.detail ?? tg.value, ms: tg.ms };

  // Webhook subscription info — if allowed_updates doesn't contain
  // every type we handle (especially deleted_business_messages), the
  // event will silently never arrive. We surface the gap on the
  // dashboard so the owner can hit "Re-register webhook".
  const webhook = await timed(async () => {
    const bot = new Bot(config.telegramBotToken);
    const info = await bot.api.getWebhookInfo();
    return info;
  });
  if (webhook.ok && webhook.value) {
    const info = webhook.value;
    const registered = new Set(
      (info.allowed_updates ?? []) as string[],
    );
    const expected = ALLOWED_UPDATES as readonly string[];
    const missing = expected.filter((u) => !registered.has(u));
    // If allowed_updates is empty/undefined, Telegram defaults to a
    // subset that EXCLUDES business + reaction updates, so we always
    // report it as out-of-sync in that case.
    const stale =
      missing.length > 0 || (info.allowed_updates?.length ?? 0) === 0;
    activity.webhook_url = info.url ?? "";
    activity.webhook_pending = info.pending_update_count ?? 0;
    activity.webhook_last_error = info.last_error_message ?? "";
    activity.webhook_allowed_updates =
      info.allowed_updates && info.allowed_updates.length > 0
        ? info.allowed_updates.join(", ")
        : "(default — missing business + reaction events)";
    activity.webhook_missing = missing.join(", ");
    checks.webhook = {
      ok: !stale,
      detail: stale
        ? `Missing: ${missing.join(", ") || "default subset only"}. Re-register the webhook to fix.`
        : "all expected update types subscribed",
      ms: webhook.ms,
    };
  } else {
    checks.webhook = {
      ok: false,
      detail: webhook.detail ?? "getWebhookInfo failed",
      ms: webhook.ms,
    };
  }

  const or = await timed(async () => {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as {
      data?: { label?: string; usage?: number; limit?: number };
    };
    const d = data.data;
    if (!d) return "key valid";
    return `${d.label ?? "key"} · $${(d.usage ?? 0).toFixed(2)}${
      d.limit ? ` / $${d.limit.toFixed(2)}` : ""
    }`;
  });
  checks.openrouter = { ok: or.ok, detail: or.detail ?? or.value, ms: or.ms };

  const ok = Object.values(checks).every((c) => c.ok);
  return new Response(
    JSON.stringify({ ok, checks, activity }, null, 2),
    {
      status: ok ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    },
  );
}
