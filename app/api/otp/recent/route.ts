import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { recentOtpItems } from "@/lib/otp-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const hours = Number(url.searchParams.get("hours") ?? "24");
  const items = await recentOtpItems(Number.isFinite(hours) ? hours : 24);
  return NextResponse.json(
    { items, now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
