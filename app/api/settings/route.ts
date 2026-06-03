import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";
import { SETTING_KEYS, type SettingKey, envOverride, config } from "@/lib/config";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const values = await getSettings();
  const envLocked: SettingKey[] = SETTING_KEYS.filter(
    (k) => envOverride(k) !== undefined,
  );
  return NextResponse.json({
    values: redactSettings(values),
    envLocked,
    meta: { defaultModel: config.openrouterModel },
  });
}

const SENSITIVE_KEYS: SettingKey[] = ["hikerApiKeyOverride"];
function redactSettings(
  values: Record<SettingKey, string>,
): Record<SettingKey, string> {
  const out = { ...values };
  for (const k of SENSITIVE_KEYS) {
    if (out[k]) out[k] = "********";
  }
  return out;
}

export async function PUT(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as Partial<Record<SettingKey, string>>;
  const patch: Partial<Record<SettingKey, string>> = {};
  // hikerApiKeyOverride goes through its own POST /api/monitored/usage/key
  // to avoid accidentally writing the "********" redaction back.
  const SKIP: SettingKey[] = ["hikerApiKeyOverride"];
  for (const k of SETTING_KEYS) {
    if (SKIP.includes(k)) continue;
    if (k in body && typeof body[k] === "string") patch[k] = body[k];
  }
  const next = await updateSettings(patch, session.userId);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "settings.update",
    details: Object.keys(patch),
  });
  return NextResponse.json({ ok: true, values: redactSettings(next) });
}
