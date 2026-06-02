import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getChatRule, listChatThreaded } from "@/lib/db";
import { summarizeGroup } from "@/lib/classifier";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
  const body = (await request.json().catch(() => ({}))) as {
    threadNo?: number;
    gapMinutes?: number;
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

  const settings = await getSettings();
  const rule = await getChatRule(chatId).catch(() => null);
  const summary = await summarizeGroup({
    chatTitle: threadMsgs[0]?.chatTitle ?? null,
    ownerName: settings.ownerName,
    ownerContext: settings.ownerContext,
    chatNotes: rule?.notes ?? null,
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
  return NextResponse.json({ ok: true, summary });
}
