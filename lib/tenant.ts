// Multi-tenant primitives. A tenant is an isolated workspace —
// its own monitored accounts, message history, budget, etc. This
// module centralises the lookups so the schema details don't leak
// into every route. The intent is:
//
//   - ordinary Telegram user → resolved to a single tenant via the
//     business_connections row they own. If they own none, they
//     have no tenant (and most read endpoints should 403).
//   - admin → can list/create/edit tenants and can "impersonate"
//     any tenant for view-only purposes.
//
// All routes that touch tenant-scoped data should pass tenantId
// through to db helpers and WHERE-clause it. Subsequent commits
// thread that argument through every existing helper.

import { ensureSchema, hasDb, sql } from "./db";

export type Tenant = {
  id: number;
  name: string;
  plan: string;
  hikerBudgetUsd: number;
  hikerApprovedUsd: number;
  hikerApprovalStepUsd: number;
  monitoredCap: number;
  isEnabled: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToTenant(r: Record<string, unknown>): Tenant {
  return {
    id: Number(r.id),
    name: r.name as string,
    plan: r.plan as string,
    hikerBudgetUsd: Number(r.hiker_budget_usd),
    hikerApprovedUsd: Number(r.hiker_approved_usd),
    hikerApprovalStepUsd: Number(r.hiker_approval_step_usd),
    monitoredCap: Number(r.monitored_cap),
    isEnabled: Boolean(r.is_enabled),
    notes: (r.notes as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listTenants(): Promise<Tenant[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, name, plan, hiker_budget_usd, hiker_approved_usd,
           hiker_approval_step_usd, monitored_cap, is_enabled, notes,
           created_at, updated_at
    FROM tenants
    ORDER BY name ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToTenant);
}

export async function getTenant(id: number): Promise<Tenant | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, name, plan, hiker_budget_usd, hiker_approved_usd,
           hiker_approval_step_usd, monitored_cap, is_enabled, notes,
           created_at, updated_at
    FROM tenants WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

export async function getTenantByName(name: string): Promise<Tenant | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, name, plan, hiker_budget_usd, hiker_approved_usd,
           hiker_approval_step_usd, monitored_cap, is_enabled, notes,
           created_at, updated_at
    FROM tenants WHERE name = ${name} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

export async function createTenant(args: {
  name: string;
  plan?: string;
  hikerBudgetUsd?: number;
  hikerApprovedUsd?: number;
  hikerApprovalStepUsd?: number;
  monitoredCap?: number;
  notes?: string | null;
}): Promise<Tenant> {
  if (!hasDb()) throw new Error("DATABASE_URL not configured");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO tenants (
      name, plan, hiker_budget_usd, hiker_approved_usd,
      hiker_approval_step_usd, monitored_cap, notes
    )
    VALUES (
      ${args.name},
      ${args.plan ?? "starter"},
      ${args.hikerBudgetUsd ?? 50},
      ${args.hikerApprovedUsd ?? 10},
      ${args.hikerApprovalStepUsd ?? 10},
      ${args.monitoredCap ?? 50},
      ${args.notes ?? null}
    )
    ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
    RETURNING id, name, plan, hiker_budget_usd, hiker_approved_usd,
              hiker_approval_step_usd, monitored_cap, is_enabled, notes,
              created_at, updated_at`;
  return rowToTenant(rows[0] as Record<string, unknown>);
}

export async function updateTenant(
  id: number,
  patch: Partial<{
    name: string;
    plan: string;
    hikerBudgetUsd: number;
    hikerApprovedUsd: number;
    hikerApprovalStepUsd: number;
    monitoredCap: number;
    isEnabled: boolean;
    notes: string | null;
  }>,
): Promise<Tenant | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE tenants SET
      name = COALESCE(${patch.name ?? null}, name),
      plan = COALESCE(${patch.plan ?? null}, plan),
      hiker_budget_usd = COALESCE(${patch.hikerBudgetUsd ?? null}::numeric, hiker_budget_usd),
      hiker_approved_usd = COALESCE(${patch.hikerApprovedUsd ?? null}::numeric, hiker_approved_usd),
      hiker_approval_step_usd = COALESCE(${patch.hikerApprovalStepUsd ?? null}::numeric, hiker_approval_step_usd),
      monitored_cap = COALESCE(${patch.monitoredCap ?? null}::int, monitored_cap),
      is_enabled = COALESCE(${patch.isEnabled ?? null}::boolean, is_enabled),
      notes = COALESCE(${patch.notes ?? null}, notes),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, plan, hiker_budget_usd, hiker_approved_usd,
              hiker_approval_step_usd, monitored_cap, is_enabled, notes,
              created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

// Attach a business connection to a tenant. Used by the admin
// panel when an admin manually assigns a Telegram owner to a
// specific tenant. The standard auto-create path (when a new
// business_connection arrives) lands rows in Default until the
// admin moves them.
export async function attachBusinessConnectionToTenant(args: {
  businessConnectionId: string;
  tenantId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE business_connections
    SET tenant_id = ${args.tenantId}, updated_at = NOW()
    WHERE id = ${args.businessConnectionId}`;
}

// Resolve which tenant a given Telegram user belongs to. Looks up
// via business_connections — a user only has a tenant if they've
// connected the bot to one of their accounts (otherwise they have
// nothing to manage, web-side).
export async function getTenantForUser(
  userId: number,
): Promise<Tenant | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT t.id, t.name, t.plan, t.hiker_budget_usd, t.hiker_approved_usd,
           t.hiker_approval_step_usd, t.monitored_cap, t.is_enabled, t.notes,
           t.created_at, t.updated_at
    FROM business_connections bc
    JOIN tenants t ON t.id = bc.tenant_id
    WHERE bc.user_id = ${userId} AND bc.is_enabled = TRUE
    ORDER BY bc.updated_at DESC
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

// --- Admin ---

export type AdminUser = {
  userId: number;
  username: string | null;
  firstName: string | null;
  addedAt: Date;
  addedBy: number | null;
};

export async function isAdmin(userId: number): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM admin_users WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

export async function listAdmins(): Promise<AdminUser[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT user_id, username, first_name, added_at, added_by
    FROM admin_users
    ORDER BY added_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    userId: Number(r.user_id),
    username: (r.username as string) ?? null,
    firstName: (r.first_name as string) ?? null,
    addedAt: r.added_at as Date,
    addedBy: r.added_by == null ? null : Number(r.added_by),
  }));
}

export async function addAdmin(args: {
  userId: number;
  username?: string | null;
  firstName?: string | null;
  addedBy?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO admin_users (user_id, username, first_name, added_by)
    VALUES (${args.userId}, ${args.username ?? null},
            ${args.firstName ?? null}, ${args.addedBy ?? null})
    ON CONFLICT (user_id) DO UPDATE SET
      username = COALESCE(EXCLUDED.username, admin_users.username),
      first_name = COALESCE(EXCLUDED.first_name, admin_users.first_name)`;
}

export async function removeAdmin(userId: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`DELETE FROM admin_users WHERE user_id = ${userId}`;
}

// Session helpers — thin wrappers around the lib/auth session that
// throw if the caller doesn't have the required role. Returns the
// resolved tenant so the caller can scope queries.
export async function requireAdmin(session: {
  userId: number;
}): Promise<void> {
  if (!(await isAdmin(session.userId))) {
    throw Object.assign(new Error("forbidden: admin required"), {
      status: 403,
    });
  }
}

export async function requireTenant(session: {
  userId: number;
}): Promise<Tenant> {
  const t = await getTenantForUser(session.userId);
  if (!t) {
    throw Object.assign(new Error("forbidden: no tenant for user"), {
      status: 403,
    });
  }
  if (!t.isEnabled) {
    throw Object.assign(new Error("forbidden: tenant disabled"), {
      status: 403,
    });
  }
  return t;
}

// Admin impersonation: lets an admin act as a specific tenant for
// view-only purposes. Reads a cookie / header chosen by the route;
// this helper centralises the validation.
export async function requireTenantWithImpersonation(args: {
  userId: number;
  impersonateTenantId?: number | null;
}): Promise<{ tenant: Tenant; impersonating: boolean }> {
  if (args.impersonateTenantId != null) {
    if (!(await isAdmin(args.userId))) {
      throw Object.assign(new Error("forbidden: admin required to impersonate"), {
        status: 403,
      });
    }
    const t = await getTenant(args.impersonateTenantId);
    if (!t) {
      throw Object.assign(new Error("tenant not found"), { status: 404 });
    }
    return { tenant: t, impersonating: true };
  }
  return { tenant: await requireTenant({ userId: args.userId }), impersonating: false };
}
