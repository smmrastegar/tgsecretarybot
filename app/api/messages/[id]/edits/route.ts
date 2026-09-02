import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getMessageEdits } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const edits = await getMessageEdits(messageId);
  return NextResponse.json({ edits });
}
