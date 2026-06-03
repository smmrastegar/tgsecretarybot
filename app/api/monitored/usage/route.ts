import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getActiveKey,
  getBalance,
  HikerOutOfCreditsError,
  maskKey,
} from "@/lib/hikerapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /sys/balance is HikerAPI's documented "current rate limit / balance"
// endpoint. It's the only true server-side $ info we can pull — every
// other /v1/auth/me etc. path 404s on this account type. We surface
// the live balance + rate limit alongside our local cost tracking.
export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { key, source, name } = await getActiveKey();
  const keyPrefix = maskKey(key);
  if (!key) {
    return NextResponse.json(
      {
        error: "HIKER_API_KEY not configured (env or override)",
        configured: false,
        keyPrefix: null,
        keySource: null,
        keyName: name,
      },
      { status: 503 },
    );
  }
  try {
    const bal = await getBalance();
    return NextResponse.json({
      ok: true,
      configured: true,
      keyPrefix,
      keySource: source,
      keyName: name,
      balanceUsd: bal.balanceUsd,
      rateLimitPerSec: bal.rateLimitPerSec,
      raw: bal.raw,
    });
  } catch (err) {
    if (err instanceof HikerOutOfCreditsError) {
      return NextResponse.json(
        {
          ok: false,
          outOfCredits: true,
          message: err.message,
          billingUrl: err.billingUrl,
          keyPrefix,
          keySource: source,
          keyName: name,
        },
        { status: 402 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error: err instanceof Error ? err.message : String(err),
        keyPrefix,
        keySource: source,
        keyName: name,
      },
      { status: 502 },
    );
  }
}
