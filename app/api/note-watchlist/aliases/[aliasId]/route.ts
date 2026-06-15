import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { deleteNoteWatchAlias } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ aliasId: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { aliasId } = await ctx.params;
  const id = Number(aliasId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteNoteWatchAlias(id);
  return NextResponse.json({ ok: true });
}
