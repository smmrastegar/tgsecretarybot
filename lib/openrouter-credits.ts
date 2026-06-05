// Read the actual remaining OpenRouter balance via the public API.
// Mirrors how the dashboard shows HikerAPI usage, but here we CAN
// see the real upstream number — OpenRouter exposes both total
// credits and total usage.
//
// Cached in module memory for 60s because every dashboard mount
// (Overview + Costs) would otherwise hit it twice. Manual refresh
// is via passing { force: true }.

import { config } from "./config";

type Cached = { value: OpenrouterCredits; expiresAt: number };
let cache: Cached | null = null;
const TTL_MS = 60_000;

export type OpenrouterCredits = {
  // Total credits ever purchased on the account.
  totalCredits: number;
  // Total usage burned across the lifetime of the account.
  totalUsage: number;
  // What's left = totalCredits - totalUsage. Negative means in debt.
  remaining: number;
  fetchedAt: string;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export async function getOpenrouterCredits(
  opts: { force?: boolean } = {},
): Promise<OpenrouterCredits> {
  if (!opts.force && cache && cache.expiresAt > Date.now()) return cache.value;
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }
  const res = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/credits",
    {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
    },
    10_000,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter /credits ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  const totalCredits = Number(j.data?.total_credits ?? 0);
  const totalUsage = Number(j.data?.total_usage ?? 0);
  const value: OpenrouterCredits = {
    totalCredits,
    totalUsage,
    remaining: totalCredits - totalUsage,
    fetchedAt: new Date().toISOString(),
  };
  cache = { value, expiresAt: Date.now() + TTL_MS };
  return value;
}

export function invalidateOpenrouterCreditsCache(): void {
  cache = null;
}
