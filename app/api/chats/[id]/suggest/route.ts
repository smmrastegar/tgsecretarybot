import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getChatRule, listMessages, sql, hasDb } from "@/lib/db";
import { suggestChatSettings } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chat id" }, { status: 400 });
  }
  if (!hasDb()) {
    return NextResponse.json(
      { error: "DATABASE_URL not set" },
      { status: 503 },
    );
  }
  const rule = await getChatRule(chatId);
  const settings = await getSettings();
  const messages = await listMessages({ chatId, limit: 60, offset: 0 });
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "این چت پیامی نداره که AI روش حساب کنه" },
      { status: 400 },
    );
  }
  // Grab a handful of already-labelled chats with the same chat_type
  // as examples. We don't want to dump our entire roster; ~8 of the
  // most recently-updated labelled chats is enough pattern.
  const exampleRows = await sql()`
    SELECT chat_id, first_name, last_name, nickname, relationship,
           relationship_notes, talk_style_notes
    FROM chat_rules
    WHERE chat_id <> ${chatId}
      AND chat_type = ${rule?.chatType ?? (chatId < 0 ? "supergroup" : "private")}
      AND relationship IS NOT NULL
      AND (first_name IS NOT NULL OR nickname IS NOT NULL)
    ORDER BY updated_at DESC
    LIMIT 8`;
  const examples = await Promise.all(
    (exampleRows as Array<{
      chat_id: string;
      first_name: string | null;
      last_name: string | null;
      nickname: string | null;
      relationship: string | null;
      relationship_notes: string | null;
      talk_style_notes: string | null;
    }>).map(async (r) => {
      const sample = await listMessages({
        chatId: Number(r.chat_id),
        limit: 5,
        offset: 0,
      });
      return {
        firstName: r.first_name,
        lastName: r.last_name,
        nickname: r.nickname,
        relationship: r.relationship,
        relationshipNotes: r.relationship_notes,
        talkStyleNotes: r.talk_style_notes,
        sampleMessages: sample
          .map((m) => m.messageText ?? "")
          .filter((t) => t.length > 0)
          .slice(0, 5),
      };
    }),
  );
  try {
    // Compose a hint with whatever raw Telegram-supplied names we
    // have so the AI can transliterate them to Persian. The
    // Telegram first/last names usually live on the messages_log
    // rows (sender_name) for the non-owner messages; we surface
    // the first one as a clue + the per-chat title.
    const senderNameHint =
      messages.find((m) => !m.fromOwner)?.senderName ?? null;
    const suggestion = await suggestChatSettings({
      chatId,
      chatType:
        rule?.chatType ?? (chatId < 0 ? "supergroup" : "private"),
      chatTitle: rule?.chatTitle ?? senderNameHint,
      ownerName: settings.ownerName ?? "owner",
      // oldest first so the AI sees the conversation in order
      messages: messages
        .slice()
        .reverse()
        .map((m) => ({
          fromOwner: m.fromOwner,
          senderName: m.senderName ?? "unknown",
          text: m.messageText ?? "",
          at: m.createdAt,
        })),
      examples,
    });
    return NextResponse.json({ ok: true, suggestion });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
