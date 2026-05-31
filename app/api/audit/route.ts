import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await listAudit(100);
  return NextResponse.json({ rows });
}
