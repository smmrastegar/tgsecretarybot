import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
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
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string; threadId: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
  if (typeof body.archived === "boolean") {
    await setForumTopicArchived({
      chatId,
      messageThreadId: tid,
      archived: body.archived,
    });
    return NextResponse.json({ ok: true, archived: body.archived });
  }
  if ("notes" in body) {
    const notes =
      typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
    await setForumTopicNotes({
      chatId,
      messageThreadId: tid,
      notes,
    });
    return NextResponse.json({ ok: true, notes: notes?.trim() || null });
  }
  if ("name" in body) {
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
    return NextResponse.json({ ok: true, name });
  }
  return NextResponse.json(
    {
      error:
        "send {name: ...} or {archived: true|false} or {notes: '...'}",
    },
    { status: 400 },
  );
}
