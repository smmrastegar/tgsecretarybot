import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, hasDb, saveExtractedItems, sql } from "@/lib/db";
import { extractActions } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Row = {
  chat_id: number;
  chat_title: string | null;
  sender_name: string;
  message_text: string;
  transcript: string | null;
  business_connection_id: string;
};

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
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
    SELECT chat_id, chat_title, sender_name, message_text, transcript,
           business_connection_id
    FROM messages_log WHERE id = ${messageId} LIMIT 1`;
  const row = rows[0] as Row | undefined;
  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const sourceText = (row.transcript ?? row.message_text ?? "").trim();
  if (!sourceText) {
    return NextResponse.json(
      { error: "nothing to extract from" },
      { status: 400 },
    );
  }

  try {
    const items = await extractActions({
      text: sourceText,
      senderName: row.sender_name,
      chatId: Number(row.chat_id),
      businessConnectionId: row.business_connection_id,
    });
    const valid = items
      .filter((it) => it && typeof it.title === "string" && it.title.trim())
      .map((it) => ({
        messageId,
        chatId: Number(row.chat_id),
        chatTitle: row.chat_title,
        senderName: row.sender_name,
        kind: typeof it.kind === "string" ? it.kind : "note",
        title: it.title.trim().slice(0, 200),
        description: it.description ?? null,
        dueAt: it.due_at ? safeDate(it.due_at) : null,
        location: it.location ?? null,
        participants:
          Array.isArray(it.participants) &&
          it.participants.every((p) => typeof p === "string")
            ? (it.participants as string[])
            : null,
      }));
    const n = await saveExtractedItems(valid);
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "message.extract",
      target: String(messageId),
      details: { saved: n, kinds: valid.map((v) => v.kind) },
    });
    return NextResponse.json({ ok: true, items: valid, saved: n });
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 500) },
      { status: 500 },
    );
  }
}

function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
