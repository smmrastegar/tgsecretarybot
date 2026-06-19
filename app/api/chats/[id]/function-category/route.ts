import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  FUNCTION_ROLES,
  setChatFunctionCategory,
  type FunctionRole,
} from "@/lib/db";

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
  const { id: idStr } = await ctx.params;
  const chatId = Number(idStr);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    role?: FunctionRole;
    category?: string;
  };
  if (!body.role || !(FUNCTION_ROLES as readonly string[]).includes(body.role)) {
    return NextResponse.json(
      { error: `role required (one of: ${FUNCTION_ROLES.join(", ")})` },
      { status: 400 },
    );
  }
  const cat = (body.category ?? "default").toLowerCase().slice(0, 64);
  await setChatFunctionCategory({
    chatId,
    role: body.role,
    category: cat,
  });
  return NextResponse.json({ ok: true });
}
