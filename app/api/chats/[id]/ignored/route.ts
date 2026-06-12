import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, invalidateIgnoredCache, setChatIgnored } from "@/lib/db";

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
    ignored?: boolean;
  };
  const ignored = Boolean(body.ignored);
  await setChatIgnored(chatId, ignored);
  invalidateIgnoredCache(chatId);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.set_ignored",
    target: String(chatId),
    details: { ignored },
  });
  return NextResponse.json({ ok: true, ignored });
}
