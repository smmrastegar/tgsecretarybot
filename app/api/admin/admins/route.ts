import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { addAdmin, listAdmins, requireAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
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
  const admins = await listAdmins();
  return NextResponse.json({ ok: true, admins });
}

export async function POST(request: Request): Promise<NextResponse> {
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
  const body = (await request.json().catch(() => ({}))) as {
    userId?: number | string;
    username?: string;
    firstName?: string;
  };
  const userId = Number(body.userId);
  if (!Number.isFinite(userId) || userId === 0) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  await addAdmin({
    userId,
    username: body.username ?? null,
    firstName: body.firstName ?? null,
    addedBy: session.userId,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "admin.admin_add",
    target: String(userId),
  });
  return NextResponse.json({ ok: true });
}
