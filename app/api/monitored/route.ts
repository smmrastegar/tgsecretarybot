import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  listMonitoredAccounts,
  listRecentMonitorEvents,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [accounts, events] = await Promise.all([
    listMonitoredAccounts({ platform: "instagram" }),
    listRecentMonitorEvents(100),
  ]);
  return NextResponse.json({ accounts, events });
}
