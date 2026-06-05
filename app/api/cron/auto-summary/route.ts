import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { deliverAutoSummary } from "@/lib/bot";
import { getBot } from "@/lib/bot";
import { hasDb, sql } from "@/lib/db";
import type { ChatRule } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}

async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json(
      { error: "DATABASE_URL not set" },
      { status: 500 },
    );
  }
  // Find every chat that wants auto-summary, has had at least one
  // message after the last delivered summary, and where the latest
  // message is older than the configured gap (i.e. the conversation
  // has actually paused). For each, summarise that paused thread.
  //
  // Smart-timing mode (default): the *initiator* of the pending burst
  // (sender of the first message after the previous summary) must also
  // be the sender of the last message — i.e. they fired off their final
  // line and the gap is now measured from THAT line. This handles the
  // "I asked something, they answered, I added one more line and went
  // silent" case where the asker is the owner.
  //
  // Legacy mode: just require that the other person sent the last
  // message (the original behaviour).
  const rows = (await sql()`
    WITH last_msg AS (
      SELECT DISTINCT ON (chat_id)
        chat_id, created_at AS at, from_owner, sender_id
      FROM messages_log
      ORDER BY chat_id, created_at DESC
    ),
    initiator AS (
      SELECT DISTINCT ON (m.chat_id)
        m.chat_id, m.sender_id, m.from_owner
      FROM messages_log m
      JOIN chat_rules r ON r.chat_id = m.chat_id
      WHERE r.last_auto_summary_at IS NULL
         OR m.created_at > r.last_auto_summary_at
      ORDER BY m.chat_id, m.created_at ASC
    )
    SELECT r.chat_id, lm.at AS last_msg_at
    FROM chat_rules r
    JOIN last_msg lm ON lm.chat_id = r.chat_id
    LEFT JOIN initiator i ON i.chat_id = r.chat_id
    WHERE r.mode = 'ai_listen'
      AND r.auto_summarize_enabled = TRUE
      AND (
        (r.auto_summarize_smart_timing = TRUE
          AND i.chat_id IS NOT NULL
          AND (
            (lm.sender_id IS NOT NULL AND lm.sender_id = i.sender_id)
            OR (lm.sender_id IS NULL AND lm.from_owner = i.from_owner)
          ))
        OR
        (r.auto_summarize_smart_timing = FALSE AND lm.from_owner = FALSE)
      )
      AND (
        r.last_auto_summary_at IS NULL
        OR lm.at > r.last_auto_summary_at
      )
      AND NOW() - lm.at > (r.auto_summarize_gap_minutes || ' minutes')::INTERVAL`) as Array<{
    chat_id: string;
    last_msg_at: Date;
  }>;
  let delivered = 0;
  const bot = getBot();
  for (const r of rows) {
    const chatId = Number(r.chat_id);
    const { getChatRule } = await import("@/lib/db");
    const rule = (await getChatRule(chatId).catch(() => null)) as ChatRule | null;
    if (!rule) continue;
    try {
      const ok = await deliverAutoSummary({
        bot,
        rule,
        throughTs: r.last_msg_at,
      });
      if (ok) delivered++;
    } catch (err) {
      console.error(
        `[cron auto_summary] chat=${chatId} failed:`,
        err,
      );
    }
  }
  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    delivered,
  });
}
