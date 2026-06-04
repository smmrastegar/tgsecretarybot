// Integration with the external "change detector" service that polls
// Instagram cheaply on its own and webhooks us when something actually
// changes. The wire contract lives in docs/EXTERNAL_MONITOR_API.md.
//
// Flow:
//   1. Owner adds a monitored username on /monitored — we POST it to
//      the external service's /accounts so it knows to watch.
//   2. External service polls Instagram on its own schedule.
//   3. When it detects new content, it POSTs our /api/monitored/notify
//      with the username + kind. We then fire processAccount() with
//      HikerAPI to actually download + forward to the storage chat.
//   4. Owner removes the username → we DELETE /accounts/{username}.
//
// HMAC SHA-256 over the raw request body authenticates both directions.

import { createHmac, timingSafeEqual } from "node:crypto";
import { sql, hasDb, ensureSchema } from "./db";
import { getSettings } from "./settings";

export type ExternalMonitorConfig = {
  enabled: boolean;
  baseUrl: string;
  secret: string;
};

export async function getExternalMonitorConfig(): Promise<ExternalMonitorConfig> {
  const s = await getSettings();
  const enabled = (s.monitorExternalEnabled ?? "").toLowerCase() === "true";
  const baseUrl = (s.monitorExternalBaseUrl ?? "").trim().replace(/\/+$/, "");
  const secret = (s.monitorExternalSecret ?? "").trim();
  return { enabled, baseUrl, secret };
}

export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(args: {
  body: string;
  signature: string | null;
  secret: string;
}): boolean {
  if (!args.signature || !args.secret) return false;
  const expected = signBody(args.body, args.secret);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(args.signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function callExternal(args: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  const cfg = await getExternalMonitorConfig();
  if (!cfg.enabled || !cfg.baseUrl) {
    return { ok: false, status: 0, body: "external monitor disabled" };
  }
  const url = `${cfg.baseUrl}${args.path}`;
  const bodyStr = args.body == null ? "" : JSON.stringify(args.body);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (bodyStr) headers["Content-Type"] = "application/json";
  if (cfg.secret) {
    headers["X-Signature"] = signBody(bodyStr, cfg.secret);
  }
  const controller = new AbortController();
  const tid = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? 8000,
  );
  try {
    const res = await fetch(url, {
      method: args.method,
      headers,
      body: bodyStr || undefined,
      signal: controller.signal,
    });
    const txt = (await res.text()).slice(0, 500);
    return { ok: res.ok, status: res.status, body: txt };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(tid);
  }
}

// Register a username with the external service. Idempotent —
// re-registering an existing username is a no-op on their side
// (per the contract) and just refreshes our timestamp.
export async function registerAccount(args: {
  username: string;
  kinds?: { stories?: boolean; posts?: boolean; reels?: boolean; mentioned?: boolean };
}): Promise<{ ok: boolean; status: number; body: string }> {
  const username = args.username.trim().toLowerCase();
  if (!username) return { ok: false, status: 0, body: "empty username" };
  const result = await callExternal({
    method: "POST",
    path: "/accounts",
    body: {
      username,
      kinds: args.kinds ?? {
        stories: true,
        posts: true,
        reels: true,
        mentioned: false,
      },
    },
  });
  if (hasDb()) {
    await ensureSchema();
    await sql()`
      INSERT INTO monitor_subscriptions (username, last_pushed_at, last_status)
      VALUES (${username}, NOW(), ${result.status})
      ON CONFLICT (username) DO UPDATE SET
        last_pushed_at = NOW(),
        last_status = EXCLUDED.last_status,
        unregistered_at = NULL`;
  }
  return result;
}

export async function unregisterAccount(
  username: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const u = username.trim().toLowerCase();
  if (!u) return { ok: false, status: 0, body: "empty username" };
  const result = await callExternal({
    method: "DELETE",
    path: `/accounts/${encodeURIComponent(u)}`,
  });
  if (hasDb()) {
    await ensureSchema();
    await sql()`
      UPDATE monitor_subscriptions
      SET unregistered_at = NOW(),
          last_status = ${result.status}
      WHERE username = ${u}`;
  }
  return result;
}

export async function externalHealthCheck(): Promise<{
  ok: boolean;
  status: number;
  body: string;
  baseUrl: string | null;
}> {
  const cfg = await getExternalMonitorConfig();
  if (!cfg.enabled || !cfg.baseUrl) {
    return {
      ok: false,
      status: 0,
      body: "external monitor disabled or baseUrl unset",
      baseUrl: null,
    };
  }
  const res = await callExternal({
    method: "GET",
    path: "/health",
    timeoutMs: 5000,
  });
  return { ...res, baseUrl: cfg.baseUrl };
}

// Push every currently-enabled monitored account to the external
// service in one go. Used by the admin "sync all" button and on the
// first connect.
export async function syncAllAccounts(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ username: string; status: number; body: string }>;
}> {
  if (!hasDb()) {
    return { total: 0, succeeded: 0, failed: 0, errors: [] };
  }
  await ensureSchema();
  const rows = await sql()`
    SELECT DISTINCT username
    FROM monitored_accounts
    WHERE enabled = TRUE
    ORDER BY username ASC`;
  const usernames = (rows as Array<{ username: string }>).map(
    (r) => r.username,
  );
  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ username: string; status: number; body: string }> = [];
  for (const u of usernames) {
    const r = await registerAccount({ username: u });
    if (r.ok) succeeded++;
    else {
      failed++;
      errors.push({ username: u, status: r.status, body: r.body });
    }
  }
  return { total: usernames.length, succeeded, failed, errors };
}

export async function markNotified(username: string): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO monitor_subscriptions (username, last_notified_at, notify_count)
    VALUES (${username}, NOW(), 1)
    ON CONFLICT (username) DO UPDATE SET
      last_notified_at = NOW(),
      notify_count = monitor_subscriptions.notify_count + 1`;
}

export type SubscriptionRow = {
  username: string;
  registeredAt: Date;
  unregisteredAt: Date | null;
  lastPushedAt: Date | null;
  lastStatus: number | null;
  lastNotifiedAt: Date | null;
  notifyCount: number;
};

export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT username, registered_at, unregistered_at, last_pushed_at,
           last_status, last_notified_at, notify_count
    FROM monitor_subscriptions
    ORDER BY registered_at DESC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    username: r.username as string,
    registeredAt: r.registered_at as Date,
    unregisteredAt: (r.unregistered_at as Date) ?? null,
    lastPushedAt: (r.last_pushed_at as Date) ?? null,
    lastStatus: r.last_status == null ? null : Number(r.last_status),
    lastNotifiedAt: (r.last_notified_at as Date) ?? null,
    notifyCount: Number(r.notify_count ?? 0),
  }));
}
