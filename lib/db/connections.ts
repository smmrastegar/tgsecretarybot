// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";

// --- Business connections ---

export async function upsertBusinessConnection(args: {
  id: string;
  userId: number;
  userChatId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  canReply: boolean;
  isEnabled: boolean;
}): Promise<void> {
  await ensureSchema();
  const q = sql();
  await q`
    INSERT INTO business_connections (
      id, user_id, user_chat_id, username, first_name, last_name,
      can_reply, is_enabled, updated_at
    ) VALUES (
      ${args.id}, ${args.userId}, ${args.userChatId},
      ${args.username ?? null}, ${args.firstName ?? null}, ${args.lastName ?? null},
      ${args.canReply}, ${args.isEnabled}, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      user_chat_id = EXCLUDED.user_chat_id,
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      can_reply = EXCLUDED.can_reply,
      is_enabled = EXCLUDED.is_enabled,
      updated_at = NOW()`;
  // If this row landed without a tenant_id (brand-new connection),
  // park it on Default so admin can move it later. We never
  // clobber an existing assignment — an admin may have already
  // routed this connection to a non-Default tenant.
  await q`
    UPDATE business_connections
    SET tenant_id = (SELECT id FROM tenants WHERE name = 'Default' LIMIT 1)
    WHERE id = ${args.id} AND tenant_id IS NULL`;
}

export async function getBusinessConnection(
  id: string,
): Promise<{ userId: number; userChatId: number; canReply: boolean } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT user_id, user_chat_id, can_reply
    FROM business_connections WHERE id = ${id} AND is_enabled = TRUE LIMIT 1`;
  const r = rows[0] as { user_id: string; user_chat_id: string; can_reply: boolean } | undefined;
  if (!r) return null;
  return {
    userId: Number(r.user_id),
    userChatId: Number(r.user_chat_id),
    canReply: r.can_reply,
  };
}

export async function listBusinessConnections(): Promise<BusinessConnectionRow[]> {
  await ensureSchema();
  const rows = await sql()`
    SELECT id, user_id, user_chat_id, username, first_name, last_name,
           can_reply, is_enabled, tenant_id, created_at, updated_at
    FROM business_connections ORDER BY updated_at DESC`;
  return rows.map((r) => ({
    id: r.id as string,
    userId: Number(r.user_id),
    userChatId: Number(r.user_chat_id),
    username: r.username as string | null,
    firstName: r.first_name as string | null,
    lastName: r.last_name as string | null,
    canReply: r.can_reply as boolean,
    isEnabled: r.is_enabled as boolean,
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  }));
}

export type BusinessConnectionRow = {
  id: string;
  userId: number;
  userChatId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  canReply: boolean;
  isEnabled: boolean;
  tenantId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function isAllowedUser(userId: number): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM business_connections WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}
