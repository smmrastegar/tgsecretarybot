import { NextResponse } from "next/server";
import { listTaskComments, addTaskComment, logBoardEvent, getBoardTask } from "@/lib/db";
import { authBoard } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List comments for one task.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  const taskId = Number(new URL(req.url).searchParams.get("taskId"));
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  const comments = await listTaskComments(auth!.chatId, taskId);
  return NextResponse.json({
    ok: true,
    comments: comments.map((c) => ({
      id: c.id, author: c.author, body: c.body, createdAt: c.createdAt,
    })),
  });
}

// Add a comment to a task (any approved member or the owner).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { taskId?: number; body?: string };
  const taskId = Number(body.taskId);
  const text = (body.body ?? "").toString().trim();
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "empty comment" }, { status: 400 });

  const comment = await addTaskComment({
    chatId: auth!.chatId,
    taskId,
    author: auth!.actor,
    body: text,
  });
  if (!comment) return NextResponse.json({ error: "task not found" }, { status: 404 });

  const task = await getBoardTask(taskId, auth!.chatId).catch(() => null);
  await logBoardEvent({
    chatId: auth!.chatId,
    taskId,
    action: "comment",
    actor: auth!.actor,
    summary: `💬 روی «${(task?.title ?? "").slice(0, 40)}»: ${text.slice(0, 60)}`,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    comment: { id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt },
  });
}
