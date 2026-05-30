import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listMessages, overviewStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [stats, latestUrgent, latestAll] = await Promise.all([
    overviewStats(),
    listMessages({ urgentOnly: true, limit: 5 }),
    listMessages({ limit: 8 }),
  ]);
  return NextResponse.json({ stats, latestUrgent, latestAll });
}
