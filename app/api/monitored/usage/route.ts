import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { getUsage, HikerOutOfCreditsError } from "@/lib/hikerapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskedKey(): string | null {
  const k = config.hikerApiKey;
  if (!k) return null;
  return `${k.slice(0, 5)}…${k.slice(-3)} (${k.length} chars)`;
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!config.hikerApiKey) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured", keyPrefix: null },
      { status: 503 },
    );
  }
  try {
    const usage = await getUsage();
    return NextResponse.json({ ok: true, usage, keyPrefix: maskedKey() });
  } catch (err) {
    if (err instanceof HikerOutOfCreditsError) {
      return NextResponse.json(
        {
          ok: false,
          outOfCredits: true,
          message: err.message,
          billingUrl: err.billingUrl,
          keyPrefix: maskedKey(),
        },
        { status: 402 },
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        keyPrefix: maskedKey(),
      },
      { status: 502 },
    );
  }
}
