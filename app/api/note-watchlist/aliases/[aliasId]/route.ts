import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { deleteNoteWatchAlias } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ aliasId: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { aliasId } = await ctx.params;
  const id = Number(aliasId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deleteNoteWatchAlias(id);
  return NextResponse.json({ ok: true });
}
