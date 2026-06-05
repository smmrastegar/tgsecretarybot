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
  openrouterBudgetUsd: number;
  openrouterApprovedUsd: number;
  openrouterApprovalStepUsd: number;
  monitoredCap: number;
  isEnabled: boolean;
  notes: string | null;
  hikerApiKey: string | null;
  hikerApiKeyName: string | null;
  openrouterApiKey: string | null;
  groqApiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Plan presets — applied with applyPlanToTenant(). "custom" means
// "leave defaults alone, admin will set fields manually". Numbers
// are rough; the admin can always edit afterwards.
export type PlanPreset = {
  key: string;
  label: string;
  hikerBudgetUsd: number;
  hikerApprovalStepUsd: number;
  monitoredCap: number;
  description: string;
};

export const PLAN_PRESETS: PlanPreset[] = [
  {
    key: "starter",
    label: "Starter",
    hikerBudgetUsd: 50,
    hikerApprovalStepUsd: 10,
    monitoredCap: 50,
    description: "$50 سقف · $10 step · 50 اکانت",
  },
  {
    key: "smmr",
    label: "smmr",
    hikerBudgetUsd: 50,
    hikerApprovalStepUsd: 2,
    monitoredCap: 100,
    description: "$50 سقف · $2 step (تایید‌های ریز) · 100 اکانت",
  },
  {
    key: "pro",
    label: "Pro",
    hikerBudgetUsd: 200,
    hikerApprovalStepUsd: 25,
    monitoredCap: 250,
    description: "$200 سقف · $25 step · 250 اکانت",
  },
  {
    key: "enterprise",
    label: "Enterprise",
    hikerBudgetUsd: 1000,
    hikerApprovalStepUsd: 100,
    monitoredCap: 2000,
    description: "$1000 سقف · $100 step · 2000 اکانت",
  },
];

export function getPlanPreset(key: string): PlanPreset | null {
  return PLAN_PRESETS.find((p) => p.key === key) ?? null;
}

function rowToTenant(r: Record<string, unknown>): Tenant {
  return {
    id: Number(r.id),
    name: r.name as string,
    plan: r.plan as string,
    hikerBudgetUsd: Number(r.hiker_budget_usd),
    hikerApprovedUsd: Number(r.hiker_approved_usd),
    hikerApprovalStepUsd: Number(r.hiker_approval_step_usd),
    openrouterBudgetUsd:
      r.openrouter_budget_usd != null ? Number(r.openrouter_budget_usd) : 20,
    openrouterApprovedUsd:
      r.openrouter_approved_usd != null ? Number(r.openrouter_approved_usd) : 5,
    openrouterApprovalStepUsd:
      r.openrouter_approval_step_usd != null
        ? Number(r.openrouter_approval_step_usd)
        : 5,
    monitoredCap: Number(r.monitored_cap),
    isEnabled: Boolean(r.is_enabled),
    notes: (r.notes as string) ?? null,
    hikerApiKey: (r.hiker_api_key as string) ?? null,
    hikerApiKeyName: (r.hiker_api_key_name as string) ?? null,
    openrouterApiKey: (r.openrouter_api_key as string) ?? null,
    groqApiKey: (r.groq_api_key as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

const TENANT_COLUMNS = `id, name, plan, hiker_budget_usd, hiker_approved_usd,
           hiker_approval_step_usd,
           openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
           monitored_cap, is_enabled, notes,
           hiker_api_key, hiker_api_key_name, openrouter_api_key,
           groq_api_key,
           created_at, updated_at` as const;

export async function listTenants(): Promise<Tenant[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, name, plan, hiker_budget_usd, hiker_approved_usd,
           hiker_approval_step_usd,
           openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
           monitored_cap, is_enabled, notes,
           hiker_api_key, hiker_api_key_name, openrouter_api_key,
           groq_api_key,
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
           hiker_approval_step_usd,
           openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
           monitored_cap, is_enabled, notes,
           hiker_api_key, hiker_api_key_name, openrouter_api_key,
           groq_api_key,
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
           hiker_approval_step_usd,
           openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
           monitored_cap, is_enabled, notes,
           hiker_api_key, hiker_api_key_name, openrouter_api_key,
           groq_api_key,
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
              hiker_approval_step_usd,
              openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
              monitored_cap, is_enabled, notes,
              hiker_api_key, hiker_api_key_name, openrouter_api_key,
              groq_api_key,
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
    openrouterBudgetUsd: number;
    openrouterApprovedUsd: number;
    openrouterApprovalStepUsd: number;
    monitoredCap: number;
    isEnabled: boolean;
    notes: string | null;
    hikerApiKey: string | null;
    hikerApiKeyName: string | null;
    openrouterApiKey: string | null;
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
      openrouter_budget_usd = COALESCE(${patch.openrouterBudgetUsd ?? null}::numeric, openrouter_budget_usd),
      openrouter_approved_usd = COALESCE(${patch.openrouterApprovedUsd ?? null}::numeric, openrouter_approved_usd),
      openrouter_approval_step_usd = COALESCE(${patch.openrouterApprovalStepUsd ?? null}::numeric, openrouter_approval_step_usd),
      monitored_cap = COALESCE(${patch.monitoredCap ?? null}::int, monitored_cap),
      is_enabled = COALESCE(${patch.isEnabled ?? null}::boolean, is_enabled),
      notes = COALESCE(${patch.notes ?? null}, notes),
      hiker_api_key = COALESCE(${patch.hikerApiKey ?? null}, hiker_api_key),
      hiker_api_key_name = COALESCE(${patch.hikerApiKeyName ?? null}, hiker_api_key_name),
      openrouter_api_key = COALESCE(${patch.openrouterApiKey ?? null}, openrouter_api_key),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, plan, hiker_budget_usd, hiker_approved_usd,
              hiker_approval_step_usd,
              openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
              monitored_cap, is_enabled, notes,
              hiker_api_key, hiker_api_key_name, openrouter_api_key,
              groq_api_key,
              created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

// Hard-set per-tenant API key fields. Empty string clears them.
// updateTenant() above can't distinguish "leave alone" from
// "clear" because it uses COALESCE. This helper writes literal
// strings or NULL.
export async function setTenantApiKeys(
  id: number,
  patch: {
    hikerApiKey?: string | null;
    hikerApiKeyName?: string | null;
    openrouterApiKey?: string | null;
    groqApiKey?: string | null;
  },
): Promise<Tenant | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const hk = patch.hikerApiKey === undefined ? null : patch.hikerApiKey || null;
  const hkn =
    patch.hikerApiKeyName === undefined ? null : patch.hikerApiKeyName || null;
  const or =
    patch.openrouterApiKey === undefined ? null : patch.openrouterApiKey || null;
  const gr =
    patch.groqApiKey === undefined ? null : patch.groqApiKey || null;
  if (
    patch.hikerApiKey === undefined &&
    patch.hikerApiKeyName === undefined &&
    patch.openrouterApiKey === undefined &&
    patch.groqApiKey === undefined
  ) {
    return getTenant(id);
  }
  const rows = await sql()`
    UPDATE tenants SET
      hiker_api_key = CASE WHEN ${patch.hikerApiKey !== undefined}::boolean THEN ${hk} ELSE hiker_api_key END,
      hiker_api_key_name = CASE WHEN ${patch.hikerApiKeyName !== undefined}::boolean THEN ${hkn} ELSE hiker_api_key_name END,
      openrouter_api_key = CASE WHEN ${patch.openrouterApiKey !== undefined}::boolean THEN ${or} ELSE openrouter_api_key END,
      groq_api_key = CASE WHEN ${patch.groqApiKey !== undefined}::boolean THEN ${gr} ELSE groq_api_key END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, plan, hiker_budget_usd, hiker_approved_usd,
              hiker_approval_step_usd,
              openrouter_budget_usd, openrouter_approved_usd, openrouter_approval_step_usd,
              monitored_cap, is_enabled, notes,
              hiker_api_key, hiker_api_key_name, openrouter_api_key,
              groq_api_key,
              created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

// Apply a preset plan to a tenant. approved is preserved if it's
// already higher than the new step (we never silently revoke
// approvals the owner already had). If approved was tiny, bumps to
// step. plan field on the tenant is set to the preset key.
export async function applyPlanToTenant(
  id: number,
  planKey: string,
): Promise<Tenant | null> {
  const preset = getPlanPreset(planKey);
  if (!preset) return updateTenant(id, { plan: planKey });
  const current = await getTenant(id);
  if (!current) return null;
  const nextApproved = Math.min(
    preset.hikerBudgetUsd,
    Math.max(current.hikerApprovedUsd, preset.hikerApprovalStepUsd),
  );
  return updateTenant(id, {
    plan: preset.key,
    hikerBudgetUsd: preset.hikerBudgetUsd,
    hikerApprovalStepUsd: preset.hikerApprovalStepUsd,
    monitoredCap: preset.monitoredCap,
    hikerApprovedUsd: nextApproved,
  });
}

// Wipe the local cost log for one tenant — used when admin tops up
// out-of-band and wants a fresh ledger. Only clears OUR tracking;
// HikerAPI dashboard balance is untouched.
export async function resetTenantSpend(id: number): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    DELETE FROM hikerapi_usage
    WHERE tenant_id = ${id}
    RETURNING id`;
  return rows.length;
}

// Hard-delete a tenant + everything that belongs to it. Used by admin
// to shut down a workspace. We manually cascade because most tenant_id
// columns are nullable BIGINTs without FK constraints — explicit is
// safer than relying on cascade rules we didn't set.
export async function deleteTenant(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const q = sql();
  await q`UPDATE business_connections SET tenant_id = NULL WHERE tenant_id = ${id}`;
  await q`DELETE FROM hikerapi_usage WHERE tenant_id = ${id}`;
  await q`DELETE FROM monitor_events WHERE tenant_id = ${id}`;
  await q`DELETE FROM monitored_accounts WHERE tenant_id = ${id}`;
  await q`DELETE FROM tenants WHERE id = ${id}`;
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
           t.hiker_approval_step_usd,
           t.openrouter_budget_usd, t.openrouter_approved_usd, t.openrouter_approval_step_usd,
           t.monitored_cap, t.is_enabled, t.notes,
           t.hiker_api_key, t.hiker_api_key_name, t.openrouter_api_key,
           t.groq_api_key,
           t.created_at, t.updated_at
    FROM business_connections bc
    JOIN tenants t ON t.id = bc.tenant_id
    WHERE bc.user_id = ${userId} AND bc.is_enabled = TRUE
    ORDER BY bc.updated_at DESC
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToTenant(r) : null;
}

// Mark TENANT_COLUMNS as referenced to silence unused-export warning.
void TENANT_COLUMNS;

// --- Admin ---

export type AdminUser = {
  userId: number;
  username: string | null;
  firstName: string | null;
  addedAt: Date;
  addedBy: number | null;
};

// Hot path: every page mount calls /api/admin/me (Shell + DebugModeToggle).
// We avoid ensureSchema() here — it runs 150+ DDLs and dominates cold-start
// (~14s observed). If the table doesn't exist yet, just return false; the
// next write path will run the schema. Cache results in-memory for 60s so
// repeated probes within the same instance don't round-trip.
const adminCache = new Map<number, { admin: boolean; expiresAt: number }>();
const adminInflight = new Map<number, Promise<boolean>>();
const ADMIN_TTL_MS = 60_000;

export async function isAdmin(userId: number): Promise<boolean> {
  if (!hasDb()) return false;
  const now = Date.now();
  const cached = adminCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.admin;
  const existing = adminInflight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    let admin = false;
    try {
      const rows = await sql()`
        SELECT 1 FROM admin_users WHERE user_id = ${userId} LIMIT 1`;
      admin = rows.length > 0;
    } catch {
      admin = false;
    }
    adminCache.set(userId, { admin, expiresAt: Date.now() + ADMIN_TTL_MS });
    return admin;
  })();
  adminInflight.set(userId, p);
  try {
    return await p;
  } finally {
    adminInflight.delete(userId);
  }
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
