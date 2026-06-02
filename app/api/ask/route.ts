import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, hasDb, sql } from "@/lib/db";
import { askMessages } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "db not configured" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    days?: number;
    limit?: number;
  };
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  const days = Math.min(Math.max(Number(body.days ?? 30), 1), 365);
  const limit = Math.min(Math.max(Number(body.limit ?? 1500), 50), 3000);

  // Pull recent messages across all chats. We prefer transcript /
  // media_description when present so voice/photo messages are
  // searchable too. Skip muted chats and bot-echo rows so the AI
  // doesn't see its own outgoing.
  const rows = (await sql()`
    SELECT m.created_at, m.chat_title, m.sender_name, m.message_text,
           m.transcript, m.media_description, m.media_kind
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE m.created_at > NOW() - (${days} || ' days')::INTERVAL
      AND COALESCE(r.muted, FALSE) = FALSE
      AND COALESCE(m.source, '') NOT IN ('bot_echo', 'ai_chat', 'auto_reply', 'friendly_reply', 'ai_dashboard')
    ORDER BY m.created_at DESC
    LIMIT ${limit}`) as Array<{
    created_at: Date;
    chat_title: string | null;
    sender_name: string;
    message_text: string;
    transcript: string | null;
    media_description: string | null;
    media_kind: string | null;
  }>;

  const settings = await getSettings();
  const messages = rows.map((r) => ({
    chatTitle: r.chat_title,
    senderName: r.sender_name,
    text: r.transcript
      ? r.transcript
      : r.media_description
        ? `[${r.media_kind ?? "media"}] ${r.media_description}`
        : r.message_text,
    at: r.created_at,
  }));

  let answer = "";
  try {
    answer = await askMessages({
      prompt,
      ownerName: settings.ownerName,
      ownerContext: settings.ownerContext,
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err).slice(0, 500) },
      { status: 500 },
    );
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "ask.query",
    details: { promptLength: prompt.length, days, limit, msgCount: messages.length },
  });
  return NextResponse.json({
    ok: true,
    answer,
    scannedMessages: messages.length,
    days,
  });
}
