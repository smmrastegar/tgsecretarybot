import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { setChatFollowUp } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
