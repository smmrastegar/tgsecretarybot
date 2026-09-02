import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  audit,
  countChatHistoryOlderThan,
  deleteChatHistoryOlderThan,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET preview: how many rows would be deleted.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id: idStr } = await ctx.params;
  const chatId = Number(idStr);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  if (!Number.isFinite(days) || days < 1) {
    return NextResponse.json({ error: "days >= 1 required" }, { status: 400 });
  }
  const stats = await countChatHistoryOlderThan({ chatId, olderThanDays: days });
  return NextResponse.json({ ok: true, days, ...stats });
}

// DELETE executes the purge. Destructive — operator confirms in UI.
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const chatId = Number(idStr);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  if (!Number.isFinite(days) || days < 1) {
    return NextResponse.json({ error: "days >= 1 required" }, { status: 400 });
  }
  const result = await deleteChatHistoryOlderThan({
    chatId,
    olderThanDays: days,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.history.purge",
    target: String(chatId),
    details: { days, ...result },
  });
  return NextResponse.json({ ok: true, days, ...result });
}
