import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { setChatFollowUp } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    thresholdHours?: number;
    escalateHours?: number;
  };
  await setChatFollowUp({
    chatId,
    enabled: body.enabled,
    thresholdHours:
      body.thresholdHours == null ? undefined : Number(body.thresholdHours),
    escalateHours:
      body.escalateHours == null ? undefined : Number(body.escalateHours),
  });
  return NextResponse.json({ ok: true });
}
