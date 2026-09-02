import { NextResponse } from "next/server";
import { requireSession, requireSessionOr401 } from "@/lib/auth";
import {
  addChatNote,
  audit,
  chatNoteKindCounts,
  chatNoteSummaryByChat,
  listChatNotes,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/notes                 → per-chat summary + kind buckets
// GET /api/notes?view=flat       → flat list of notes with filters
// GET /api/notes?chatId=…&kind=… → filtered notes
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const chatIdRaw = url.searchParams.get("chatId");
  const kindRaw = url.searchParams.get("kind");
  const q = url.searchParams.get("q");
  const sinceDaysRaw = url.searchParams.get("days");
  const view = url.searchParams.get("view");
  const includeArchived =
    url.searchParams.get("archived") === "1" ||
    url.searchParams.get("archived") === "true";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "100"), 1),
    500,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  if (view === "flat" || chatIdRaw || kindRaw || q || sinceDaysRaw) {
    const chatId = chatIdRaw ? Number(chatIdRaw) : undefined;
    const sinceDays = sinceDaysRaw ? Number(sinceDaysRaw) : undefined;
    const [notes, kinds] = await Promise.all([
      listChatNotes({
        chatId: Number.isFinite(chatId) ? chatId : undefined,
        kind: kindRaw ?? undefined,
        q: q ?? undefined,
        sinceDays:
          Number.isFinite(sinceDays) && sinceDays! > 0 ? sinceDays : undefined,
        includeArchived,
        limit,
        offset,
      }),
      chatNoteKindCounts(),
    ]);
    return NextResponse.json({ ok: true, notes, kinds });
  }
  const [summary, kinds] = await Promise.all([
    chatNoteSummaryByChat(),
    chatNoteKindCounts(),
  ]);
  return NextResponse.json({ ok: true, summary, kinds });
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
