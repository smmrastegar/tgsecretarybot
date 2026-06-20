import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  listAudit,
  listSystemErrors,
  systemErrorSourceBuckets,
  type SystemErrorLevel,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "both"; // "audit" | "errors" | "both"
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200"), 1), 1000);
  const level = url.searchParams.get("level") as SystemErrorLevel | null;
  const source = url.searchParams.get("source");
  const q = url.searchParams.get("q");
  const sinceDaysRaw = url.searchParams.get("days");
  const sinceDays =
    sinceDaysRaw && Number.isFinite(Number(sinceDaysRaw))
      ? Number(sinceDaysRaw)
      : null;

  const wantAudit = kind === "audit" || kind === "both";
  const wantErrors = kind === "errors" || kind === "both";

  const [rows, errors, sources] = await Promise.all([
    wantAudit ? listAudit(Math.min(limit, 500)) : Promise.resolve([]),
    wantErrors
      ? listSystemErrors({ limit, level, source, q, sinceDays })
      : Promise.resolve([]),
    systemErrorSourceBuckets(),
  ]);
  return NextResponse.json({ rows, errors, sources });
}
