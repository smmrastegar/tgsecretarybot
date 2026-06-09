import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  addRuleExample,
  audit,
  createMessageRule,
  hasDb,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Turn a logged message into a rule. Two modes:
//   action="create"  →  create a new rule using the message text as the
//                       first example and the operator-supplied name +
//                       description as the primary fields.
//   action="add"     →  append the message text as an example to an
//                       existing rule.
//
// Either way the message body is pulled from messages_log so the
// client only needs to pass messageLogId.
export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "no db" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    messageLogId?: number;
    action?: "create" | "add";
    ruleId?: number;
    name?: string;
    description?: string;
    label?: string;
  };
  const logId = Number(body.messageLogId);
  if (!Number.isFinite(logId)) {
    return NextResponse.json(
      { error: "messageLogId required" },
      { status: 400 },
    );
  }
  const rows = await sql()`
    SELECT message_text, transcript, media_description
    FROM messages_log
    WHERE id = ${logId}
    LIMIT 1`;
  const r = rows[0] as
    | {
        message_text: string;
        transcript: string | null;
        media_description: string | null;
      }
    | undefined;
  if (!r) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }
  // Prefer transcript / media description when the original is just a
  // placeholder like "[voice]".
  let text =
    r.transcript ?? r.media_description ?? r.message_text ?? "";
  if (
    (!text || /^\[(voice|photo|video|video_note|sticker|gif|audio)\]/i.test(
      text,
    )) &&
    r.message_text &&
    r.message_text !== text
  ) {
    text = r.message_text;
  }
  if (!text.trim()) {
    return NextResponse.json(
      { error: "message has no text body to use as example" },
      { status: 400 },
    );
  }

  if (body.action === "create") {
    if (!body.name?.trim() || !body.description?.trim()) {
      return NextResponse.json(
        { error: "name + description required for create" },
        { status: 400 },
      );
    }
    const rule = await createMessageRule({
      name: body.name.trim(),
      description: body.description.trim(),
      createdBy: session.userId,
    });
    await addRuleExample({
      ruleId: rule.id,
      text,
      label: body.label?.trim() || `from msg ${logId}`,
    });
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "rule.create_from_message",
      target: String(rule.id),
      details: { messageLogId: logId, name: rule.name },
    });
    return NextResponse.json({ ok: true, rule });
  }

  if (body.action === "add") {
    const ruleId = Number(body.ruleId);
    if (!Number.isFinite(ruleId)) {
      return NextResponse.json(
        { error: "ruleId required for add" },
        { status: 400 },
      );
    }
    const ex = await addRuleExample({
      ruleId,
      text,
      label: body.label?.trim() || `from msg ${logId}`,
    });
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "rule.add_example_from_message",
      target: String(ruleId),
      details: { messageLogId: logId, exampleId: ex.id },
    });
    return NextResponse.json({ ok: true, example: ex });
  }

  return NextResponse.json(
    { error: "action must be 'create' or 'add'" },
    { status: 400 },
  );
}
