import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { archiveChatNote, audit, deleteChatNote } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
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
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const ok = await deleteChatNote(n);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "note.delete",
    target: String(n),
  });
  return NextResponse.json({ ok });
}

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
  const body = (await request.json().catch(() => ({}))) as {
    archived?: boolean;
  };
  if (typeof body.archived === "boolean") {
    await archiveChatNote(n, body.archived);
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: body.archived ? "note.archive" : "note.unarchive",
      target: String(n),
    });
  }
  return NextResponse.json({ ok: true });
}
