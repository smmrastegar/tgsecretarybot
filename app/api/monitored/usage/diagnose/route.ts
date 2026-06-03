import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { diagnoseUsage } from "@/lib/hikerapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await diagnoseUsage();
  return NextResponse.json({ ok: true, ...result });
}
