import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { debugLogTypeBuckets, listDebugLog } from "@/lib/db";
import { redisEnabled } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
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
  return NextResponse.json({
    ok: true,
    rows,
    buckets,
    backend: redisEnabled() ? "redis" : "db-fallback",
  });
}
