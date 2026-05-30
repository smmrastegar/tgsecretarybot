import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentSession } from "@/lib/auth";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const s = await getCurrentSession();
  if (s) {
    await audit({ actorId: s.userId, actorName: s.username ?? null, action: "auth.logout" });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
