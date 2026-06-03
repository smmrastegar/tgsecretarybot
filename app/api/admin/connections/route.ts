import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listBusinessConnections } from "@/lib/db";
import { requireAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const connections = await listBusinessConnections();
  return NextResponse.json({ ok: true, connections });
}
