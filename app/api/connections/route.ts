import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listBusinessConnections } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await listBusinessConnections().catch(() => []);
  return NextResponse.json({ connections: rows });
}
