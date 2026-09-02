import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  getChatRule,
  listChatThreaded,
  upsertThreadSummary,
} from "@/lib/db";
import { summarizeGroup } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
  const body = (await request.json().catch(() => ({}))) as {
    threadNo?: number;
    gapMinutes?: number;
    force?: boolean;
  };
  const threadNo = Number(body.threadNo);
  if (!Number.isFinite(threadNo)) {
    return NextResponse.json({ error: "threadNo required" }, { status: 400 });
  }
  const gapMinutes = Math.min(
    Math.max(Number(body.gapMinutes ?? 5), 1),
    240,
  );

  const all = await listChatThreaded({
    chatId,
    gapMinutes,
    limit: 2000,
  });
  const threadMsgs = all
    .filter((m) => m.threadNo === threadNo)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (threadMsgs.length === 0) {
    return NextResponse.json({ error: "thread is empty" }, { status: 404 });
  }
  const threadStartedAt = threadMsgs[0]!.createdAt;
  const threadEndedAt = threadMsgs[threadMsgs.length - 1]!.createdAt;

  const settings = await getSettings();
  const rule = await getChatRule(chatId).catch(() => null);
  const aiSummary = await summarizeGroup({
    chatTitle: threadMsgs[0]?.chatTitle ?? null,
    ownerName: settings.ownerName,
    ownerContext: settings.ownerContext,
    chatNotes: rule?.notes ?? null,
    outputLanguage: "Persian (فارسی)",
    messages: threadMsgs.map((m) => ({
      sender: m.fromOwner
        ? settings.ownerDisplayName || settings.ownerName || "owner"
        : m.senderName,
      text: m.transcript
        ? `[voice] ${m.transcript}`
        : m.mediaDescription
          ? `[${m.mediaKind ?? "media"}] ${m.mediaDescription}`
          : m.mediaKind && !m.messageText
            ? `[${m.mediaKind}]`
            : m.messageText,
      at: m.createdAt,
    })),
  });

  const saved = await upsertThreadSummary({
    chatId,
    threadStartedAt,
    threadEndedAt,
    messageCount: threadMsgs.length,
    summary: aiSummary.summary,
    topics: aiSummary.topics,
    actionItems: aiSummary.actionItems,
  });
  return NextResponse.json({ ok: true, summary: aiSummary, persisted: saved });
}
