import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listVerify, verifyCounts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard: result of the content check (counts + the suspicious files).
export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  return NextResponse.json({ counts: await verifyCounts(), suspicious: await listVerify(["mismatch", "unsure"]) });
}
