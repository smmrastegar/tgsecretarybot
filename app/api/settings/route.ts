import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getSettings,
  getSettingsForTenant,
  updateSettings,
  updateTenantSettings,
} from "@/lib/settings";
import { SETTING_KEYS, type SettingKey, envOverride, config } from "@/lib/config";
import { audit } from "@/lib/db";
import { getTenant, isAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENSITIVE_KEYS: SettingKey[] = [
  "hikerApiKeyOverride",
  "monitorExternalSecret",
];
function redactSettings(
  values: Record<SettingKey, string>,
): Record<SettingKey, string> {
  const out = { ...values };
  for (const k of SENSITIVE_KEYS) {
    if (out[k]) out[k] = "********";
  }
  return out;
}

// Resolve `?tenant=<id>` from the URL. Only admins may target a
// tenant other than their own — non-admins always edit globals
// (the historical behavior).
async function resolveScope(
  request: Request,
  session: { userId: number },
): Promise<{ tenantId: number | null; tenantName: string | null }> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("tenant");
  if (!raw) return { tenantId: null, tenantName: null };
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    return { tenantId: null, tenantName: null };
  }
  if (!(await isAdmin(session.userId))) {
    throw Object.assign(new Error("forbidden: admin required for ?tenant"), {
      status: 403,
    });
  }
  const t = await getTenant(id);
  if (!t) {
    throw Object.assign(new Error("tenant not found"), { status: 404 });
  }
  return { tenantId: t.id, tenantName: t.name };
}

export async function GET(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let scope;
  try {
    scope = await resolveScope(request, session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: (err as { status?: number }).status ?? 400 },
    );
  }
  const values =
    scope.tenantId != null
      ? await getSettingsForTenant(scope.tenantId)
      : await getSettings();
  const envLocked: SettingKey[] = SETTING_KEYS.filter(
    (k) => envOverride(k) !== undefined,
  );
  return NextResponse.json({
    values: redactSettings(values),
    envLocked,
    meta: {
      defaultModel: config.openrouterModel,
      tenantId: scope.tenantId,
      tenantName: scope.tenantName,
    },
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let scope;
  try {
    scope = await resolveScope(request, session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: (err as { status?: number }).status ?? 400 },
    );
  }
  const body = (await request.json()) as Partial<Record<SettingKey, string>>;
  const patch: Partial<Record<SettingKey, string>> = {};
  const SKIP: SettingKey[] = ["hikerApiKeyOverride"];
  // Treat the redaction placeholder as "don't change" — settings UI
  // shows ******** for sensitive keys, so naive resubmit would
  // otherwise overwrite the real secret with literal stars.
  for (const k of SENSITIVE_KEYS) {
    if (body[k] === "********") delete body[k];
  }
  for (const k of SETTING_KEYS) {
    if (SKIP.includes(k)) continue;
    if (k in body && typeof body[k] === "string") patch[k] = body[k];
  }
  const next =
    scope.tenantId != null
      ? await updateTenantSettings(scope.tenantId, patch, session.userId)
      : await updateSettings(patch, session.userId);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: scope.tenantId != null ? "settings.update_tenant" : "settings.update",
    target: scope.tenantId != null ? String(scope.tenantId) : null,
    details: { keys: Object.keys(patch), tenantId: scope.tenantId },
  });
  return NextResponse.json({
    ok: true,
    values: redactSettings(next),
    meta: { tenantId: scope.tenantId, tenantName: scope.tenantName },
  });
}
