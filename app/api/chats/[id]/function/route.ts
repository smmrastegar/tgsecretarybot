import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  FUNCTION_ROLES,
  setChatFunction,
  setChatFunctionRoles,
  type FunctionRole,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accepts either:
//   {role: "storage"} | {role: null}             ← legacy single-role
//   {roles: ["storage", "voice_storage", ...]}   ← new multi-role
// When roles[] is provided, it wins and replaces the entire set.
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
    roles?: FunctionRole[];
    config?: Record<string, unknown> | null;
  };
  const config =
    body.config && typeof body.config === "object" ? body.config : null;
  if (Array.isArray(body.roles)) {
    const roles = body.roles.filter((r): r is FunctionRole =>
      (FUNCTION_ROLES as readonly string[]).includes(r),
    );
    await setChatFunctionRoles(chatId, roles);
    // function_config still lives on chat_rules row; legacy
    // setChatFunction handles config-only writes when role hasn't
    // changed semantically.
    if (config) {
      await setChatFunction(chatId, roles[0] ?? null, config);
    }
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "chat.function_set_many",
      target: String(chatId),
      details: { roles, config },
    });
    return NextResponse.json({ ok: true, roles });
  }
  const role =
    body.role && (FUNCTION_ROLES as readonly string[]).includes(body.role)
      ? body.role
      : null;
  // Single-role write: replace the whole set with just this one role.
  await setChatFunctionRoles(chatId, role ? [role] : []);
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
