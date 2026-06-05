import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, getChatRule, skipChatGrace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  const existing = await getChatRule(chatId).catch(() => null);
  await skipChatGrace({
    chatId,
    chatType:
      existing?.chatType ?? (chatId < 0 ? "supergroup" : "private"),
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.skip_grace",
    target: String(chatId),
    details: {},
  });
  return NextResponse.json({ ok: true });
}
