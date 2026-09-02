import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { assignChatToProfile } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id: idStr } = await ctx.params;
  const chatId = Number(idStr);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    profileId?: number | null;
  };
  const pid =
    body.profileId == null || body.profileId === 0 ? null : Number(body.profileId);
  await assignChatToProfile(chatId, pid);
  return NextResponse.json({ ok: true });
}
