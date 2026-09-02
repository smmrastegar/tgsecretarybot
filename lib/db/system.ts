// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { CHAT_MODES, ChatMode } from "./chats";
import { ensureSchema, hasDb, sql } from "./core";

// --- Settings ---

export async function getAllSettings(): Promise<Record<string, string>> {
  if (!hasDb()) return {};
  await ensureSchema();
  const rows = await sql()`SELECT key, value FROM settings`;
  const out: Record<string, string> = {};
  for (const r of rows) out[(r as { key: string }).key] = (r as { value: string }).value;
  return out;
}

export async function setSetting(
  key: string,
  value: string,
  actorId?: number,
): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${value}, ${actorId ?? null}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`;
}

// Per-tenant setting overrides. Read by lib/settings.ts when a tenant
// context is in scope. Empty value clears the override (falls back to
// global).
export async function getTenantSettings(
  tenantId: number,
): Promise<Record<string, string>> {
  if (!hasDb()) return {};
  await ensureSchema();
  const rows = await sql()`
    SELECT key, value FROM tenant_settings WHERE tenant_id = ${tenantId}`;
  const out: Record<string, string> = {};
  for (const r of rows) {
    out[(r as { key: string }).key] = (r as { value: string }).value;
  }
  return out;
}

export async function setTenantSetting(
  tenantId: number,
  key: string,
  value: string,
  actorId?: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  if (value === "") {
    await sql()`
      DELETE FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND key = ${key}`;
    return;
  }
  await sql()`
    INSERT INTO tenant_settings (tenant_id, key, value, updated_by, updated_at)
    VALUES (${tenantId}, ${key}, ${value}, ${actorId ?? null}, NOW())
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`;
}

// --- Audit ---

export async function audit(args: {
  actorId: number | null;
  actorName?: string | null;
  action: string;
  target?: string | null;
  details?: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO audit_log (actor_id, actor_name, action, target, details)
    VALUES (${args.actorId ?? null}, ${args.actorName ?? null}, ${args.action},
            ${args.target ?? null}, ${JSON.stringify(args.details ?? null)}::jsonb)`;
}

// --- System errors (the "fire department" side of System Log) ---

export type SystemErrorLevel = "warn" | "error";
export type SystemErrorRow = {
  id: number;
  createdAt: Date;
  level: SystemErrorLevel;
  source: string;
  message: string;
  stack: string | null;
  scope: string | null;
  details: unknown;
};

let logSystemErrorWriteCounter = 0;

export async function logSystemError(args: {
  source: string;
  message: string;
  level?: SystemErrorLevel;
  stack?: string | null;
  scope?: string | null;
  details?: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  try {
    await sql()`
      INSERT INTO system_errors (level, source, message, stack, scope, details)
      VALUES (
        ${args.level ?? "error"},
        ${args.source.slice(0, 120)},
        ${args.message.slice(0, 4000)},
        ${args.stack ? args.stack.slice(0, 8000) : null},
        ${args.scope ? args.scope.slice(0, 200) : null},
        ${JSON.stringify(args.details ?? null)}::jsonb
      )`;
    logSystemErrorWriteCounter++;
    // Opportunistic prune: every 200th write, drop rows older than 30 days.
    if (logSystemErrorWriteCounter % 200 === 0) {
      await sql()`DELETE FROM system_errors WHERE created_at < NOW() - INTERVAL '30 days'`;
    }
  } catch (err) {
    // Never let logging crash the caller.
    console.warn("[system_errors] insert failed:", err);
  }
}

// Convenience helper: log an Error or unknown caught value. Pulls
// message + stack automatically so callers can pass the raw caught
// value without type-narrowing.
export async function captureError(args: {
  source: string;
  error: unknown;
  scope?: string | null;
  details?: unknown;
  level?: SystemErrorLevel;
}): Promise<void> {
  const e = args.error;
  let message: string;
  let stack: string | null = null;
  if (e instanceof Error) {
    message = e.message || e.name || "Unknown error";
    stack = e.stack ?? null;
  } else if (typeof e === "string") {
    message = e;
  } else {
    try {
      message = JSON.stringify(e);
    } catch {
      message = String(e);
    }
  }
  await logSystemError({
    source: args.source,
    level: args.level ?? "error",
    message,
    stack,
    scope: args.scope ?? null,
    details: args.details ?? null,
  });
}

export async function listSystemErrors(opts: {
  limit?: number;
  level?: SystemErrorLevel | null;
  source?: string | null;
  q?: string | null;
  sinceDays?: number | null;
} = {}): Promise<SystemErrorRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const like = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const days = opts.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : null;
  const rows = await sql()`
    SELECT id, created_at, level, source, message, stack, scope, details
    FROM system_errors
    WHERE (${opts.level ?? null}::text IS NULL OR level = ${opts.level ?? null})
      AND (${opts.source ?? null}::text IS NULL OR source = ${opts.source ?? null})
      AND (${days}::int IS NULL OR created_at > NOW() - make_interval(days => ${days}))
      AND (
        ${like}::text IS NULL
        OR message ILIKE ${like}
        OR COALESCE(stack, '') ILIKE ${like}
        OR COALESCE(scope, '') ILIKE ${like}
      )
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    createdAt: r.created_at as Date,
    level: (r.level as SystemErrorLevel) ?? "error",
    source: (r.source as string) ?? "",
    message: (r.message as string) ?? "",
    stack: (r.stack as string) ?? null,
    scope: (r.scope as string) ?? null,
    details: r.details ?? null,
  }));
}

export async function systemErrorSourceBuckets(): Promise<
  Array<{ source: string; count: number }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT source, COUNT(*)::int AS cnt
    FROM system_errors
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY source
    ORDER BY cnt DESC`;
  return (rows as Array<{ source: string; cnt: number }>).map((r) => ({
    source: r.source,
    count: Number(r.cnt),
  }));
}

export type CostByPurpose = {
  purpose: string;
  calls: number;
  totalCostUsd: number;
  totalTokens: number;
};

export async function aiUsageByPurpose(
  daysBack = 30,
): Promise<CostByPurpose[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT purpose,
           COUNT(*)::int AS calls,
           COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COALESCE(SUM(total_tokens), 0)::int AS tokens
    FROM ai_usage
    WHERE created_at > NOW() - make_interval(days => ${daysBack})
    GROUP BY purpose
    ORDER BY cost DESC`;
  return rows.map((r) => ({
    purpose: r.purpose as string,
    calls: Number(r.calls) || 0,
    totalCostUsd: Number(r.cost) || 0,
    totalTokens: Number(r.tokens) || 0,
  }));
}

export type CostByModel = {
  model: string;
  calls: number;
  totalCostUsd: number;
  totalTokens: number;
};

export async function aiUsageByModel(
  daysBack = 30,
): Promise<CostByModel[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT model,
           COUNT(*)::int AS calls,
           COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COALESCE(SUM(total_tokens), 0)::int AS tokens
    FROM ai_usage
    WHERE created_at > NOW() - make_interval(days => ${daysBack})
    GROUP BY model
    ORDER BY cost DESC`;
  return rows.map((r) => ({
    model: r.model as string,
    calls: Number(r.calls) || 0,
    totalCostUsd: Number(r.cost) || 0,
    totalTokens: Number(r.tokens) || 0,
  }));
}

export type CostByDay = {
  day: string;
  totalCostUsd: number;
  calls: number;
};

export async function aiUsageByDay(daysBack = 14): Promise<CostByDay[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT DATE(created_at AT TIME ZONE 'UTC') AS day,
           COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COUNT(*)::int AS calls
    FROM ai_usage
    WHERE created_at > NOW() - make_interval(days => ${daysBack})
    GROUP BY 1
    ORDER BY 1`;
  return rows.map((r) => ({
    day:
      r.day instanceof Date
        ? (r.day as Date).toISOString().slice(0, 10)
        : String(r.day),
    totalCostUsd: Number(r.cost) || 0,
    calls: Number(r.calls) || 0,
  }));
}

// --- Invites (short tokens for /start payloads) ---

export type InvitePayload = Record<string, unknown>;

export async function createInvite(args: {
  token: string;
  purpose: string;
  payload: InvitePayload;
  ttlSeconds: number;
  createdBy?: number | null;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO invites (token, purpose, payload, expires_at, created_by)
    VALUES (
      ${args.token}, ${args.purpose}, ${JSON.stringify(args.payload)}::jsonb,
      NOW() + make_interval(secs => ${args.ttlSeconds}),
      ${args.createdBy ?? null}
    )`;
}

export async function consumeInvite(
  token: string,
  usedBy: number,
): Promise<{ purpose: string; payload: InvitePayload } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE invites
    SET used_at = NOW(), used_by = ${usedBy}
    WHERE token = ${token}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING purpose, payload`;
  const r = rows[0] as { purpose: string; payload: InvitePayload } | undefined;
  return r ? { purpose: r.purpose, payload: r.payload } : null;
}

export async function chatModeCounts(): Promise<Record<ChatMode, number>> {
  const empty: Record<ChatMode, number> = {
    off: 0,
    secretary: 0,
    auto_reply: 0,
    friendly_reply: 0,
    ai_chat: 0,
    ai_listen: 0,
  };
  if (!hasDb()) return empty;
  await ensureSchema();
  const rows = await sql()`
    SELECT mode, COUNT(*)::int AS n FROM chat_rules GROUP BY mode`;
  for (const r of rows) {
    const m = (r as { mode: string; n: number }).mode as ChatMode;
    if (CHAT_MODES.includes(m)) empty[m] = Number((r as { n: number }).n) || 0;
  }
  return empty;
}
