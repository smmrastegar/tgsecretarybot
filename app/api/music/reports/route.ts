import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { listMusicReports, REPORT_REASONS } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard: all problem reports (?status=open|resolved).
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return NextResponse.json({ reports: await listMusicReports(status), reasons: REPORT_REASONS });
}
