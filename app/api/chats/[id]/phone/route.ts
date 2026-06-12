import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, setChatPhoneNumber } from "@/lib/db";

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
    phoneNumber?: string | null;
  };
  const phone =
    typeof body.phoneNumber === "string" && body.phoneNumber.trim()
      ? body.phoneNumber.trim()
      : null;
  await setChatPhoneNumber(chatId, phone);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.set_phone",
    target: String(chatId),
    details: { phoneNumber: phone },
  });
  return NextResponse.json({ ok: true, phoneNumber: phone });
}
