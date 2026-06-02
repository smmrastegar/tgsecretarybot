import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listChatThreaded } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
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
  const url = new URL(request.url);
  const gapMinutes = Math.min(
    Math.max(Number(url.searchParams.get("gap") ?? "5"), 1),
    240,
  );
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "500"), 1),
    2000,
  );

  const messages = await listChatThreaded({ chatId, gapMinutes, limit });

  // Group into threads, server-side, so the client just renders.
  const byThread = new Map<
    number,
    {
      threadNo: number;
      startedAt: string;
      endedAt: string;
      messageCount: number;
      senders: string[];
      messages: Array<{
        id: number;
        createdAt: string;
        senderName: string;
        messageText: string;
        transcript: string | null;
        mediaDescription: string | null;
        mediaKind: string | null;
        mediaFileId: string | null;
        importance: number;
        urgent: boolean;
        fromOwner: boolean;
      }>;
    }
  >();

  // listChatThreaded returns DESC; reverse to get chronological order per
  // thread, then sort threads newest-first at the end.
  for (const m of [...messages].reverse()) {
    let t = byThread.get(m.threadNo);
    if (!t) {
      t = {
        threadNo: m.threadNo,
        startedAt: m.createdAt.toISOString(),
        endedAt: m.createdAt.toISOString(),
        messageCount: 0,
        senders: [],
        messages: [],
      };
      byThread.set(m.threadNo, t);
    }
    t.endedAt = m.createdAt.toISOString();
    t.messageCount++;
    const sender = m.fromOwner ? "owner" : m.senderName;
    if (!t.senders.includes(sender)) t.senders.push(sender);
    t.messages.push({
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      senderName: m.senderName,
      messageText: m.messageText,
      transcript: m.transcript,
      mediaDescription: m.mediaDescription,
      mediaKind: m.mediaKind,
      mediaFileId: m.mediaFileId,
      importance: m.importance,
      urgent: m.urgent,
      fromOwner: m.fromOwner,
    });
  }

  const threads = Array.from(byThread.values()).sort((a, b) =>
    b.endedAt.localeCompare(a.endedAt),
  );

  return NextResponse.json({ threads, gapMinutes });
}
