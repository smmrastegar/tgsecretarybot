import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  debugLogTypeBuckets,
  hasDb,
  listDebugLog,
  pruneDebugLog,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const url = new URL(request.url);
  const updateType = url.searchParams.get("type");
  const chatIdRaw = url.searchParams.get("chatId");
  const chatId = chatIdRaw ? Number(chatIdRaw) : null;
  const q = url.searchParams.get("q");
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const [rows, buckets] = await Promise.all([
    listDebugLog({
      updateType,
      chatId: Number.isFinite(chatId) ? chatId : null,
      q,
      limit: Number.isFinite(limit) ? limit : 200,
    }),
    debugLogTypeBuckets(),
  ]);
  return NextResponse.json({ ok: true, rows, buckets });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 7);
  const keepN = Number(url.searchParams.get("keep") ?? 10000);
  const result = await pruneDebugLog({
    olderThanDays: Number.isFinite(days) ? days : 7,
    keepLastN: Number.isFinite(keepN) ? keepN : 10000,
  });
  return NextResponse.json({ ok: true, ...result });
}
