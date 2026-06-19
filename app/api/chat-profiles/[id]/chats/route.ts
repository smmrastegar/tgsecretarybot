import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  assignChatToProfile,
  bulkAssignProfile,
  getChatProfile,
  hasDb,
  listChatsInProfile,
  searchChatsNotInProfile,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const profileId = Number(idStr);
  if (!Number.isFinite(profileId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const search = url.searchParams.get("search");
  const [profile, members, candidates] = await Promise.all([
    getChatProfile(profileId),
    listChatsInProfile(profileId),
    search != null
      ? searchChatsNotInProfile({ profileId, q: search, limit: 50 })
      : Promise.resolve([] as Array<{
          chatId: number;
          name: string | null;
          chatType: string;
        }>),
  ]);
  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ profile, members, candidates });
}

export async function POST(
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
  const profileId = Number(idStr);
  if (!Number.isFinite(profileId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    chatIds?: number[];
    chatId?: number;
  };
  const chatIds = Array.isArray(body.chatIds)
    ? body.chatIds.map(Number).filter(Number.isFinite)
    : body.chatId != null && Number.isFinite(Number(body.chatId))
      ? [Number(body.chatId)]
      : [];
  if (chatIds.length === 0) {
    return NextResponse.json({ error: "chatIds[] required" }, { status: 400 });
  }
  const affected = await bulkAssignProfile(chatIds, profileId);
  return NextResponse.json({ ok: true, affected });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: idStr } = await ctx.params;
  const profileId = Number(idStr);
  if (!Number.isFinite(profileId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    chatId?: number;
  };
  const chatId = Number(body.chatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  // Removing from a profile = move back to the default profile (which
  // takes effect by setting profile_id = NULL since the resolver
  // falls back to default automatically).
  await assignChatToProfile(chatId, null);
  return NextResponse.json({ ok: true });
}
