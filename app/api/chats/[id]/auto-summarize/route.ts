import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, setAutoSummarize } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
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
    enabled?: boolean;
    gapMinutes?: number;
  };
  const enabled = Boolean(body.enabled);
  const gap = Number(body.gapMinutes);
  await setAutoSummarize(chatId, enabled, Number.isFinite(gap) ? gap : 5);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.auto_summarize_set",
    target: String(chatId),
    details: { enabled, gapMinutes: gap },
  });
  return NextResponse.json({ ok: true });
}
