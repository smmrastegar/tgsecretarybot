import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, markMessageHandled, unhandleMessage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    handled?: boolean;
    notes?: string;
  };
  if (body.handled === false) {
    await unhandleMessage(messageId);
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "message.unhandle",
      target: String(messageId),
    });
  } else {
    await markMessageHandled(messageId, session.userId, body.notes);
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "message.handle",
      target: String(messageId),
      details: { notes: body.notes },
    });
  }
  return NextResponse.json({ ok: true });
}
