import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ackChatFollowUp } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
  await ackChatFollowUp(chatId);
  return NextResponse.json({ ok: true });
}
