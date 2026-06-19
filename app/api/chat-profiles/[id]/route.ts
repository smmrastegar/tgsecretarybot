import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  deleteChatProfile,
  getChatProfile,
  hasDb,
  listChatsInProfile,
  updateChatProfile,
  type ChatProfilePatch,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const profile = await getChatProfile(id);
  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const chats = await listChatsInProfile(id);
  return NextResponse.json({ profile, chats });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as ChatProfilePatch;
  await updateChatProfile({ id, ...body });
  const profile = await getChatProfile(id);
  return NextResponse.json({ ok: true, profile });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const existing = await getChatProfile(id);
  if (!existing) return NextResponse.json({ ok: true });
  if (existing.isDefault || existing.isBuiltin) {
    return NextResponse.json(
      { error: "نمی‌شه پروفایل پیش‌فرض/builtin رو پاک کرد" },
      { status: 400 },
    );
  }
  await deleteChatProfile(id);
  return NextResponse.json({ ok: true });
}
