import { ensureSchema, sql } from "./core";
import type { Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type LoginUser = { userId: number; username: string | null; firstName: string | null; lastName: string | null; photoUrl: null };

/** Returns false when too many unexpired requests are pending (flood guard). */
export async function createLoginRequest(nonceHash: string, secretHash: string, ttlSeconds = 300, kind: "dash" | "player" = "dash", invite: string | null = null): Promise<boolean> {
  await ensureSchema();
  await q().query(`DELETE FROM login_requests WHERE expires_at < NOW() - interval '1 hour'`);
  const pending = (await q().query(`SELECT COUNT(*)::int AS n FROM login_requests WHERE status = 'pending' AND expires_at > NOW()`)) as Row[];
  if (Number(pending[0]?.n ?? 0) >= 50) return false;
  await q().query(`INSERT INTO login_requests (nonce_hash, secret_hash, expires_at, kind, invite) VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4, $5)`, [nonceHash, secretHash, String(ttlSeconds), kind, invite]);
  return true;
}

/** Bot side: approve a pending, unexpired request. */
export async function approveLoginRequest(nonceHash: string, user: LoginUser, kind: "dash" | "player" = "dash"): Promise<boolean> {
  await ensureSchema();
  const r = (await q().query(
    `UPDATE login_requests SET status = 'approved', tg_user = $2::jsonb WHERE nonce_hash = $1 AND status = 'pending' AND kind = $3 AND expires_at > NOW() RETURNING 1`,
    [nonceHash, JSON.stringify(user), kind],
  )) as Row[];
  return r.length > 0;
}

/** Browser side: pending / approved (single use: flips to consumed) / expired / unknown. */
export async function pollLoginRequest(nonceHash: string, secretHash: string): Promise<{ status: "pending" | "approved" | "expired" | "unknown"; user?: LoginUser; kind?: "dash" | "player"; invite?: string | null }> {
  await ensureSchema();
  const rows = (await q().query(`SELECT status, tg_user, kind, invite, secret_hash, expires_at < NOW() AS expired FROM login_requests WHERE nonce_hash = $1`, [nonceHash])) as Row[];
  const r = rows[0];
  if (!r || r.secret_hash !== secretHash) return { status: "unknown" };
  if (r.expired === true || r.expired === "t") return { status: "expired" };
  if (r.status === "pending") return { status: "pending" };
  if (r.status !== "approved") return { status: "unknown" };
  const taken = (await q().query(`UPDATE login_requests SET status = 'consumed' WHERE nonce_hash = $1 AND status = 'approved' RETURNING 1`, [nonceHash])) as Row[];
  if (taken.length === 0) return { status: "unknown" };
  const u = (typeof r.tg_user === "string" ? JSON.parse(r.tg_user) : r.tg_user) as LoginUser;
  return { status: "approved", user: u, kind: r.kind === "player" ? "player" : "dash", invite: r.invite ? String(r.invite) : null };
}
