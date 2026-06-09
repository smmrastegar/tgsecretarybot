import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { hasDb, sql } from "@/lib/db";
import { suggestRuleFromMessage } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST { messageLogId } → { name, description } (or empty fields).
// Used by the "📐 to rule" inline panel to pre-fill the form when the
// operator picks "rule جدید". The LLM gets the resolved message body
// (transcript / media_description / messageText, in that order) and
// returns a short rule name + description.
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "no db" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    messageLogId?: number;
    text?: string;
  };
  let text = (body.text ?? "").trim();
  if (!text && body.messageLogId != null) {
    const rows = await sql()`
      SELECT message_text, transcript, media_description
      FROM messages_log
      WHERE id = ${Number(body.messageLogId)}
      LIMIT 1`;
    const r = rows[0] as
      | {
          message_text: string;
          transcript: string | null;
          media_description: string | null;
        }
      | undefined;
    if (r) {
      text =
        r.transcript ?? r.media_description ?? r.message_text ?? "";
      if (
        /^\[(voice|photo|video|video_note|sticker|gif|audio)\]/i.test(text) &&
        r.message_text &&
        r.message_text !== text
      ) {
        text = r.message_text;
      }
    }
  }
  if (!text.trim()) {
    return NextResponse.json(
      { error: "text or messageLogId required" },
      { status: 400 },
    );
  }
  const suggestion = await suggestRuleFromMessage(text);
  return NextResponse.json({
    ok: suggestion != null,
    name: suggestion?.name ?? "",
    description: suggestion?.description ?? "",
    error: suggestion == null ? "LLM returned no usable suggestion" : null,
  });
}
