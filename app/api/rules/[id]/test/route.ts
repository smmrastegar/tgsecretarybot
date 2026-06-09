import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getMessageRule,
  listRecentMessagesForTest,
} from "@/lib/db";
import { formatMessageForRule, matchRules } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST {limit?: number} → runs the rule against the most recent N
// messages (non-owner, with text) and returns which ones matched + the
// reformatted text the rule would have produced. We cap the LLM calls
// at one per candidate message to keep test runs fast and cheap.
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
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const rule = await getMessageRule(ruleId);
  if (!rule) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
  };
  const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100);
  const messages = await listRecentMessagesForTest(limit);

  type ResultRow = {
    messageLogId: number;
    chatId: number;
    chatTitle: string | null;
    senderName: string;
    originalText: string;
    matched: boolean;
    formattedText: string | null;
    createdAt: string;
  };
  const results: ResultRow[] = [];

  // Iterate sequentially so the JSON return order matches the input
  // order. matchRules makes one LLM call per message — fine at limit=30.
  for (const m of messages) {
    const ids = await matchRules(
      {
        chatId: m.chatId,
        chatTitle: m.chatTitle,
        senderName: m.senderName,
        messageText: m.messageText,
      },
      [rule],
    );
    const matched = ids.includes(ruleId);
    let formatted: string | null = null;
    if (matched && rule.forwardFormat) {
      formatted = await formatMessageForRule(rule, {
        chatId: m.chatId,
        chatTitle: m.chatTitle,
        senderName: m.senderName,
        messageText: m.messageText,
      });
    }
    results.push({
      messageLogId: m.id,
      chatId: m.chatId,
      chatTitle: m.chatTitle,
      senderName: m.senderName,
      originalText: m.messageText,
      matched,
      formattedText: formatted,
      createdAt: m.createdAt.toISOString(),
    });
  }
  const matchedCount = results.filter((r) => r.matched).length;
  return NextResponse.json({
    ok: true,
    tested: results.length,
    matchedCount,
    results,
  });
}
