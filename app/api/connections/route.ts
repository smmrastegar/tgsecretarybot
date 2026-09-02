import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listBusinessConnections } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const rows = await listBusinessConnections().catch(() => []);
  return NextResponse.json({ connections: rows });
}
