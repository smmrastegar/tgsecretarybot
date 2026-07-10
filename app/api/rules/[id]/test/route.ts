import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getMessageRule,
  listRecentMessagesForTest,
  listRuleExamples,
} from "@/lib/db";
import { batchTestRule, formatMessageForRule } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST {limit?: number} → runs the rule against the most recent N
// non-owner messages with text content. ONE batched LLM call classifies
// the whole list (was N calls, which both burned tokens and silently
// failed when the model returned blanks). The formatted-text preview
// only fires for the matches.
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
  const body = (await request.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100);
  const [messages, examples, negatives] = await Promise.all([
    listRecentMessagesForTest(limit),
    listRuleExamples(ruleId),
    listRuleExamples(ruleId, "negative_match"),
  ]);

  const flags = await batchTestRule({
    rule,
    examples,
    negatives,
    messages: messages.map((m) => ({
      id: m.id,
      text: m.messageText,
      sender: m.senderName,
    })),
  });

  // Only call the formatter for the rows that actually matched — and
  // only when the rule has a format prompt set. Sequential so a
  // misbehaving model can't fan out.
  const results: Array<{
    messageLogId: number;
    chatId: number;
    chatTitle: string | null;
    senderName: string;
    originalText: string;
    matched: boolean;
    formattedText: string | null;
    createdAt: string;
  }> = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const matched = flags[i] ?? false;
    let formatted: string | null = null;
    if (matched && rule.forwardFormat && rule.forwardFormat.trim()) {
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
  return NextResponse.json({
    ok: true,
    tested: results.length,
    matchedCount: results.filter((r) => r.matched).length,
    results,
  });
}
