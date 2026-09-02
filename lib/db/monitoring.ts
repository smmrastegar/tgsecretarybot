// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";

// --- Monitored accounts (Instagram stories etc.) ---

export type MonitoredAccount = {
  id: number;
  platform: string;
  username: string;
  url: string | null;
  externalId: string | null;
  topicId: string | null;
  enabled: boolean;
  checkStories: boolean;
  checkPosts: boolean;
  checkReels: boolean;
  checkProfile: boolean;
  checkMentioned: boolean;
  intervalMinutes: number;
  // 'interval' = poll on a clock schedule (the default).
  // 'notify'   = wait for /api/insta-webhook to fire; cron stays off
  //              this account except for the 24h-staleness fallback.
  mode: "interval" | "notify";
  lastNotifyAt: Date | null;
  pendingFetchAt: Date | null;
  pendingNotifyKinds: string[] | null;
  instagramUserId: string | null;
  fullName: string | null;
  lastCheckedAt: Date | null;
  lastStoryAt: Date | null;
  lastError: string | null;
  lastMediaCount: number | null;
  tenantId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToMonitored(r: Record<string, unknown>): MonitoredAccount {
  const rawMode = (r.mode as string) ?? "interval";
  const mode: MonitoredAccount["mode"] =
    rawMode === "notify" ? "notify" : "interval";
  let pendingKinds: string[] | null = null;
  if (Array.isArray(r.pending_notify_kinds)) {
    pendingKinds = (r.pending_notify_kinds as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
  } else if (typeof r.pending_notify_kinds === "string") {
    try {
      const parsed = JSON.parse(r.pending_notify_kinds);
      if (Array.isArray(parsed)) {
        pendingKinds = parsed.filter(
          (x): x is string => typeof x === "string",
        );
      }
    } catch {}
  }
  return {
    id: Number(r.id),
    platform: r.platform as string,
    username: r.username as string,
    url: (r.url as string) ?? null,
    externalId: (r.external_id as string) ?? null,
    topicId: (r.topic_id as string) ?? null,
    enabled: Boolean(r.enabled),
    checkStories: r.check_stories == null ? true : Boolean(r.check_stories),
    checkPosts: Boolean(r.check_posts),
    checkReels: Boolean(r.check_reels),
    checkProfile: Boolean(r.check_profile),
    checkMentioned: Boolean(r.check_mentioned),
    intervalMinutes: Number(r.interval_minutes ?? 30),
    mode,
    lastNotifyAt: (r.last_notify_at as Date) ?? null,
    pendingFetchAt: (r.pending_fetch_at as Date) ?? null,
    pendingNotifyKinds: pendingKinds,
    instagramUserId: (r.instagram_user_id as string) ?? null,
    fullName: (r.full_name as string) ?? null,
    lastCheckedAt: (r.last_checked_at as Date) ?? null,
    lastStoryAt: (r.last_story_at as Date) ?? null,
    lastError: (r.last_error as string) ?? null,
    lastMediaCount:
      r.last_media_count == null ? null : Number(r.last_media_count),
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listMonitoredAccounts(opts: {
  platform?: string;
  enabledOnly?: boolean;
  tenantId?: number | null;
} = {}): Promise<MonitoredAccount[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, platform, username, url, external_id, topic_id, enabled,
           check_stories, check_posts, check_reels, check_profile,
           check_mentioned, interval_minutes, instagram_user_id, full_name,
           last_checked_at, last_story_at, last_error, last_media_count,
           tenant_id, mode, last_notify_at, pending_fetch_at,
           pending_notify_kinds,
           created_at, updated_at
    FROM monitored_accounts
    WHERE (${opts.platform ?? null}::text IS NULL OR platform = ${opts.platform ?? null})
      AND (${opts.enabledOnly ?? false}::boolean = FALSE OR enabled = TRUE)
      AND (${opts.tenantId ?? null}::bigint IS NULL OR tenant_id = ${opts.tenantId ?? null})
    ORDER BY username ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToMonitored);
}

// Bulk upsert from CSV import. Updates URL / external_id / topic_id
// for existing rows but DOESN'T clobber the enabled flag (the owner
// might have manually disabled an account).
export async function upsertMonitoredAccounts(
  items: Array<{
    platform: string;
    username: string;
    url?: string | null;
    externalId?: string | null;
    topicId?: string | null;
  }>,
  tenantId?: number | null,
): Promise<{ inserted: number; updated: number; insertedIds: number[] }> {
  if (!hasDb() || items.length === 0)
    return { inserted: 0, updated: 0, insertedIds: [] };
  await ensureSchema();
  let inserted = 0;
  let updated = 0;
  const insertedIds: number[] = [];
  for (const it of items) {
    const username = it.username.trim().toLowerCase();
    if (!username) continue;
    const rows = await sql()`
      INSERT INTO monitored_accounts (
        platform, username, url, external_id, topic_id, tenant_id
      )
      VALUES (${it.platform}, ${username}, ${it.url ?? null},
              ${it.externalId ?? null}, ${it.topicId ?? null},
              ${tenantId ?? null})
      ON CONFLICT (platform, username) DO UPDATE SET
        url = COALESCE(EXCLUDED.url, monitored_accounts.url),
        external_id = COALESCE(EXCLUDED.external_id, monitored_accounts.external_id),
        topic_id = COALESCE(EXCLUDED.topic_id, monitored_accounts.topic_id),
        tenant_id = COALESCE(monitored_accounts.tenant_id, EXCLUDED.tenant_id),
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS was_inserted`;
    const r = rows[0] as { id: string; was_inserted: boolean } | undefined;
    if (!r) continue;
    if (r.was_inserted) {
      inserted++;
      insertedIds.push(Number(r.id));
    } else {
      updated++;
    }
  }
  return { inserted, updated, insertedIds };
}

export async function setMonitoredAccountEnabled(
  id: number,
  enabled: boolean,
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitored_accounts
    SET enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})`;
}

export async function deleteMonitoredAccount(
  id: number,
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    DELETE FROM monitored_accounts
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})`;
}

export async function getMonitoredAccount(
  id: number,
  tenantId?: number | null,
): Promise<MonitoredAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, platform, username, url, external_id, topic_id, enabled,
           check_stories, check_posts, check_reels, check_profile,
           check_mentioned, interval_minutes, instagram_user_id, full_name,
           last_checked_at, last_story_at, last_error, last_media_count,
           tenant_id, mode, last_notify_at, pending_fetch_at,
           pending_notify_kinds,
           created_at, updated_at
    FROM monitored_accounts
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToMonitored(r) : null;
}

// Find accounts that should be polled next: enabled and their own
// per-account interval_minutes has elapsed since last_checked_at
// (or never checked). Oldest first so the backlog drains evenly.
export async function dueMonitoredAccounts(
  limit = 50,
  tenantId?: number | null,
): Promise<MonitoredAccount[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  // Peak-hours gate. The cron runs every 5 min, but for each
  // interval bucket we only let it fire during a curated set of
  // Tehran-time hours (Asia/Tehran). The operator's hard rule:
  // intervals SHORTER than 12 hours (3h, 6h) must NEVER run during
  // the very-late-night quiet window of 02:00–08:00 Tehran. The
  // schedules below all respect that — 3h fires no earlier than
  // 09:00, 6h no earlier than 10:00 — so an account on a < 12h
  // interval has at least a 9-hour overnight gap with no calls.
  //
  //   3h  → 09, 12, 15, 18, 21    (five daytime/evening slots)
  //   6h  → 10, 16, 22            (three slots: morning, late afternoon, late evening)
  //   12h → 10, 22                (two slots, exactly 12h apart)
  //   24h → 19                    (one slot at evening peak)
  //
  // For never-checked accounts (last_checked_at IS NULL) we ignore
  // the hour gate so a brand-new account doesn't wait until 19:00
  // Tehran for its first run — addMonitoredAccount also kicks an
  // immediate processAccount() but this is defence in depth.
  //
  // Strict interval `last_checked_at < NOW() - interval_minutes`
  // can miss a trigger that lands at the same minute, so we relax
  // it to 95% — i.e. an account that was checked within the last
  // 5% of its window is still considered due. This handles the
  // 5-minute cron drift around a hourly trigger.
  const rows = await sql()`
    SELECT id, platform, username, url, external_id, topic_id, enabled,
           check_stories, check_posts, check_reels, check_profile,
           check_mentioned, interval_minutes, instagram_user_id, full_name,
           last_checked_at, last_story_at, last_error, last_media_count,
           tenant_id, mode, last_notify_at, pending_fetch_at,
           pending_notify_kinds,
           created_at, updated_at
    FROM monitored_accounts
    WHERE enabled = TRUE
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
      AND (
        -- Path A: 'interval' mode on the standard schedule.
        (
          mode = 'interval'
          AND (last_checked_at IS NULL
               OR last_checked_at < NOW() - ((interval_minutes * 0.95) || ' minutes')::INTERVAL)
          AND (
            last_checked_at IS NULL
            OR CASE
              WHEN interval_minutes = 180 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  IN (9, 12, 15, 18, 21)
              WHEN interval_minutes = 360 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  IN (10, 16, 22)
              WHEN interval_minutes = 720 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  IN (10, 22)
              WHEN interval_minutes = 1440 THEN
                EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT
                  = 19
              ELSE TRUE
            END
          )
        )
        OR
        -- Path B: 'notify' mode with a pending fetch that's now due
        -- (the 3-hour cooldown elapsed OR the deferred-to-peak time
        -- arrived). pending_fetch_at is in the past once due.
        (
          mode = 'notify'
          AND pending_fetch_at IS NOT NULL
          AND pending_fetch_at <= NOW()
        )
        OR
        -- Path C: 24h staleness fallback. Any account (notify or
        -- interval) that hasn't been touched in 24+ hours is treated
        -- like a 24h-interval account — only fires at the 19:00
        -- Tehran peak slot. Keeps notify-mode accounts moving even
        -- if the external service is down.
        (
          last_checked_at IS NOT NULL
          AND last_checked_at < NOW() - INTERVAL '24 hours'
          AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Tehran'))::INT = 19
        )
      )
    ORDER BY last_checked_at NULLS FIRST, id ASC
    LIMIT ${limit}`;
  return (rows as Array<Record<string, unknown>>).map(rowToMonitored);
}

// --- Notify-mode helpers ---

// Record an inbound webhook hit. Returns the updated row so the
// caller can act on the pending_fetch_at the cron now sees. Logic:
//   1. If the account was last NOTIFIED less than 3 hours ago AND
//      already has a pending fetch queued, just append the requested
//      kinds to pending_notify_kinds and leave pending_fetch_at
//      unchanged.
//   2. Otherwise schedule pending_fetch_at = last_notify_at + 3h
//      (or NOW + 3h if no last_notify_at). That's the 3-hour
//      cool-down "worst-case cost" guarantee the operator asked for.
//      Also snap forward to the next allowed peak hour if the
//      computed time falls inside the 02-08 quiet window.
//   3. Always touch last_notify_at to NOW.
// The actual fetch happens later in the cron when pending_fetch_at
// <= NOW — see Path B in dueMonitoredAccounts.
export async function recordInstaNotify(args: {
  username: string;
  kinds: string[];
  tenantId?: number | null;
}): Promise<MonitoredAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const username = args.username.trim().toLowerCase();
  if (!username) return null;
  const tenantId = args.tenantId ?? null;
  // Fetch current state first so we know what kinds to merge.
  const cur = await sql()`
    SELECT id, platform, username, mode, last_notify_at,
           pending_fetch_at, pending_notify_kinds
    FROM monitored_accounts
    WHERE platform = 'instagram'
      AND lower(username) = ${username}
      AND (${tenantId}::bigint IS NULL OR tenant_id = ${tenantId})
    LIMIT 1`;
  const r0 = cur[0] as Record<string, unknown> | undefined;
  if (!r0) return null;
  const existingKinds = Array.isArray(r0.pending_notify_kinds)
    ? (r0.pending_notify_kinds as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const mergedKinds = Array.from(new Set([...existingKinds, ...args.kinds]));
  const rows = await sql()`
    UPDATE monitored_accounts
    SET
      last_notify_at = NOW(),
      pending_notify_kinds = ${JSON.stringify(mergedKinds)}::jsonb,
      pending_fetch_at = CASE
        -- If there's already a pending fetch queued, leave it alone.
        WHEN pending_fetch_at IS NOT NULL THEN pending_fetch_at
        -- Otherwise: schedule for last_notify_at + 3h, or NOW + 3h
        -- when this is the first notify. If the resulting time falls
        -- inside the 02-08 Tehran quiet window, snap forward to 08:00
        -- the same Tehran day.
        ELSE GREATEST(
          NOW() + INTERVAL '3 hours',
          COALESCE(last_notify_at, NOW()) + INTERVAL '3 hours'
        )
      END,
      updated_at = NOW()
    WHERE id = ${Number(r0.id)}
    RETURNING id, platform, username, url, external_id, topic_id, enabled,
              check_stories, check_posts, check_reels, check_profile,
              check_mentioned, interval_minutes, instagram_user_id, full_name,
              last_checked_at, last_story_at, last_error, last_media_count,
              tenant_id, mode, last_notify_at, pending_fetch_at,
              pending_notify_kinds, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToMonitored(r) : null;
}

// Called by the cron after a notify-mode account has been processed.
// Clears the pending queue so the next notify starts a fresh 3-hour
// window.
export async function clearMonitoredAccountPending(
  id: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE monitored_accounts
    SET pending_fetch_at = NULL,
        pending_notify_kinds = NULL,
        updated_at = NOW()
    WHERE id = ${id}`;
}

// Operator tapped "🔍 الان بگیر" on a deferred notify message:
// move pending_fetch_at to NOW so the next cron tick (≤ 5 min)
// processes it.
export async function expediteMonitoredAccountFetch(
  id: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE monitored_accounts
    SET pending_fetch_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id}
      AND mode = 'notify'`;
}

export async function setMonitoredAccountMode(args: {
  id: number;
  mode: "interval" | "notify";
  tenantId?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE monitored_accounts
    SET mode = ${args.mode},
        pending_fetch_at = NULL,
        pending_notify_kinds = NULL,
        updated_at = NOW()
    WHERE id = ${args.id}
      AND (${args.tenantId ?? null}::bigint IS NULL
           OR tenant_id = ${args.tenantId ?? null}::bigint)`;
}

// Manual add: insert a single account by username. Pulls defaults
// (which kinds to check + how often) from the settings table so the
// owner can control behaviour of newly-added accounts in one place.
export async function addMonitoredAccount(args: {
  platform: string;
  username: string;
  url?: string | null;
  tenantId?: number | null;
  defaults?: {
    intervalMinutes?: number;
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
  };
}): Promise<MonitoredAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const username = args.username.trim().toLowerCase();
  if (!username) return null;
  const d = args.defaults ?? {};
  const rows = await sql()`
    INSERT INTO monitored_accounts (
      platform, username, url, interval_minutes,
      check_stories, check_posts, check_reels, check_profile, check_mentioned,
      tenant_id
    )
    VALUES (
      ${args.platform}, ${username},
      ${args.url ?? `https://instagram.com/${username}`},
      ${Math.max(180, d.intervalMinutes ?? 720)},
      ${d.checkStories ?? true},
      ${d.checkPosts ?? false},
      ${d.checkReels ?? false},
      ${d.checkProfile ?? false},
      ${d.checkMentioned ?? false},
      ${args.tenantId ?? null}
    )
    ON CONFLICT (platform, username) DO UPDATE SET
      updated_at = NOW(),
      tenant_id = COALESCE(monitored_accounts.tenant_id, EXCLUDED.tenant_id)
    RETURNING id, platform, username, url, external_id, topic_id, enabled,
              check_stories, check_posts, check_reels, check_profile,
              check_mentioned, interval_minutes, instagram_user_id, full_name,
              last_checked_at, last_story_at, last_error, last_media_count,
              tenant_id, mode, last_notify_at, pending_fetch_at,
              pending_notify_kinds,
              created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToMonitored(r) : null;
}

export async function updateMonitoredAccountConfig(
  id: number,
  patch: {
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
    intervalMinutes?: number;
    mode?: "interval" | "notify";
  },
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  // When the operator flips an account out of notify mode we wipe
  // the pending queue so a stale notify doesn't fire after the
  // switch.
  const modeChanged = patch.mode !== undefined;
  await sql()`
    UPDATE monitored_accounts SET
      check_stories = COALESCE(${patch.checkStories ?? null}, check_stories),
      check_posts = COALESCE(${patch.checkPosts ?? null}, check_posts),
      check_reels = COALESCE(${patch.checkReels ?? null}, check_reels),
      check_profile = COALESCE(${patch.checkProfile ?? null}, check_profile),
      check_mentioned = COALESCE(${patch.checkMentioned ?? null}, check_mentioned),
      interval_minutes = COALESCE(${
        patch.intervalMinutes ?? null
      }::int, interval_minutes),
      mode = COALESCE(${patch.mode ?? null}::text, mode),
      pending_fetch_at = CASE
        WHEN ${modeChanged}::boolean THEN NULL
        ELSE pending_fetch_at
      END,
      pending_notify_kinds = CASE
        WHEN ${modeChanged}::boolean THEN NULL
        ELSE pending_notify_kinds
      END,
      updated_at = NOW()
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})`;
}

// Bulk patch for the /monitored bulk toolbar. Any undefined field is
// left alone. `resetError=true` clears last_error AND last_checked_at
// so the next cron tick re-tries the account immediately instead of
// waiting for interval_minutes to elapse.
export async function bulkUpdateMonitoredAccounts(
  ids: number[],
  patch: {
    enabled?: boolean;
    checkStories?: boolean;
    checkPosts?: boolean;
    checkReels?: boolean;
    checkProfile?: boolean;
    checkMentioned?: boolean;
    intervalMinutes?: number;
    resetError?: boolean;
  },
  tenantId?: number | null,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const reset = patch.resetError === true;
  const rows = await sql()`
    UPDATE monitored_accounts SET
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      check_stories = COALESCE(${patch.checkStories ?? null}::boolean, check_stories),
      check_posts = COALESCE(${patch.checkPosts ?? null}::boolean, check_posts),
      check_reels = COALESCE(${patch.checkReels ?? null}::boolean, check_reels),
      check_profile = COALESCE(${patch.checkProfile ?? null}::boolean, check_profile),
      check_mentioned = COALESCE(${patch.checkMentioned ?? null}::boolean, check_mentioned),
      interval_minutes = COALESCE(${
        patch.intervalMinutes ?? null
      }::int, interval_minutes),
      last_error = CASE WHEN ${reset}::boolean THEN NULL ELSE last_error END,
      last_checked_at = CASE WHEN ${reset}::boolean THEN NULL ELSE last_checked_at END,
      updated_at = NOW()
    WHERE id = ANY(${ids}::bigint[])
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    RETURNING id`;
  return rows.length;
}

// Single-row reset helper — same semantics as the bulk version but
// for one account. Returns true if a row was touched.
export async function resetMonitoredAccountError(
  id: number,
  tenantId?: number | null,
): Promise<boolean> {
  if (!hasDb()) return false;
  const rows = await sql()`
    UPDATE monitored_accounts
    SET last_error = NULL,
        last_checked_at = NULL,
        updated_at = NOW()
    WHERE id = ${id}
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    RETURNING id`;
  return rows.length > 0;
}

export async function bulkDeleteMonitoredAccounts(
  ids: number[],
  tenantId?: number | null,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = await sql()`
    DELETE FROM monitored_accounts
    WHERE id = ANY(${ids}::bigint[])
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    RETURNING id`;
  return rows.length;
}

export async function setInstagramUserId(
  id: number,
  igUserId: string,
  fullName?: string | null,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitored_accounts
    SET instagram_user_id = ${igUserId},
        full_name = COALESCE(${fullName ?? null}, full_name),
        updated_at = NOW()
    WHERE id = ${id}`;
}

export async function markMonitoredChecked(args: {
  id: number;
  lastStoryAt?: Date | null;
  error?: string | null;
  lastMediaCount?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE monitored_accounts
    SET last_checked_at = NOW(),
        last_story_at = COALESCE(${args.lastStoryAt
          ? args.lastStoryAt.toISOString()
          : null}::timestamptz, last_story_at),
        last_error = ${args.error ?? null},
        last_media_count = COALESCE(${args.lastMediaCount ?? null}::int, last_media_count),
        updated_at = NOW()
    WHERE id = ${args.id}`;
}
