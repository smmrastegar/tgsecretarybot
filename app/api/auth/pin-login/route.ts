import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/db";
import { checkPin } from "@/lib/music-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Numeric-password sign-in for the music pages. The session it creates is limited to them.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { pin?: unknown };
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const r = await checkPin(pin, ip);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await setSessionCookie(await createSession(r.session));
  await audit({ actorId: r.session.userId, actorName: r.session.username ?? r.session.firstName ?? null, action: "auth.pin-login" });
  return NextResponse.json({ ok: true });
}
