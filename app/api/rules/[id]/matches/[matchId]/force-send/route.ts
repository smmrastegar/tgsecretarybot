import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  appendForwardErrors,
  audit,
  getMessageRule,
  hasDb,
  listRuleRecipients,
  markMatchForwardedTo,
  sql,
} from "@/lib/db";
import { getBot } from "@/lib/bot";
import { buildRuleForwardText, sendRuleForward } from "@/lib/rule-delivery";
import { extractOtpCodeAi } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/rules/[id]/matches/[matchId]/force-send
// Body: { recipients?: number[] }  (omit to send to every undelivered)
// Re-sends the rule's formatted (or raw) text to recipients that
// either haven't received it yet OR previously failed. Updates the
// match row's forwarded_to / forward_errors accordingly.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; matchId: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "no db" }, { status: 500 });
  }
  const { id, matchId } = await ctx.params;
  const ruleId = Number(id);
  const matchIdN = Number(matchId);
  if (!Number.isFinite(ruleId) || !Number.isFinite(matchIdN)) {
    return NextResponse.json({ error: "invalid ids" }, { status: 400 });
  }
  const rule = await getMessageRule(ruleId);
  if (!rule) {
    return NextResponse.json({ error: "rule not found" }, { status: 404 });
  }
  const matchRows = await sql()`
    SELECT m.id, m.formatted_text, m.forwarded_to, m.matched_at,
           l.message_text, l.sender_name
    FROM message_rule_matches m
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    WHERE m.id = ${matchIdN} AND m.rule_id = ${ruleId}
    LIMIT 1`;
  const m = matchRows[0] as
    | {
        id: string;
        formatted_text: string | null;
        forwarded_to: unknown[];
        matched_at: string | Date;
        message_text: string;
        sender_name: string;
      }
    | undefined;
  if (!m) {
    return NextResponse.json({ error: "match not found" }, { status: 404 });
  }
  // EXPIRY HARD-STOP: a gated match that's already past its window can
  // never auto-release; force-send must not become a backdoor that
  // ships a stale (often already-expired-at-source) code. Once the
  // window has passed, the match is dead — refuse to send it.
  const windowSec = rule.requestWindowSeconds ?? 0;
  if (windowSec > 0) {
    const ageSec = (Date.now() - new Date(m.matched_at).getTime()) / 1000;
    if (ageSec > windowSec) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "این match منقضی شده — پنجره‌ی زمانی گیت گذشته و دیگه (حتی با ارسال اجباری) فرستاده نمی‌شه. کدِ قدیمی معمولاً سمت سرویس هم منقضیه.",
        },
        { status: 409 },
      );
    }
  }
  const alreadyDelivered = new Set<number>(
    (m.forwarded_to ?? []).map((n) => Number(n)),
  );
  // Paused recipients are excluded even from a manual force-send.
  const allRecipients = (await listRuleRecipients(ruleId)).filter(
    (r) => !r.paused,
  );
  const body = (await request.json().catch(() => ({}))) as {
    recipients?: number[];
  };
  // Decide target set: explicit override OR (all recipients minus
  // already-delivered).
  const targets =
    Array.isArray(body.recipients) && body.recipients.length > 0
      ? body.recipients
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : allRecipients
          .map((r) => r.recipientChatId)
          .filter((c) => !alreadyDelivered.has(c));

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      delivered: 0,
      failed: 0,
      note: "هیچ گیرنده‌ای برای ارسال نیست — همه قبلاً گرفتن.",
    });
  }

  const body_text =
    m.formatted_text && m.formatted_text.trim().length > 0
      ? m.formatted_text
      : m.message_text ?? "";
  const otpCode = rule.formatAsOtp
    ? await extractOtpCodeAi(body_text).catch(() => null)
    : null;
  // OTP mode + no extractable code = the matched message wasn't an
  // actual OTP carrier (it was probably the recipient asking "کد
  // بده?"). Refuse with a clear message instead of silently sending
  // an empty Telegram message.
  if (rule.formatAsOtp && !otpCode) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "این match کدی نداره (یه درخواست بوده، نه پیام حامل OTP) — ارسال اجباری معنی نمی‌ده. این rule روی حالت OTP هست و فقط پیام‌هایی که عدد کد توشون استخراج می‌شه قابل ارسالن.",
      },
      { status: 400 },
    );
  }
  const built = buildRuleForwardText({
    ruleName: rule.name,
    senderName: m.sender_name ?? "?",
    body: body_text,
    showRulePrefix: rule.showRulePrefix,
    formatAsOtp: rule.formatAsOtp,
    otpCode,
  });
  const outText = built.text;
  if (!outText || !outText.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: "متن خروجی بعد از format خالی شد — چیزی برای ارسال نیست.",
      },
      { status: 400 },
    );
  }

  const bot = getBot();
  let delivered = 0;
  const failures: Record<string, string> = {};
  for (const chatId of targets) {
    const out = await sendRuleForward({
      bot,
      chatId,
      text: outText,
      parseMode: built.parseMode,
    });
    if (out.ok) {
      await markMatchForwardedTo({
        matchId: matchIdN,
        recipientChatId: chatId,
      });
      delivered++;
    } else {
      failures[String(chatId)] = out.error;
    }
  }
  if (Object.keys(failures).length > 0) {
    await appendForwardErrors({
      matchId: matchIdN,
      errors: failures,
    });
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.force_send",
    target: String(ruleId),
    details: {
      matchId: matchIdN,
      targets,
      delivered,
      failed: Object.keys(failures).length,
    },
  });
  return NextResponse.json({
    ok: true,
    delivered,
    failed: Object.keys(failures).length,
    failures,
  });
}
