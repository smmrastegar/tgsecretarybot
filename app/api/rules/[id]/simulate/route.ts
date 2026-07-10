import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, getMessageRule, listRuleRecipients } from "@/lib/db";
import { getBot } from "@/lib/bot";
import {
  extractOtpCodeAi,
  formatMessageForRule,
  matchRules,
} from "@/lib/rules";
import { buildRuleForwardText, sendRuleForward } from "@/lib/rule-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/rules/[id]/simulate  body: { text: string; sender?: string }
// Runs the REAL matcher on a hand-typed message. If it matches, it
// ACTUALLY forwards to the active recipients (gate bypassed — this is an
// explicit operator-triggered execute, so they can see it land). Paused
// recipients are still skipped. Use to sanity-check a rule end-to-end.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const ruleId = Number(id);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    sender?: string;
  };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "متن ورودی لازمه" }, { status: 400 });
  }
  const rule = await getMessageRule(ruleId);
  if (!rule) {
    return NextResponse.json({ error: "rule not found" }, { status: 404 });
  }
  const senderName = (body.sender ?? "تست دستی").trim() || "تست دستی";

  // A source-feed rule matches by source alone in production; for a
  // manual test we take the operator's word that this text is from that
  // feed and treat it as matched (the OTP step still gates code-less
  // messages). Otherwise run the real content matcher.
  let isMatch: boolean;
  if (rule.matchAllFromSource && rule.sourceChatIds && rule.sourceChatIds.length) {
    isMatch = true;
  } else {
    const matched = await matchRules(
      { chatId: 0, chatTitle: "manual-test", senderName, messageText: text },
      [rule],
    );
    isMatch = matched.includes(ruleId);
  }
  if (!isMatch) {
    await audit({
      actorId: session.userId,
      actorName: session.username ?? null,
      action: "rule.simulate",
      target: String(ruleId),
      details: { matched: false },
    });
    return NextResponse.json({ ok: true, matched: false });
  }

  // Build the forward text exactly like the live path.
  const formatted = rule.formatAsOtp
    ? null
    : await formatMessageForRule(rule, {
        chatId: 0,
        chatTitle: "manual-test",
        senderName,
        messageText: text,
      });
  const fwdBody = formatted && formatted.trim() ? formatted : text;
  const otpCode = rule.formatAsOtp
    ? await extractOtpCodeAi(fwdBody).catch(() => null)
    : null;
  if (rule.formatAsOtp && !otpCode) {
    return NextResponse.json({
      ok: true,
      matched: true,
      delivered: [],
      note: "match شد ولی کدی برای استخراج نبود (rule روی حالت OTP هست).",
    });
  }
  const built = buildRuleForwardText({
    ruleName: rule.name,
    senderName,
    body: fwdBody,
    showRulePrefix: rule.showRulePrefix,
    formatAsOtp: rule.formatAsOtp,
    otpCode,
  });
  if (!built.text.trim()) {
    return NextResponse.json({
      ok: true,
      matched: true,
      delivered: [],
      note: "متن خروجی خالی شد — چیزی ارسال نشد.",
    });
  }

  const recipients = (await listRuleRecipients(ruleId)).filter((r) => !r.paused);
  const bot = getBot();
  const delivered: Array<{ chatId: number; label: string | null }> = [];
  const failures: Array<{ chatId: number; error: string }> = [];
  for (const r of recipients) {
    const out = await sendRuleForward({
      bot,
      chatId: r.recipientChatId,
      text: built.text,
      parseMode: built.parseMode,
    });
    if (out.ok) delivered.push({ chatId: r.recipientChatId, label: r.recipientLabel });
    else failures.push({ chatId: r.recipientChatId, error: out.error });
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.simulate",
    target: String(ruleId),
    details: { matched: true, delivered: delivered.length, failed: failures.length },
  });
  return NextResponse.json({
    ok: true,
    matched: true,
    outText: built.text,
    delivered,
    failures,
    pausedSkipped: (await listRuleRecipients(ruleId)).filter((r) => r.paused).length,
  });
}
