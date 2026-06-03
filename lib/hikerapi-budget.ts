// Local dollar-budget enforcement for HikerAPI. HikerAPI itself doesn't
// expose a per-call cost in its responses, so we maintain an estimated
// per-endpoint price table and SUM every call into hikerapi_usage. The
// owner pre-pays a fixed amount (default $50) and we gate spending in
// configurable steps (default $10) — past each threshold we throw a
// HikerApprovalNeededError instead of making the call, surfacing a CTA
// in the UI so the owner can sign off on the next slice.

import {
  getHikerTotalSpent,
  recordHikerCall,
} from "./db";
import { getSettings } from "./settings";

// Estimated cost in USD per call. These numbers are rough — HikerAPI
// doesn't publish a flat table and prices vary by plan — but they're
// in the right ballpark for the $50 starter pack the owner bought.
// Lighter endpoints (single user lookup) are charged less than feed
// pulls that return ~12 items each. The owner can tune via the
// hikerCostPerCallUsd default if our estimates drift.
const COST_TABLE: Array<{ pattern: RegExp; usd: number }> = [
  // Free probes — getUsage / auth, no charge.
  { pattern: /\/v1\/(?:auth\/me|account|usage)\b/, usd: 0 },
  // Cheapest lookups — single user / user-by-id (~1 unit).
  { pattern: /\/v[12]\/user\/by\/(?:username|id)\b/, usd: 0.001 },
  // Story tray — small response (~1-5 items).
  { pattern: /\/v[12]\/user\/stories\b/, usd: 0.003 },
  // Feed-style endpoints returning ~12 items per call.
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
  constructor(args: {
    spentUsd: number;
    approvedUsd: number;
    nextThresholdUsd: number;
    budgetUsd: number;
    reason: "approval" | "budget";
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
};

// Cache the total spent for a short window — every paid call would
// otherwise issue a SUM() against the usage table.
let cachedSpent: { value: number; expiresAt: number } | null = null;
const SPENT_TTL_MS = 5_000;

async function readSpent(): Promise<number> {
  if (cachedSpent && Date.now() < cachedSpent.expiresAt) {
    return cachedSpent.value;
  }
  const v = await getHikerTotalSpent();
  cachedSpent = { value: v, expiresAt: Date.now() + SPENT_TTL_MS };
  return v;
}

function bumpSpent(delta: number): void {
  if (cachedSpent) {
    cachedSpent.value += delta;
  }
}

export function invalidateBudgetCache(): void {
  cachedSpent = null;
}

export async function getBudgetState(): Promise<BudgetState> {
  const s = await getSettings();
  const budget = Number(s.hikerBudgetUsd) || 50;
  const step = Math.max(0.01, Number(s.hikerApprovalStepUsd) || 10);
  const approvedRaw = Number(s.hikerApprovedUsd);
  const approved = Math.min(
    budget,
    Number.isFinite(approvedRaw) ? approvedRaw : step,
  );
  const costPerCall = Number(s.hikerCostPerCallUsd) || 0.005;
  const spent = await readSpent();
  const nextThreshold = Math.min(budget, approved + step);
  return {
    spentUsd: spent,
    approvedUsd: approved,
    budgetUsd: budget,
    stepUsd: step,
    costPerCallUsd: costPerCall,
    needsApproval: spent >= approved && approved < budget,
    budgetExceeded: spent >= budget,
    nextThresholdUsd: nextThreshold,
  };
}

// Called by hikerapi.ts immediately before every outbound HTTP call.
// We block the call if it would push us past the currently-approved
// slice or past the absolute budget.
export async function assertBudget(path: string): Promise<void> {
  const cost = estimatedCost(path, 0.005);
  if (cost === 0) return;
  const state = await getBudgetState();
  if (state.budgetExceeded) {
    throw new HikerApprovalNeededError({
      spentUsd: state.spentUsd,
      approvedUsd: state.approvedUsd,
      nextThresholdUsd: state.nextThresholdUsd,
      budgetUsd: state.budgetUsd,
      reason: "budget",
    });
  }
  if (state.spentUsd + cost > state.approvedUsd) {
    throw new HikerApprovalNeededError({
      spentUsd: state.spentUsd,
      approvedUsd: state.approvedUsd,
      nextThresholdUsd: state.nextThresholdUsd,
      budgetUsd: state.budgetUsd,
      reason: "approval",
    });
  }
}

// Called by hikerapi.ts after every successful paid call.
export async function recordCall(args: {
  path: string;
  accountId?: number | null;
}): Promise<void> {
  const s = await getSettings();
  const fallback = Number(s.hikerCostPerCallUsd) || 0.005;
  const cost = estimatedCost(args.path, fallback);
  if (cost === 0) return;
  await recordHikerCall({
    endpoint: args.path,
    costUsd: cost,
    accountId: args.accountId ?? null,
  });
  bumpSpent(cost);
}
