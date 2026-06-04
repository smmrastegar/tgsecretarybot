import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, setChatAutomation } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle per-chat automation flags. Only the keys present in the
// body are touched — undefined means "leave alone".
export async function PATCH(
  request: Request,
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
  const body = (await request.json().catch(() => ({}))) as {
    autoForwardVoice?: boolean;
    autoForwardVideo?: boolean;
    autoForwardPhoto?: boolean;
    autoForwardLocation?: boolean;
    autoExtractNotes?: boolean;
  };
  await setChatAutomation(chatId, body);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.automation_update",
    target: String(chatId),
    details: body,
  });
  return NextResponse.json({ ok: true });
}
