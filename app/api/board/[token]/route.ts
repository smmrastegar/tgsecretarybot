import { NextResponse } from "next/server";
import {
  BOARD_STATUSES,
  createBoardTask,
  deleteBoardTask,
  getBoardTask,
  listBoardTasks,
  logBoardEvent,
  parseBoardColumns,
  parseBoardLabels,
  parseBoardPriorities,
  seedBoardFromAnalysisOnce,
  updateBoardTask,
} from "@/lib/db";
import { authBoard } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  await seedBoardFromAnalysisOnce(auth!.chatId).catch(() => {});
  const tasks = await listBoardTasks(auth!.chatId);
  return NextResponse.json({
    ok: true,
    chatTitle: auth!.chatTitle,
    statuses: BOARD_STATUSES,
    columns: parseBoardColumns(auth!.boardColumns),
    labels: parseBoardLabels(auth!.boardLabels),
    priorities: parseBoardPriorities(auth!.boardPriorities),
    prompt: auth!.boardPrompt ?? "",
    tasks,
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; status?: string; assignee?: string | null };
  const title = (b.title ?? "").toString().trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const task = await createBoardTask({
    chatId: auth!.chatId,
    title,
    status: b.status,
    assignee: b.assignee ?? null,
    createdBy: auth!.actor,
    source: "manual",
  });
  if (task) {
    await logBoardEvent({
      chatId: auth!.chatId,
      taskId: task.id,
      action: "create",
      actor: auth!.actor,
      summary: `«${title.slice(0, 60)}» را افزود`,
      after: task,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, task });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    id?: number; title?: string; status?: string; assignee?: string | null; topic?: string | null; note?: string | null;
    priority?: string | null; labels?: string[] | null; dueDate?: string | null;
  };
  const id = Number(b.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const before = await getBoardTask(id, auth!.chatId);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const task = await updateBoardTask({
    id,
    chatId: auth!.chatId,
    title: b.title,
    status: b.status,
    assignee: "assignee" in b ? b.assignee ?? null : undefined,
    topic: "topic" in b ? b.topic ?? null : undefined,
    note: "note" in b ? b.note ?? null : undefined,
    priority: "priority" in b ? b.priority ?? null : undefined,
    labels: "labels" in b ? (Array.isArray(b.labels) ? b.labels.map(String).slice(0, 30) : null) : undefined,
    dueDate: "dueDate" in b ? (b.dueDate ? String(b.dueDate).slice(0, 10) : null) : undefined,
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Describe what changed for the log.
  const parts: string[] = [];
  if (b.status && b.status !== before.status) parts.push(`وضعیت → ${b.status}`);
  if ("assignee" in b && (b.assignee ?? null) !== before.assignee) parts.push(`مسئول → ${b.assignee || "—"}`);
  if (b.title && b.title !== before.title) parts.push("عنوان ویرایش شد");
  if ("priority" in b && (b.priority ?? null) !== before.priority) parts.push(`اولویت → ${b.priority || "—"}`);
  if ("labels" in b) parts.push("برچسب‌ها ویرایش شد");
  if ("dueDate" in b && (b.dueDate ?? null) !== before.dueDate) parts.push(`سررسید → ${b.dueDate || "—"}`);
  if ("note" in b && (b.note ?? null) !== before.note) parts.push("توضیحات ویرایش شد");
  const summary = `«${before.title.slice(0, 40)}»: ${parts.join("، ") || "ویرایش"}`;
  await logBoardEvent({
    chatId: auth!.chatId, taskId: id, action: "update", actor: auth!.actor,
    summary, before, after: task,
  }).catch(() => {});
  return NextResponse.json({ ok: true, task });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const before = await getBoardTask(id, auth!.chatId);
  const ok = await deleteBoardTask({ id, chatId: auth!.chatId });
  if (ok && before) {
    await logBoardEvent({
      chatId: auth!.chatId, taskId: id, action: "delete", actor: auth!.actor,
      summary: `«${before.title.slice(0, 60)}» را حذف کرد`, before,
    }).catch(() => {});
  }
  return NextResponse.json({ ok });
}
