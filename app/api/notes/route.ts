import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addChatNote,
  audit,
  chatNoteSummaryByChat,
  listChatNotes,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/notes              → per-chat summary (counts, by-kind, last-note-at)
// GET /api/notes?chatId=<id>  → notes for one chat
// GET /api/notes?kind=address → notes of a single kind, all chats
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const chatIdRaw = url.searchParams.get("chatId");
  const kindRaw = url.searchParams.get("kind");
  const includeArchived =
    url.searchParams.get("archived") === "1" ||
    url.searchParams.get("archived") === "true";
  if (chatIdRaw || kindRaw) {
    const chatId = chatIdRaw ? Number(chatIdRaw) : undefined;
    const notes = await listChatNotes({
      chatId,
      kind: kindRaw ?? undefined,
      includeArchived,
      limit: 500,
    });
    return NextResponse.json({ ok: true, notes });
  }
  const summary = await chatNoteSummaryByChat();
  return NextResponse.json({ ok: true, summary });
}

// Manual add (the auto-extract pipeline calls this internally via
// the DB helper, but admin / owner can also create notes by hand).
export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    chatId?: number;
    kind?: string;
    title?: string | null;
    content?: string;
    metadata?: Record<string, unknown> | null;
  };
  const chatId = Number(body.chatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  if (!body.kind || !body.content) {
    return NextResponse.json(
      { error: "kind + content required" },
      { status: 400 },
    );
  }
  const note = await addChatNote({
    chatId,
    kind: body.kind,
    title: body.title ?? null,
    content: body.content,
    metadata: body.metadata ?? null,
    senderName: session.username ?? null,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "note.create",
    target: String(chatId),
    details: { kind: body.kind, noteId: note?.id },
  });
  return NextResponse.json({ ok: true, note });
}
