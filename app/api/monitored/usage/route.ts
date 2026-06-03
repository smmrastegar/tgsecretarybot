import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { getUsage } from "@/lib/hikerapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!config.hikerApiKey) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured" },
      { status: 503 },
    );
  }
  try {
    const usage = await getUsage();
    return NextResponse.json({ ok: true, usage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
