import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  deleteGroupAnalytics,
  hasDb,
  setForumTopicArchived,
  setForumTopicNotes,
  sql,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/groups/[id]/topics/[threadId]
//   body: { name?: string | null, archived?: boolean, notes?: string | null }
// Telegram Bot API can't fetch the topic list retroactively — the bot
// only learns a topic_name from forum_topic_created/edited updates.
// This endpoint lets the operator rename a topic manually, archive
// it («دیگه مهم نیست»), OR write a description that the v2 analyzer
// passes to the LLM for better context per topic.
// Any change invalidates the cached group_analytics rows so the next
// view rebuilds the breakdown with the new name / skips archived /
// uses the new notes.
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string; threadId: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  if (!hasDb()) {
    return NextResponse.json({ error: "no db" }, { status: 500 });
  }
  const { id, threadId } = await ctx.params;
  const chatId = Number(id);
  const tid = Number(threadId);
  if (!Number.isFinite(chatId) || !Number.isFinite(tid)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    archived?: boolean;
    notes?: string | null;
  };
  let response: NextResponse;
  if (typeof body.archived === "boolean") {
    await setForumTopicArchived({
      chatId,
      messageThreadId: tid,
      archived: body.archived,
    });
    response = NextResponse.json({ ok: true, archived: body.archived });
  } else if ("notes" in body) {
    const notes =
      typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
    await setForumTopicNotes({
      chatId,
      messageThreadId: tid,
      notes,
    });
    response = NextResponse.json({ ok: true, notes: notes?.trim() || null });
  } else if ("name" in body) {
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 128)
        : null;
    await sql()`
      INSERT INTO forum_topics (chat_id, message_thread_id, name)
      VALUES (${chatId}, ${tid}, ${name})
      ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
        name = ${name},
        observed_at = NOW()`;
    response = NextResponse.json({ ok: true, name });
  } else {
    return NextResponse.json(
      {
        error:
          "send {name: ...} or {archived: true|false} or {notes: '...'}",
      },
      { status: 400 },
    );
  }
  // Any topic change makes the cached analytics misleading (old name in
  // breakdown, archived topic still listed, notes not in prompt). Drop
  // every window so the next view computes fresh.
  await deleteGroupAnalytics(chatId).catch(() => {});
  return response;
}
