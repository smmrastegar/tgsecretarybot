import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createSiteMonitor, listSiteMonitors } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Never leak stored passwords to the client — replace with a flag.
function redact<T extends { password: string | null }>(m: T): Omit<T, "password"> & { hasPassword: boolean } {
  const { password, ...rest } = m;
  return { ...rest, hasPassword: Boolean(password) };
}

export async function GET(): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const monitors = (await listSiteMonitors()).map(redact);
  return NextResponse.json({ monitors });
}

export async function POST(request: Request): Promise<NextResponse> {
  try { await requireSession(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.name || !b.loginUrl || !b.checkUrl) {
    return NextResponse.json({ error: "name, loginUrl, checkUrl required" }, { status: 400 });
  }
  const id = await createSiteMonitor({
    name: String(b.name),
    loginUrl: String(b.loginUrl),
    checkUrl: String(b.checkUrl),
    username: b.username ? String(b.username) : null,
    password: b.password ? String(b.password) : null,
    usernameField: b.usernameField ? String(b.usernameField) : undefined,
    passwordField: b.passwordField ? String(b.passwordField) : undefined,
    extraFieldsJson: b.extraFieldsJson ? String(b.extraFieldsJson) : null,
    checkHoursTehran: b.checkHoursTehran ? String(b.checkHoursTehran) : undefined,
    skipWeekdays: b.skipWeekdays ? String(b.skipWeekdays) : undefined,
    notifyOn: b.notifyOn ? String(b.notifyOn) : undefined,
  });
  return NextResponse.json({ ok: true, id });
}
