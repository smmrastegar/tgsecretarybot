import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { analyzeFollowUpNeed } from "@/lib/classifier";
import {
  recentConversation,
  setFollowUpAiVerdict,
  sql,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On-demand AI follow-up verdict for a single chat. Used by the
// /follow-up "🤖 الان تحلیل کن" button so the operator doesn't have
// to wait for the cron to reach this chat (cron processes only
// top-10 oldest candidates per 30-min tick).
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const { id: idStr } = await ctx.params;
  const chatId = Number(idStr);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // Pull contact name + last customer message timestamp for caching.
  const rows = await sql()`
    SELECT
      r.first_name, r.last_name, r.nickname, r.chat_title,
      (SELECT MAX(created_at) FROM messages_log m
        WHERE m.chat_id = ${chatId}
          AND m.from_owner = FALSE
          AND COALESCE(m.skipped_reason, '') <> 'muted'
      ) AS last_customer_at
    FROM chat_rules r
    WHERE r.chat_id = ${chatId} LIMIT 1`;
  const row = rows[0] as
    | {
        first_name: string | null;
        last_name: string | null;
        nickname: string | null;
        chat_title: string | null;
        last_customer_at: Date | null;
      }
    | undefined;
  if (!row?.last_customer_at) {
    return NextResponse.json(
      { ok: false, error: "no customer message logged for this chat" },
      { status: 400 },
    );
  }
  const contactName =
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    row.nickname ||
    row.chat_title ||
    null;
  const conversation = await recentConversation(chatId, 30);
  const verdict = await analyzeFollowUpNeed({
    chatId,
    contactName,
    messages: conversation.map((m) => ({
      fromOwner: m.from === "owner",
      senderName: m.senderName,
      text: m.text,
      at: m.at,
    })),
  });
  if (!verdict) {
    return NextResponse.json(
      { ok: false, error: "AI judge failed" },
      { status: 500 },
    );
  }
  await setFollowUpAiVerdict({
    chatId,
    forMessageAt: row.last_customer_at,
    needsReply: verdict.needsReply,
    reason: verdict.reason,
    urgency: verdict.urgency,
  });
  return NextResponse.json({ ok: true, verdict });
}
