import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { clearPin, PIN_RE, pinConfigured, setPin } from "@/lib/music-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manage the numeric password. Only a full dashboard session may — a PIN session cannot change its own PIN.
async function owner() {
  const s = await getCurrentSession();
  return s && !s.scope ? s : null;
}

export async function GET(): Promise<NextResponse> {
  const s = await getCurrentSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: await pinConfigured(), canManage: !s.scope });
}

export async function POST(request: Request): Promise<NextResponse> {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { pin?: unknown };
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!PIN_RE.test(pin)) return NextResponse.json({ error: "رمز باید فقط عدد و ۶ تا ۱۰ رقم باشد" }, { status: 400 });
  await setPin(pin, s);
  await audit({ actorId: s.userId, actorName: s.username ?? s.firstName ?? null, action: "auth.pin-set" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(): Promise<NextResponse> {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await clearPin(s.userId);
  await audit({ actorId: s.userId, actorName: s.username ?? s.firstName ?? null, action: "auth.pin-clear" });
  return NextResponse.json({ ok: true });
}
