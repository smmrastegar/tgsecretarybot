import { NextResponse } from "next/server";
import {
  BOARD_STATUSES,
  createBoardTask,
  deleteBoardTask,
  getChatIdByShareToken,
  listBoardTasks,
  seedBoardFromAnalysisOnce,
  updateBoardTask,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Editable group task board, authorised by the group's share token (the
// same token the read-only /share/groups/<token> uses). Anyone with the
// link can view AND edit — that's intentional; the operator hands it to
// a trusted teammate. Scoped to a single group: the token resolves to
// exactly one chat_id.
async function resolveChat(token: string) {
  return getChatIdByShareToken(token).catch(() => null);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await resolveChat(token);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });
  // First open: pre-populate from the AI analysis so the board isn't empty.
  await seedBoardFromAnalysisOnce(chat.chatId).catch(() => {});
  const tasks = await listBoardTasks(chat.chatId);
  return NextResponse.json({
    ok: true,
    chatTitle: chat.chatTitle,
    statuses: BOARD_STATUSES,
    tasks,
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await resolveChat(token);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as {
    title?: string;
    status?: string;
    assignee?: string | null;
    topic?: string | null;
    note?: string | null;
    createdBy?: string | null;
  };
  const title = (b.title ?? "").toString().trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const task = await createBoardTask({
    chatId: chat.chatId,
    title,
    status: b.status,
    assignee: b.assignee ?? null,
    topic: b.topic ?? null,
    note: b.note ?? null,
    createdBy: (b.createdBy ?? "").toString().slice(0, 60) || null,
    source: "manual",
  });
  return NextResponse.json({ ok: true, task });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await resolveChat(token);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as {
    id?: number;
    title?: string;
    status?: string;
    assignee?: string | null;
    topic?: string | null;
    note?: string | null;
  };
  const id = Number(b.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const task = await updateBoardTask({
    id,
    chatId: chat.chatId,
    title: b.title,
    status: b.status,
    assignee: "assignee" in b ? b.assignee ?? null : undefined,
    topic: "topic" in b ? b.topic ?? null : undefined,
    note: "note" in b ? b.note ?? null : undefined,
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, task });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const chat = await resolveChat(token);
  if (!chat) return NextResponse.json({ error: "invalid token" }, { status: 404 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteBoardTask({ id, chatId: chat.chatId });
  return NextResponse.json({ ok });
}
