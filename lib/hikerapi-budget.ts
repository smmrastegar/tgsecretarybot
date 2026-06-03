// Per-tenant dollar-budget enforcement for HikerAPI. The tenant's
// budget / approved / step values live in the `tenants` table and
// are looked up via the AsyncLocalStorage context set by the route.
// HikerAPI doesn't expose a per-call cost in its responses, so we
// maintain an estimated per-endpoint price table and SUM every
// call into hikerapi_usage. When spend would push the tenant past
// its currently-approved slice or its absolute budget, we throw
// HikerApprovalNeededError so the UI surfaces the approval CTA.

import {
  getHikerSpentForTenant,
  recordHikerCall,
} from "./db";
import { getSettings } from "./settings";
import { getCurrentTenantId } from "./tenant-context";
import { getTenant, updateTenant, type Tenant } from "./tenant";

const COST_TABLE: Array<{ pattern: RegExp; usd: number }> = [
  { pattern: /\/v1\/(?:auth\/me|account|usage)\b/, usd: 0 },
  { pattern: /\/sys\/balance\b/, usd: 0 },
  { pattern: /\/v[12]\/user\/by\/(?:username|id)\b/, usd: 0.001 },
  { pattern: /\/v[12]\/user\/stories\b/, usd: 0.003 },
  { pattern: /\/v2\/user\/(?:medias|clips|tag\/medias)\b/, usd: 0.012 },
];

export function estimatedCost(path: string, fallbackUsd: number): number {
  for (const { pattern, usd } of COST_TABLE) {
    if (pattern.test(path)) return usd;
  }
  return fallbackUsd;
}

export class HikerApprovalNeededError extends Error {
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
        ? `HikerAPI budget cap reached: $${args.spentUsd.toFixed(2)} / $${args.budgetUsd.toFixed(2)}`
        : `HikerAPI approval needed: spent $${args.spentUsd.toFixed(2)} of $${args.approvedUsd.toFixed(2)} approved (next: $${args.nextThresholdUsd.toFixed(2)})`;
    super(msg);
    this.name = "HikerApprovalNeededError";
    this.spentUsd = args.spentUsd;
    this.approvedUsd = args.approvedUsd;
    this.nextThresholdUsd = args.nextThresholdUsd;
    this.budgetUsd = args.budgetUsd;
    this.reason = args.reason;
    this.tenantId = args.tenantId;
  }
}

export type BudgetState = {
  spentUsd: number;
  approvedUsd: number;
  budgetUsd: number;
  stepUsd: number;
  costPerCallUsd: number;
  needsApproval: boolean;
  budgetExceeded: boolean;
  nextThresholdUsd: number;
  tenantId: number | null;
  tenantName: string | null;
};

// Cache per-tenant spent so the hot path doesn't issue a SUM() on
// every call. 5s is fine — call costs are tiny and we always
// invalidate after an approve / settings change.
type SpentCacheEntry = { value: number; expiresAt: number };
const spentByTenant = new Map<number, SpentCacheEntry>();
const SPENT_TTL_MS = 5_000;

async function readSpent(tenantId: number): Promise<number> {
  const cached = spentByTenant.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const v = await getHikerSpentForTenant(tenantId);
  spentByTenant.set(tenantId, {
    value: v,
    expiresAt: Date.now() + SPENT_TTL_MS,
  });
  return v;
}

function bumpSpent(tenantId: number, delta: number): void {
  const cached = spentByTenant.get(tenantId);
  if (cached) cached.value += delta;
}

export function invalidateBudgetCache(tenantId?: number): void {
  if (tenantId == null) spentByTenant.clear();
  else spentByTenant.delete(tenantId);
}

async function readCostPerCallUsd(): Promise<number> {
  // Per-call fallback cost is still global — it's an estimate, not
  // tenant-scoped data. Tenants can be billed identically because
  // the cost is set by the upstream endpoint, not by who's calling.
  const s = await getSettings();
  const v = Number(s.hikerCostPerCallUsd);
  return Number.isFinite(v) && v > 0 ? v : 0.005;
}

export async function getBudgetState(
  tenantIdArg?: number,
): Promise<BudgetState> {
  const tenantId = tenantIdArg ?? getCurrentTenantId();
  const costPerCall = await readCostPerCallUsd();
  if (tenantId == null) {
    // No tenant context — emit a zero-budget state so callers can
    // still render an empty card without crashing. The gate below
    // refuses any cost > 0 in this case.
    return {
      spentUsd: 0,
      approvedUsd: 0,
      budgetUsd: 0,
      stepUsd: 0,
      costPerCallUsd: costPerCall,
      needsApproval: true,
      budgetExceeded: true,
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
      costPerCallUsd: costPerCall,
      needsApproval: true,
      budgetExceeded: true,
      nextThresholdUsd: 0,
      tenantId,
      tenantName: null,
    };
  }
  const spent = await readSpent(tenantId);
  const nextThreshold = Math.min(
    t.hikerBudgetUsd,
    t.hikerApprovedUsd + t.hikerApprovalStepUsd,
  );
  return {
    spentUsd: spent,
    approvedUsd: t.hikerApprovedUsd,
    budgetUsd: t.hikerBudgetUsd,
    stepUsd: t.hikerApprovalStepUsd,
    costPerCallUsd: costPerCall,
    needsApproval:
      spent >= t.hikerApprovedUsd && t.hikerApprovedUsd < t.hikerBudgetUsd,
    budgetExceeded: spent >= t.hikerBudgetUsd,
    nextThresholdUsd: nextThreshold,
    tenantId,
    tenantName: t.name,
  };
}

// Called by hikerapi.callOne immediately before every paid call.
// Reads tenant from the AsyncLocalStorage context.
export async function assertBudget(path: string): Promise<void> {
  const cost = estimatedCost(path, await readCostPerCallUsd());
  if (cost === 0) return;
  const tenantId = getCurrentTenantId();
  if (tenantId == null) {
    // No tenant context — refuse rather than charging silently.
    throw new HikerApprovalNeededError({
      spentUsd: 0,
      approvedUsd: 0,
      nextThresholdUsd: 0,
      budgetUsd: 0,
      reason: "approval",
      tenantId: null,
    });
  }
  const state = await getBudgetState(tenantId);
  if (state.budgetExceeded) {
    throw new HikerApprovalNeededError({
      spentUsd: state.spentUsd,
      approvedUsd: state.approvedUsd,
      nextThresholdUsd: state.nextThresholdUsd,
      budgetUsd: state.budgetUsd,
      reason: "budget",
      tenantId,
    });
  }
  if (state.spentUsd + cost > state.approvedUsd) {
    throw new HikerApprovalNeededError({
      spentUsd: state.spentUsd,
      approvedUsd: state.approvedUsd,
      nextThresholdUsd: state.nextThresholdUsd,
      budgetUsd: state.budgetUsd,
      reason: "approval",
      tenantId,
    });
  }
}

// Called by hikerapi.callOne after every successful paid call.
export async function recordCall(args: {
  path: string;
  accountId?: number | null;
}): Promise<void> {
  const tenantId = getCurrentTenantId();
  const fallback = await readCostPerCallUsd();
  const cost = estimatedCost(args.path, fallback);
  if (cost === 0) return;
  await recordHikerCall({
    endpoint: args.path,
    costUsd: cost,
    accountId: args.accountId ?? null,
    tenantId,
  });
  if (tenantId != null) bumpSpent(tenantId, cost);
}

// Mutators used by /api/monitored/budget/approve. Reads from /writes
// to the tenants table directly — the budget settings have been
// promoted out of the global `settings` table.
export async function approveTenantBudget(args: {
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
      : t.hikerApprovedUsd + (args.stepUsd ?? t.hikerApprovalStepUsd);
  let nextBudget =
    args.budgetUsd != null && Number.isFinite(args.budgetUsd)
      ? Math.max(0, args.budgetUsd)
      : t.hikerBudgetUsd;
  if (args.extendBudget && nextApproved > nextBudget) {
    nextBudget = nextApproved;
  } else if (nextApproved > nextBudget) {
    nextApproved = nextBudget;
  }
  const patch: Parameters<typeof updateTenant>[1] = {
    hikerApprovedUsd: nextApproved,
    hikerBudgetUsd: nextBudget,
  };
  if (args.stepUsd != null && Number.isFinite(args.stepUsd)) {
    patch.hikerApprovalStepUsd = Math.max(0.01, args.stepUsd);
  }
  invalidateBudgetCache(args.tenantId);
  return updateTenant(args.tenantId, patch);
}
