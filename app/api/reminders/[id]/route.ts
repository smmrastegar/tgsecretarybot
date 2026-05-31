import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, markExtractedDone } from "@/lib/db";

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
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { done?: boolean };
  await markExtractedDone(n, body.done !== false);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: body.done === false ? "reminder.undone" : "reminder.done",
    target: String(n),
  });
  return NextResponse.json({ ok: true });
}
