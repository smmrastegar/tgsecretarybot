import { NextResponse } from "next/server";
import {
  deleteBoardTask,
  getBoardEvent,
  logBoardEvent,
  markBoardEventReverted,
  restoreBoardTask,
  updateBoardTask,
} from "@/lib/db";
import { authBoard } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Revert (undo) a single logged change. Applies the inverse:
//   create → delete the task
//   update → restore the task's previous field values
//   delete → re-create the task from its snapshot
// Then marks the event reverted and logs a new "revert" event.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { eventId?: number };
  const eventId = Number(b.eventId);
  if (!Number.isFinite(eventId)) return NextResponse.json({ error: "eventId required" }, { status: 400 });

  const ev = await getBoardEvent(eventId, auth!.chatId);
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ev.reverted) return NextResponse.json({ error: "already reverted" }, { status: 409 });
  if (ev.action === "revert") return NextResponse.json({ error: "cannot revert a revert" }, { status: 400 });

  let note = "";
  if (ev.action === "create" && ev.taskId != null) {
    await deleteBoardTask({ id: ev.taskId, chatId: auth!.chatId });
    note = "افزودن لغو شد (تسک حذف شد)";
  } else if (ev.action === "update" && ev.taskId != null && ev.before) {
    const bf = ev.before;
    const restored = await updateBoardTask({
      id: ev.taskId,
      chatId: auth!.chatId,
      title: String(bf.title ?? ""),
      status: String(bf.status ?? "todo"),
      assignee: (bf.assignee as string) ?? null,
      topic: (bf.topic as string) ?? null,
      note: (bf.note as string) ?? null,
      priority: (bf.priority as string) ?? null,
      labels: Array.isArray(bf.labels) ? (bf.labels as unknown[]).map(String) : null,
      dueDate: (bf.dueDate as string) ?? (bf.due_date as string) ?? null,
    });
    // If the task was deleted since, re-create it from the snapshot.
    if (!restored) await restoreBoardTask({ chatId: auth!.chatId, before: bf });
    note = "ویرایش به حالت قبل برگشت";
  } else if (ev.action === "delete" && ev.before) {
    await restoreBoardTask({ chatId: auth!.chatId, before: ev.before });
    note = "حذف لغو شد (تسک برگشت)";
  } else {
    return NextResponse.json({ error: "cannot revert this event" }, { status: 400 });
  }

  await markBoardEventReverted(eventId);
  await logBoardEvent({
    chatId: auth!.chatId,
    taskId: ev.taskId,
    action: "revert",
    actor: auth!.actor,
    summary: `↩️ بازگردانی: ${ev.summary}`,
  }).catch(() => {});
  return NextResponse.json({ ok: true, note });
}
