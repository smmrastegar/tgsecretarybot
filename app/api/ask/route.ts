import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  audit,
  findCachedAsk,
  hasDb,
  listAskQueries,
  saveAskQuery,
  sql,
} from "@/lib/db";
import { askMessages } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How long a fresh cached answer counts as "still good". Beyond this
// we re-run the AI. The owner can also force a re-run from the UI
// (which sends ?force=1) which bypasses the cache.
const CACHE_TTL_MINUTES = 60;

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const items = await listAskQueries(30);
  return NextResponse.json({ items });
}

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
    force?: boolean;
  };
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  const days = Math.min(Math.max(Number(body.days ?? 30), 1), 365);
  const limit = Math.min(Math.max(Number(body.limit ?? 1500), 50), 3000);
  const force = Boolean(body.force);

  // sha256(prompt_normalised|days) — same query, same days → same hash.
  const promptHash = createHash("sha256")
    .update(`${prompt.replace(/\s+/g, " ").trim().toLowerCase()}|${days}`)
    .digest("hex");

  // Cache hit — return immediately without burning AI tokens unless
  // the user explicitly hit "Re-run".
  if (!force) {
    const cached = await findCachedAsk(promptHash, days, CACHE_TTL_MINUTES);
    if (cached) {
      return NextResponse.json({
        ok: true,
        cached: true,
        id: cached.id,
        answer: cached.answer,
        scannedMessages: cached.scannedMessages,
        days: cached.days,
        createdAt: cached.createdAt,
      });
    }
  }

  // Pull recent messages. We JOIN chat_rules so we can use the
  // owner-set firstName/lastName (or nickname) as the chat label;
  // chats with no custom name fall back to chat_title or
  // "chat <id>". Skip muted chats and bot-echo rows.
  const rows = (await sql()`
    SELECT m.created_at, m.chat_id,
           m.sender_name, m.message_text,
           m.transcript, m.media_description, m.media_kind,
           COALESCE(
             NULLIF(TRIM(CONCAT_WS(' ', r.first_name, r.last_name)), ''),
             r.nickname,
             m.chat_title,
             'chat ' || m.chat_id::text
           ) AS display_label
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE m.created_at > NOW() - (${days} || ' days')::INTERVAL
      AND COALESCE(r.muted, FALSE) = FALSE
      AND COALESCE(m.source, '') NOT IN ('bot_echo', 'ai_chat', 'auto_reply', 'friendly_reply', 'ai_dashboard')
    ORDER BY m.created_at DESC
    LIMIT ${limit}`) as Array<{
    created_at: Date;
    chat_id: string;
    sender_name: string;
    message_text: string;
    transcript: string | null;
    media_description: string | null;
    media_kind: string | null;
    display_label: string;
  }>;

  const settings = await getSettings();
  const messages = rows.map((r) => ({
    chatTitle: r.display_label,
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

  const id = await saveAskQuery({
    prompt,
    promptHash,
    answer,
    scannedMessages: messages.length,
    days,
    createdBy: session.userId,
  }).catch(() => 0);

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "ask.query",
    target: id ? String(id) : null,
    details: {
      promptLength: prompt.length,
      days,
      limit,
      msgCount: messages.length,
      cached: false,
    },
  });
  return NextResponse.json({
    ok: true,
    cached: false,
    id,
    answer,
    scannedMessages: messages.length,
    days,
  });
}
