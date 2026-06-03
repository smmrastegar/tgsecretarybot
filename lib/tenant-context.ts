// Thin AsyncLocalStorage wrapper that lets us thread the active
// tenant ID through deep async chains (route → processAccount →
// hikerapi.callOne → recordCall) without plumbing it as an arg
// through every signature. Routes call runWithTenant(tenantId,
// async () => {...}) once at the boundary; everything downstream
// reads from getCurrentTenantId().

import { AsyncLocalStorage } from "node:async_hooks";

type TenantContext = { tenantId: number };

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(
  tenantId: number,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ tenantId }, fn);
}

export function getCurrentTenantId(): number | null {
  return storage.getStore()?.tenantId ?? null;
}

// Same as getCurrentTenantId but throws if the context is missing.
// Use this from server-side code that absolutely needs a tenant —
// the throw means a route forgot to wrap the call in runWithTenant.
export function requireCurrentTenantId(): number {
  const id = getCurrentTenantId();
  if (id == null) {
    throw new Error(
      "tenant context missing — wrap the call in runWithTenant(tenantId, ...)",
    );
  }
  return id;
}
