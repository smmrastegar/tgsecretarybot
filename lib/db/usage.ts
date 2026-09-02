// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";

// --- AI usage tracking ---

export type AiUsage = {
  chatId?: number | null;
  businessConnectionId?: string | null;
  model: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export async function recordAiUsage(u: AiUsage): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Pull tenant from AsyncLocalStorage when set. Avoids requiring
  // every caller to thread tenantId — the budget gate at the call
  // site relies on this row being attributed correctly.
  const { getCurrentTenantId } = await import("../tenant-context");
  const tenantId = getCurrentTenantId();
  await sql()`
    INSERT INTO ai_usage (
      chat_id, business_connection_id, model, purpose,
      prompt_tokens, completion_tokens, total_tokens, cost_usd, tenant_id
    ) VALUES (
      ${u.chatId ?? null}, ${u.businessConnectionId ?? null}, ${u.model}, ${u.purpose},
      ${u.promptTokens}, ${u.completionTokens}, ${u.totalTokens}, ${u.costUsd},
      ${tenantId ?? null}
    )`;
  // Keep the openrouter budget cache in sync so a flurry of calls in
  // the same instance sees the new spend without waiting for the 10s
  // TTL. Imported lazily to avoid a circular require.
  if (tenantId != null && u.costUsd > 0) {
    const { bumpOpenrouterSpent } = await import("../openrouter-budget");
    bumpOpenrouterSpent(tenantId, u.costUsd);
  }
}

// --- HikerAPI per-call cost log ---

export async function recordHikerCall(args: {
  endpoint: string;
  costUsd: number;
  accountId?: number | null;
  tenantId?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    INSERT INTO hikerapi_usage (endpoint, cost_usd, account_id, tenant_id)
    VALUES (${args.endpoint}, ${args.costUsd.toFixed(6)},
            ${args.accountId ?? null}, ${args.tenantId ?? null})`;
}

// Tenant-scoped total spend — used by hikerapi-budget.ts.
export async function getHikerSpentForTenant(tenantId: number): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
    FROM hikerapi_usage
    WHERE tenant_id = ${tenantId}`;
  const r = rows[0] as { total: number } | undefined;
  return r ? Number(r.total) : 0;
}

// Legacy global helper — used by admin views and the global usage
// summary. Filters by tenant when provided.
export async function getHikerTotalSpent(tenantId?: number | null): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows =
    tenantId != null
      ? await sql()`
          SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
          FROM hikerapi_usage
          WHERE tenant_id = ${tenantId}`
      : await sql()`SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total FROM hikerapi_usage`;
  const r = rows[0] as { total: number } | undefined;
  return r ? Number(r.total) : 0;
}

export async function getHikerSpentBuckets(args: {
  bucket: "hour" | "day" | "week" | "month";
  since: Date;
  tenantId?: number | null;
}): Promise<Array<{ at: Date; calls: number; costUsd: number }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const truncFn =
    args.bucket === "hour"
      ? "hour"
      : args.bucket === "day"
        ? "day"
        : args.bucket === "week"
          ? "week"
          : "month";
  const rows =
    args.tenantId != null
      ? await sql()`
          SELECT date_trunc(${truncFn}, called_at) AS at,
                 COUNT(*)::int AS calls,
                 COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
          FROM hikerapi_usage
          WHERE called_at >= ${args.since.toISOString()}::timestamptz
            AND tenant_id = ${args.tenantId}
          GROUP BY 1
          ORDER BY 1 ASC`
      : await sql()`
          SELECT date_trunc(${truncFn}, called_at) AS at,
                 COUNT(*)::int AS calls,
                 COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
          FROM hikerapi_usage
          WHERE called_at >= ${args.since.toISOString()}::timestamptz
          GROUP BY 1
          ORDER BY 1 ASC`;
  return (rows as Array<{ at: Date; calls: number; cost_usd: number }>).map(
    (r) => ({ at: r.at, calls: r.calls, costUsd: Number(r.cost_usd) }),
  );
}

export async function getHikerWindowSummary(
  since: Date | null,
  tenantId?: number | null,
): Promise<{ calls: number; costUsd: number }> {
  if (!hasDb()) return { calls: 0, costUsd: 0 };
  await ensureSchema();
  let rows;
  if (since && tenantId != null) {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage
      WHERE called_at >= ${since.toISOString()}::timestamptz
        AND tenant_id = ${tenantId}`;
  } else if (since) {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage
      WHERE called_at >= ${since.toISOString()}::timestamptz`;
  } else if (tenantId != null) {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage
      WHERE tenant_id = ${tenantId}`;
  } else {
    rows = await sql()`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM hikerapi_usage`;
  }
  const r = rows[0] as { calls: number; cost_usd: number } | undefined;
  return r ? { calls: r.calls, costUsd: Number(r.cost_usd) } : { calls: 0, costUsd: 0 };
}

export async function listRecentHikerCalls(
  limit = 30,
  tenantId?: number | null,
): Promise<Array<{ id: number; calledAt: Date; endpoint: string; costUsd: number; accountId: number | null }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows =
    tenantId != null
      ? await sql()`
          SELECT id, called_at, endpoint, cost_usd::float8 AS cost_usd, account_id
          FROM hikerapi_usage
          WHERE tenant_id = ${tenantId}
          ORDER BY called_at DESC
          LIMIT ${limit}`
      : await sql()`
          SELECT id, called_at, endpoint, cost_usd::float8 AS cost_usd, account_id
          FROM hikerapi_usage
          ORDER BY called_at DESC
          LIMIT ${limit}`;
  return (rows as Array<{
    id: string;
    called_at: Date;
    endpoint: string;
    cost_usd: number;
    account_id: string | null;
  }>).map((r) => ({
    id: Number(r.id),
    calledAt: r.called_at,
    endpoint: r.endpoint,
    costUsd: Number(r.cost_usd),
    accountId: r.account_id == null ? null : Number(r.account_id),
  }));
}

// Story-detection event log. story_id is whatever the source API
// returned (could be a string, a numeric id, or our hash). Used to
// dedupe so we don't forward the same story twice.
export type MonitorEvent = {
  id: number;
  accountId: number;
  storyId: string | null;
  storyUrl: string | null;
  detectedAt: Date;
  forwardedChatId: number | null;
  forwardedMessageId: number | null;
  forwardedAt: Date | null;
  status: string;
  error: string | null;
};

export async function recordMonitorEvent(args: {
  accountId: number;
  storyId: string;
  storyUrl: string | null;
  kind?: string;
  caption?: string | null;
  mediaType?: string | null;
  tenantId?: number | null;
}): Promise<MonitorEvent | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO monitor_events (
      account_id, story_id, story_url, kind, caption, media_type, status,
      tenant_id
    )
    VALUES (${args.accountId}, ${args.storyId}, ${args.storyUrl},
            ${args.kind ?? "story"}, ${args.caption ?? null},
            ${args.mediaType ?? null}, 'detected',
            ${args.tenantId ?? null})
    ON CONFLICT (account_id, story_id) DO NOTHING
    RETURNING id, account_id, story_id, story_url, detected_at,
              forwarded_chat_id, forwarded_message_id, forwarded_at, status, error`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    storyId: (r.story_id as string) ?? null,
    storyUrl: (r.story_url as string) ?? null,
    detectedAt: r.detected_at as Date,
    forwardedChatId:
      r.forwarded_chat_id != null ? Number(r.forwarded_chat_id) : null,
    forwardedMessageId:
      r.forwarded_message_id != null ? Number(r.forwarded_message_id) : null,
    forwardedAt: (r.forwarded_at as Date) ?? null,
    status: r.status as string,
    error: (r.error as string) ?? null,
  };
}

export async function markMonitorEventForwarded(args: {
  id: number;
  chatId: number;
  messageId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitor_events
    SET forwarded_chat_id = ${args.chatId},
        forwarded_message_id = ${args.messageId},
        forwarded_at = NOW(),
        status = 'forwarded'
    WHERE id = ${args.id}`;
}

export async function markMonitorEventError(args: {
  id: number;
  error: string;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitor_events
    SET status = 'error', error = ${args.error}
    WHERE id = ${args.id}`;
}

export async function listRecentMonitorEvents(
  limit = 50,
  tenantId?: number | null,
  offset = 0,
): Promise<
  Array<MonitorEvent & { username: string | null; platform: string | null }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT e.id, e.account_id, e.story_id, e.story_url, e.detected_at,
           e.forwarded_chat_id, e.forwarded_message_id, e.forwarded_at,
           e.status, e.error,
           a.username, a.platform
    FROM monitor_events e
    LEFT JOIN monitored_accounts a ON a.id = e.account_id
    WHERE (${tenantId ?? null}::bigint IS NULL OR e.tenant_id = ${tenantId ?? null})
    ORDER BY e.detected_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
    OFFSET ${Math.max(offset, 0)}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    accountId: Number(r.account_id),
    storyId: (r.story_id as string) ?? null,
    storyUrl: (r.story_url as string) ?? null,
    detectedAt: r.detected_at as Date,
    forwardedChatId:
      r.forwarded_chat_id != null ? Number(r.forwarded_chat_id) : null,
    forwardedMessageId:
      r.forwarded_message_id != null ? Number(r.forwarded_message_id) : null,
    forwardedAt: (r.forwarded_at as Date) ?? null,
    status: r.status as string,
    error: (r.error as string) ?? null,
    username: (r.username as string) ?? null,
    platform: (r.platform as string) ?? null,
  }));
}

// Telegram retries the webhook if we don't ACK within ~25s. With slow
// AI calls + sendChatAction delays we can hit that, and the retry
// would otherwise re-run the handler and produce a duplicate reply
// (sometimes landing several messages later in the chat). Insert
// every update_id once; if it's already there, drop the retry.
// Returns true if the update is new, false if it's a duplicate.
export async function markUpdateProcessed(
  updateId: number,
  meta?: {
    updateType?: string | null;
    chatId?: number | null;
    preview?: string | null;
  },
): Promise<boolean> {
  if (!hasDb()) return true;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO processed_updates (update_id, update_type, chat_id, preview)
    VALUES (
      ${updateId},
      ${meta?.updateType ?? null},
      ${meta?.chatId ?? null},
      ${(meta?.preview ?? null)?.slice(0, 200) ?? null}
    )
    ON CONFLICT (update_id) DO NOTHING
    RETURNING update_id`;
  return rows.length > 0;
}

export async function recentUpdateCounts(
  windowMinutes = 60,
): Promise<{
  total: number;
  byType: Record<string, number>;
  recent: Array<{
    updateId: number;
    updateType: string | null;
    chatId: number | null;
    preview: string | null;
    processedAt: Date;
  }>;
}> {
  if (!hasDb()) {
    return { total: 0, byType: {}, recent: [] };
  }
  await ensureSchema();
  const rows = (await sql()`
    SELECT update_id, update_type, chat_id, preview, processed_at
    FROM processed_updates
    WHERE processed_at > NOW() - (${windowMinutes} || ' minutes')::INTERVAL
    ORDER BY processed_at DESC
    LIMIT 50`) as Array<{
    update_id: string;
    update_type: string | null;
    chat_id: string | null;
    preview: string | null;
    processed_at: Date;
  }>;
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const k = r.update_type ?? "(unknown)";
    byType[k] = (byType[k] ?? 0) + 1;
  }
  return {
    total: rows.length,
    byType,
    recent: rows.map((r) => ({
      updateId: Number(r.update_id),
      updateType: r.update_type,
      chatId: r.chat_id != null ? Number(r.chat_id) : null,
      preview: r.preview,
      processedAt: r.processed_at,
    })),
  };
}
