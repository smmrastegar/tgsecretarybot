import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getActiveKey, getBalance, HikerOutOfCreditsError, maskKey } from "@/lib/hikerapi";
import { requireTenant } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  return runWithTenant(tenant.id, async () => {
    const { key, source, name } = await getActiveKey();
    const keyPrefix = maskKey(key);
    if (!key) {
      return NextResponse.json(
        {
          error: "HIKER_API_KEY not configured (tenant override / env)",
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
  });
}
