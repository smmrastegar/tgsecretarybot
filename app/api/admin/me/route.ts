import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight "am I an admin?" probe so the client can hide /admin
// links from non-admins without leaking the list of admins.
export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ ok: true, admin: false });
  }
  const admin = await isAdmin(session.userId);
  return NextResponse.json({
    ok: true,
    admin,
    userId: session.userId,
  });
}
