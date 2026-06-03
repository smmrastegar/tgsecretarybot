import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getActiveKey, maskKey } from "@/lib/hikerapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// HikerAPI has no $-level account/usage endpoint exposed to API
// clients — `/v1/auth/me`, `/v1/account`, `/v1/usage` all 404. So
// this route now just confirms the key is loaded and from which
// source. The owner gets actual spend numbers from the local
// "💵 بودجه HikerAPI" card right below this one.
export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { key, source, name } = await getActiveKey();
  const keyPrefix = maskKey(key);
  return NextResponse.json({
    ok: !!key,
    configured: !!key,
    keyPrefix,
    keySource: source,
    keyName: name,
  });
}
