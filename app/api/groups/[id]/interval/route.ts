import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getChatSummaryIntervalHours,
  setChatSummaryIntervalHours,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const hours = await getChatSummaryIntervalHours(chatId);
  return NextResponse.json({ hours });
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    hours?: number | null;
  };
  // null clears (revert to default). 1..168 is the valid range.
  let hours: number | null = null;
  if (body.hours != null) {
    const n = Number(body.hours);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "invalid hours" }, { status: 400 });
    }
    hours = Math.min(Math.max(Math.round(n), 1), 168);
  }
  await setChatSummaryIntervalHours({ chatId, hours });
  return NextResponse.json({ hours });
}
