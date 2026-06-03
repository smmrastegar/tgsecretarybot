import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getActiveKey, getUsage, HikerOutOfCreditsError, maskKey } from "@/lib/hikerapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        keyPrefix: null,
        keySource: null,
        keyName: name,
      },
      { status: 503 },
    );
  }
  try {
    const usage = await getUsage();
    return NextResponse.json({
      ok: true,
      usage,
      keyPrefix,
      keySource: source,
      keyName: name,
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
        error: err instanceof Error ? err.message : String(err),
        keyPrefix,
        keySource: source,
        keyName: name,
      },
      { status: 502 },
    );
  }
}
