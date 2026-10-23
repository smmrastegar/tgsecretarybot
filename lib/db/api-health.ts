// How the outside music APIs (Spotify, SoundCloud) behave, counted per day: the call outcomes, the last time they said "limited" and
// for how long. Written by lib/api-health.ts, read by the daily metrics and the music dashboard.
import { ensureSchema, sql } from "./core";
import { num, numOrNull, str, strOrNull, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type ApiProvider = "spotify" | "soundcloud";
export type ApiOutcome = "ok" | "limited" | "error";
export type ApiDay = { day: string; provider: string; ok: number; limited: number; error: number; lastLimitedAt: string | null; lastRetryAfterS: number | null; lastError: string | null; lastOkAt: string | null };

export async function bumpApiHealth(provider: ApiProvider, outcome: ApiOutcome, info?: { retryAfterS?: number; error?: string }): Promise<void> {
  await ensureSchema();
  await q().query(
    `INSERT INTO api_health_daily (day, provider, ok, limited, error, last_limited_at, last_retry_after_s, last_error, last_ok_at)
     VALUES ((NOW() AT TIME ZONE 'Asia/Tehran')::date, $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (day, provider) DO UPDATE SET ok = api_health_daily.ok + $2, limited = api_health_daily.limited + $3, error = api_health_daily.error + $4,
       last_limited_at = COALESCE($5, api_health_daily.last_limited_at), last_retry_after_s = COALESCE($6, api_health_daily.last_retry_after_s),
       last_error = COALESCE($7, api_health_daily.last_error), last_ok_at = COALESCE($8, api_health_daily.last_ok_at)`,
    [provider, outcome === "ok" ? 1 : 0, outcome === "limited" ? 1 : 0, outcome === "error" ? 1 : 0,
      outcome === "limited" ? new Date().toISOString() : null, outcome === "limited" ? info?.retryAfterS ?? null : null,
      outcome === "error" ? (info?.error ?? "").slice(0, 200) || null : null, outcome === "ok" ? new Date().toISOString() : null],
  );
}

/** Rows for the last `days` Tehran days (newest first). */
export async function listApiHealth(days = 7): Promise<ApiDay[]> {
  await ensureSchema();
  const rows = (await q().query(
    `SELECT day::text AS day, provider, ok, limited, error, last_limited_at::text AS last_limited_at, last_retry_after_s, last_error, last_ok_at::text AS last_ok_at
       FROM api_health_daily WHERE day >= (NOW() AT TIME ZONE 'Asia/Tehran')::date - $1::int ORDER BY day DESC, provider`, [days])) as Row[];
  return rows.map((r) => ({ day: str(r, "day"), provider: str(r, "provider"), ok: num(r, "ok"), limited: num(r, "limited"), error: num(r, "error"), lastLimitedAt: strOrNull(r, "last_limited_at"), lastRetryAfterS: numOrNull(r, "last_retry_after_s"), lastError: strOrNull(r, "last_error"), lastOkAt: strOrNull(r, "last_ok_at") }));
}

export async function apiHealthForDay(day: string): Promise<ApiDay[]> {
  await ensureSchema();
  const rows = (await q().query(
    `SELECT day::text AS day, provider, ok, limited, error, last_limited_at::text AS last_limited_at, last_retry_after_s, last_error, last_ok_at::text AS last_ok_at FROM api_health_daily WHERE day = $1::date ORDER BY provider`, [day])) as Row[];
  return rows.map((r) => ({ day: str(r, "day"), provider: str(r, "provider"), ok: num(r, "ok"), limited: num(r, "limited"), error: num(r, "error"), lastLimitedAt: strOrNull(r, "last_limited_at"), lastRetryAfterS: numOrNull(r, "last_retry_after_s"), lastError: strOrNull(r, "last_error"), lastOkAt: strOrNull(r, "last_ok_at") }));
}
