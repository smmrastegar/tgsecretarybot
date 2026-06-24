import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, dedupeSmsMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/chats/[id]/dedupe-sms?windowSeconds=120
// Finds messages_log rows where the same (chat_id, message_text) appears
// more than once within a short window — keeps the earliest, deletes the
// rest. Targets sms_webhook duplicates from the Android forwarder.
export async function POST(
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
  const windowSeconds = Math.max(
    Number(url.searchParams.get("windowSeconds") ?? "300"),
    10,
  );
  const result = await dedupeSmsMessages({ chatId, windowSeconds });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.sms.dedupe",
    target: String(chatId),
    details: { windowSeconds, ...result },
  });
  return NextResponse.json({ ok: true, ...result });
}
