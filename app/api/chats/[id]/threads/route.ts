import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listChatThreaded, listThreadSummaries } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
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
  // Optional "recent" window: clients can pass ?sinceHours=24 to only
  // get threads whose latest message landed in the last 24h. Default
  // is 0 = no time filter, return whatever fits in `limit`.
  const sinceHours = Math.max(
    Number(url.searchParams.get("sinceHours") ?? "0"),
    0,
  );
  const sinceCutoffMs =
    sinceHours > 0 ? Date.now() - sinceHours * 3600_000 : null;

  const messages = await listChatThreaded({ chatId, gapMinutes, limit });

  // Group into threads, server-side, so the client just renders.
  type Thread = {
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
    summary: {
      summary: string;
      topics: string[];
      actionItems: string[];
      createdAt: string;
      stale: boolean;
    } | null;
  };
  const byThread = new Map<number, Thread>();

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
        summary: null,
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

  let threads = Array.from(byThread.values()).sort((a, b) =>
    b.endedAt.localeCompare(a.endedAt),
  );

  if (sinceCutoffMs !== null) {
    threads = threads.filter(
      (t) => new Date(t.endedAt).getTime() >= sinceCutoffMs,
    );
  }

  // Attach persisted summaries (and mark stale if newer messages have
  // arrived since the summary was generated).
  if (threads.length > 0) {
    const starts = threads.map((t) => new Date(t.startedAt));
    const persisted = await listThreadSummaries(chatId, starts);
    const byStart = new Map<number, (typeof persisted)[number]>();
    for (const p of persisted) {
      byStart.set(p.threadStartedAt.getTime(), p);
    }
    for (const t of threads) {
      const p = byStart.get(new Date(t.startedAt).getTime());
      if (!p) continue;
      const lastMsgAt = new Date(t.endedAt).getTime();
      const summaryAt = p.createdAt.getTime();
      t.summary = {
        summary: p.summary,
        topics: p.topics,
        actionItems: p.actionItems,
        createdAt: p.createdAt.toISOString(),
        stale: lastMsgAt > summaryAt,
      };
    }
  }

  return NextResponse.json({ threads, gapMinutes });
}
