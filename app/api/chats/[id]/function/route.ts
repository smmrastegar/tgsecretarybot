import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  FUNCTION_ROLES,
  setChatFunction,
  type FunctionRole,
} from "@/lib/db";

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
    role?: FunctionRole | null;
    config?: Record<string, unknown> | null;
  };
  const role =
    body.role && (FUNCTION_ROLES as readonly string[]).includes(body.role)
      ? body.role
      : null;
  const config =
    body.config && typeof body.config === "object" ? body.config : null;
  await setChatFunction(chatId, role, config);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "chat.function_set",
    target: String(chatId),
    details: { role, config },
  });
  return NextResponse.json({ ok: true });
}
