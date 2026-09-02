import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  listChatMessagesForAnalysis,
  listForumTopics,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/groups/[id]/messages?days=N
// Returns every message in this group, grouped by forum topic. Use this
// to verify what the analyzer is actually working from before trusting
// the «AI نتیجه‌ای استخراج نکرد» banner — the operator can scroll the
// raw input and see whether the messages contain real tasks or not.
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
  const daysRaw = url.searchParams.get("days") ?? "0";
  const allTime = daysRaw === "0" || daysRaw === "all";
  const days = allTime ? 0 : Math.min(Math.max(Number(daysRaw), 1), 90);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const since = allTime
    ? new Date(0)
    : new Date(Date.now() - days * 86400_000);
  const limit = allTime ? 5000 : 1500;

  const [{ chatTitle, messages }, topics] = await Promise.all([
    listChatMessagesForAnalysis({ chatId, since, limit }),
    listForumTopics(chatId, { includeArchived: true }).catch(() => []),
  ]);

  const archivedThreadIds = new Set(
    topics.filter((t) => t.archivedAt != null).map((t) => t.messageThreadId),
  );
  const topicNameByThread = new Map<number, string>();
  for (const t of topics) {
    topicNameByThread.set(
      t.messageThreadId,
      t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
    );
  }

  const topicNotesByThread = new Map<number, string>();
  for (const t of topics) {
    if (t.notes && t.notes.trim()) {
      topicNotesByThread.set(t.messageThreadId, t.notes.trim());
    }
  }

  // Bucket messages by topic (null thread = "General").
  type TopicBucket = {
    name: string;
    messageThreadId: number | null;
    archived: boolean;
    notes: string | null;
    messages: {
      sender: string;
      text: string;
      at: string;
      fromOwner: boolean;
    }[];
  };
  const buckets = new Map<string, TopicBucket>();
  const keyFor = (threadId: number | null): string =>
    threadId == null ? "general" : String(threadId);
  for (const m of messages) {
    const k = keyFor(m.messageThreadId);
    let bucket = buckets.get(k);
    if (!bucket) {
      const name =
        m.messageThreadId == null
          ? "General"
          : (topicNameByThread.get(m.messageThreadId) ??
            `Topic #${m.messageThreadId}`);
      const archived =
        m.messageThreadId != null && archivedThreadIds.has(m.messageThreadId);
      const notes =
        m.messageThreadId != null
          ? (topicNotesByThread.get(m.messageThreadId) ?? null)
          : null;
      bucket = {
        name,
        messageThreadId: m.messageThreadId,
        archived,
        notes,
        messages: [],
      };
      buckets.set(k, bucket);
    }
    bucket.messages.push({
      sender: m.sender,
      text: m.text,
      at: m.at.toISOString(),
      fromOwner: m.fromOwner,
    });
  }
  // Also include topics that have a record but zero messages in the
  // window, so the operator can spot empty topics.
  for (const t of topics) {
    const k = keyFor(t.messageThreadId);
    if (!buckets.has(k)) {
      buckets.set(k, {
        name:
          t.name && t.name.trim() ? t.name : `Topic #${t.messageThreadId}`,
        messageThreadId: t.messageThreadId,
        archived: t.archivedAt != null,
        notes: t.notes?.trim() || null,
        messages: [],
      });
    }
  }
  let bucketArr = [...buckets.values()];
  if (!includeArchived) {
    bucketArr = bucketArr.filter((b) => !b.archived);
  }
  bucketArr.sort((a, b) => {
    // Archived buckets sink to the bottom, otherwise by message count.
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    return b.messages.length - a.messages.length;
  });
  return NextResponse.json({
    ok: true,
    chatTitle,
    sinceIso: since.toISOString(),
    totalMessages: bucketArr.reduce((s, b) => s + b.messages.length, 0),
    archivedHidden: !includeArchived
      ? topics.filter((t) => t.archivedAt != null).length
      : 0,
    topics: bucketArr,
  });
}
