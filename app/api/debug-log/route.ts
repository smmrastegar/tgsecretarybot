import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { debugLogTypeBuckets, listDebugLog } from "@/lib/db";
import { redisEnabled } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!redisEnabled()) {
    return NextResponse.json({
      ok: true,
      rows: [],
      buckets: [],
      warning:
        "Redis not configured (UPSTASH_REDIS_REST_URL / TOKEN). Debug log requires Redis.",
    });
  }
  const url = new URL(request.url);
  const updateType = url.searchParams.get("type");
  const chatIdRaw = url.searchParams.get("chatId");
  const chatId = chatIdRaw ? Number(chatIdRaw) : null;
  const q = url.searchParams.get("q");
  const limit = Number(url.searchParams.get("limit") ?? 500);
  const [rows, buckets] = await Promise.all([
    listDebugLog({
      updateType,
      chatId: Number.isFinite(chatId) ? chatId : null,
      q,
      limit: Number.isFinite(limit) ? limit : 500,
    }),
    debugLogTypeBuckets(),
  ]);
  return NextResponse.json({ ok: true, rows, buckets });
}
