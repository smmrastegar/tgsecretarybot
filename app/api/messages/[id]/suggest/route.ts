import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { sql, hasDb, recentConversation, getChatRule } from "@/lib/db";
import { aiConversationReply } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "db not configured" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await sql()`
    SELECT chat_id, sender_name, business_connection_id
    FROM messages_log WHERE id = ${messageId} LIMIT 1`;
  const row = rows[0] as
    | { chat_id: number; sender_name: string; business_connection_id: string }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const settings = await getSettings();
  const [history, rule] = await Promise.all([
    recentConversation(Number(row.chat_id), 40),
    getChatRule(Number(row.chat_id)).catch(() => null),
  ]);

  try {
    const text = await aiConversationReply({
      ownerName: settings.ownerName,
      ownerDisplayName: settings.ownerDisplayName,
      ownerContext: settings.ownerContext,
      senderName: row.sender_name,
      history,
      nickname: rule?.nickname ?? null,
      relationship: rule?.relationship ?? null,
      relationshipNotes: rule?.relationshipNotes ?? null,
      talkStyleNotes: rule?.talkStyleNotes ?? null,
      toneProfile: rule?.toneProfile ?? null,
      chatNotes: rule?.notes ?? null,
      chatId: Number(row.chat_id),
      businessConnectionId: row.business_connection_id,
    });
    return NextResponse.json({ ok: true, suggestion: text });
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 500) },
      { status: 500 },
    );
  }
}
