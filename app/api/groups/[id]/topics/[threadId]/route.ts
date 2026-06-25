import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { hasDb, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/groups/[id]/topics/[threadId]  body: { name: string | null }
// Telegram Bot API can't fetch the topic list retroactively — the bot
// only learns a topic_name from forum_topic_created/edited updates.
// When the bot joined after a topic was created, the name is null and
// the dashboard shows «Topic #N». This endpoint lets the operator
// rename it manually so the analyzer and topic viewer have the real
// label.
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
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 128)
      : null;
  // Insert if the row didn't exist (bot may have seen messages from
  // this topic but missed the forum_topic_created event).
  await sql()`
    INSERT INTO forum_topics (chat_id, message_thread_id, name)
    VALUES (${chatId}, ${tid}, ${name})
    ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
      name = ${name},
      observed_at = NOW()`;
  return NextResponse.json({ ok: true, name });
}
