import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { listAdmins, removeAdmin, requireAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { userId } = await ctx.params;
  const n = Number(userId);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "invalid userId" }, { status: 400 });
  }
  // Don't let the last admin remove themselves and brick the system.
  const admins = await listAdmins();
  if (admins.length <= 1) {
    return NextResponse.json(
      { error: "can't remove the last admin" },
      { status: 400 },
    );
  }
  await removeAdmin(n);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.admin_remove",
    target: String(n),
  });
  return NextResponse.json({ ok: true });
}
