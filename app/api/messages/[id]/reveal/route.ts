import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getPrivateMessage, revealPrivateMessage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const row = await getPrivateMessage(id);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.isPrivate && !row.revealedAt) {
    await revealPrivateMessage(id);
  }
  return NextResponse.json({ ok: true, body: row.body });
}
