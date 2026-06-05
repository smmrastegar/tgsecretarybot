// Per-tenant dollar-budget enforcement for OpenRouter — mirrors
// lib/hikerapi-budget.ts. The tenant.openrouter_* columns hold
// the approved / budget / step values; spend comes from the
// existing ai_usage table (SUM cost_usd WHERE tenant_id=X).
//
// Unlike HikerAPI we CAN read the real upstream balance via
// /api/v1/credits — see lib/openrouter-credits.ts. That number is
// surfaced read-only on the dashboard, but the gating decisions
// here use OUR tracked spend so the operator owns the approval
// flow.

import { hasDb, sql } from "./db";
import { getCurrentTenantId } from "./tenant-context";
import { getTenant, updateTenant, type Tenant } from "./tenant";

export class OpenrouterApprovalNeededError extends Error {
  spentUsd: number;
  approvedUsd: number;
  nextThresholdUsd: number;
  budgetUsd: number;
  reason: "approval" | "budget";
  tenantId: number | null;
  constructor(args: {
    spentUsd: number;
    approvedUsd: number;
    nextThresholdUsd: number;
    budgetUsd: number;
    reason: "approval" | "budget";
    tenantId: number | null;
  }) {
    const msg =
      args.reason === "budget"
        ? `OpenRouter budget cap reached: $${args.spentUsd.toFixed(2)} / $${args.budgetUsd.toFixed(2)}`
        : `OpenRouter approval needed: spent $${args.spentUsd.toFixed(2)} of $${args.approvedUsd.toFixed(2)} approved (next: $${args.nextThresholdUsd.toFixed(2)})`;
    super(msg);
    this.name = "OpenrouterApprovalNeededError";
    this.spentUsd = args.spentUsd;
    this.approvedUsd = args.approvedUsd;
    this.nextThresholdUsd = args.nextThresholdUsd;
    this.budgetUsd = args.budgetUsd;
    this.reason = args.reason;
    this.tenantId = args.tenantId;
  }
}

export type OpenrouterBudgetState = {
  spentUsd: number;
  approvedUsd: number;
  budgetUsd: number;
  stepUsd: number;
  needsApproval: boolean;
  budgetExceeded: boolean;
  nextThresholdUsd: number;
  tenantId: number | null;
  tenantName: string | null;
};

type SpentCacheEntry = { value: number; expiresAt: number };
const spentByTenant = new Map<number, SpentCacheEntry>();
const SPENT_TTL_MS = 10_000;

async function readSpent(tenantId: number): Promise<number> {
  const cached = spentByTenant.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  if (!hasDb()) return 0;
  const rows = await sql()`
    SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
    FROM ai_usage
    WHERE tenant_id = ${tenantId}`;
  const v = Number((rows[0] as { total?: number })?.total ?? 0);
  spentByTenant.set(tenantId, {
    value: v,
    expiresAt: Date.now() + SPENT_TTL_MS,
  });
  return v;
}

export function bumpOpenrouterSpent(tenantId: number, delta: number): void {
  const cached = spentByTenant.get(tenantId);
  if (cached) cached.value += delta;
}

export function invalidateOpenrouterBudgetCache(tenantId?: number): void {
  if (tenantId == null) spentByTenant.clear();
  else spentByTenant.delete(tenantId);
}

export async function getOpenrouterBudgetState(
  tenantIdArg?: number,
): Promise<OpenrouterBudgetState> {
  const tenantId = tenantIdArg ?? getCurrentTenantId();
  if (tenantId == null) {
    return {
      spentUsd: 0,
      approvedUsd: 0,
      budgetUsd: 0,
      stepUsd: 0,
      needsApproval: false,
      budgetExceeded: false,
      nextThresholdUsd: 0,
      tenantId: null,
      tenantName: null,
    };
  }
  const t = await getTenant(tenantId);
  if (!t) {
    return {
      spentUsd: 0,
      approvedUsd: 0,
      budgetUsd: 0,
      stepUsd: 0,
      needsApproval: false,
      budgetExceeded: false,
      nextThresholdUsd: 0,
      tenantId,
      tenantName: null,
    };
  }
  const spent = await readSpent(tenantId);
  const nextThreshold = Math.min(
    t.openrouterBudgetUsd,
    t.openrouterApprovedUsd + t.openrouterApprovalStepUsd,
  );
  return {
    spentUsd: spent,
    approvedUsd: t.openrouterApprovedUsd,
    budgetUsd: t.openrouterBudgetUsd,
    stepUsd: t.openrouterApprovalStepUsd,
    needsApproval:
      spent >= t.openrouterApprovedUsd &&
      t.openrouterApprovedUsd < t.openrouterBudgetUsd,
    budgetExceeded: spent >= t.openrouterBudgetUsd,
    nextThresholdUsd: nextThreshold,
    tenantId,
    tenantName: t.name,
  };
}

// Soft assertion — call before issuing an OpenRouter request. Throws
// only when the tenant has already passed approved/budget AND the
// caller is in a context where blocking makes sense. We bias to
// LETTING calls through if no tenant is set (avoids breaking the bot
// for deployments that haven't wired tenant_context properly).
export async function assertOpenrouterBudget(): Promise<void> {
  const tenantId = getCurrentTenantId();
  if (tenantId == null) return;
  const state = await getOpenrouterBudgetState(tenantId);
  if (state.budgetExceeded) {
    throw new OpenrouterApprovalNeededError({
      spentUsd: state.spentUsd,
      approvedUsd: state.approvedUsd,
      nextThresholdUsd: state.nextThresholdUsd,
      budgetUsd: state.budgetUsd,
      reason: "budget",
      tenantId,
    });
  }
  if (state.spentUsd >= state.approvedUsd) {
    throw new OpenrouterApprovalNeededError({
      spentUsd: state.spentUsd,
      approvedUsd: state.approvedUsd,
      nextThresholdUsd: state.nextThresholdUsd,
      budgetUsd: state.budgetUsd,
      reason: "approval",
      tenantId,
    });
  }
}

export async function approveOpenrouterBudget(args: {
  tenantId: number;
  approvedUsd?: number;
  budgetUsd?: number;
  stepUsd?: number;
  extendBudget?: boolean;
}): Promise<Tenant | null> {
  const t = await getTenant(args.tenantId);
  if (!t) return null;
  let nextApproved =
    args.approvedUsd != null && Number.isFinite(args.approvedUsd)
      ? Math.max(0, args.approvedUsd)
      : t.openrouterApprovedUsd +
        (args.stepUsd ?? t.openrouterApprovalStepUsd);
  let nextBudget =
    args.budgetUsd != null && Number.isFinite(args.budgetUsd)
      ? Math.max(0, args.budgetUsd)
      : t.openrouterBudgetUsd;
  if (args.extendBudget && nextApproved > nextBudget) {
    nextBudget = nextApproved;
  } else if (nextApproved > nextBudget) {
    nextApproved = nextBudget;
  }
  const patch: Parameters<typeof updateTenant>[1] = {
    openrouterApprovedUsd: nextApproved,
    openrouterBudgetUsd: nextBudget,
  };
  if (args.stepUsd != null && Number.isFinite(args.stepUsd)) {
    patch.openrouterApprovalStepUsd = Math.max(0.01, args.stepUsd);
  }
  invalidateOpenrouterBudgetCache(args.tenantId);
  return updateTenant(args.tenantId, patch);
}
