import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { ackChatFollowUp } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await ackChatFollowUp(chatId);
  return NextResponse.json({ ok: true });
}
