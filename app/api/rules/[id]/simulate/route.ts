import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  consumeRecipientRequest,
  getMessageRule,
  listRuleExamples,
  listRuleRecipients,
  logMessage,
  recipientRequestedRecently,
  recordRuleMatch,
} from "@/lib/db";
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
// Runs a hand-typed message through the SAME pipeline a real incoming
// message would take: match → (gate hold OR forward) → record. So if the
// rule is gated, the message is HELD (shows up under «فعال / منتظر» in
// the history) instead of being sent — exactly like production. Paused
// recipients are skipped.
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

  // Match exactly like production: source-feed rules match by source;
  // everything else by the content matcher.
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

  // Build the forward text like the live path.
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

  // Is the gate active? (window set AND a trigger OR gate examples.)
  const windowed =
    rule.requestWindowSeconds != null && rule.requestWindowSeconds > 0;
  let gated = false;
  if (windowed) {
    if (rule.requestTrigger?.trim()) gated = true;
    else {
      const gex = await listRuleExamples(ruleId, "gate_match").catch(() => []);
      gated = gex.length > 0;
    }
  }

  // Record a real match row so this shows in the history, then hold or
  // forward per the gate — just like a live message.
  const logId = await logMessage({
    businessConnectionId: null,
    ownerUserId: null,
    chatId: 0,
    chatType: "private",
    chatTitle: "🧪 تست دستی",
    senderId: null,
    senderUsername: null,
    senderName,
    messageId: Math.floor(Date.now() / 1000),
    messageText: text,
    importance: 0,
    urgent: false,
    concernsOwner: false,
    reason: "manual rule simulate",
    alerted: false,
    autoReplied: false,
    fromOwner: false,
    source: "rule_simulate",
  }).catch(() => 0);

  const recipients = (await listRuleRecipients(ruleId)).filter((r) => !r.paused);
  const bot = getBot();
  const delivered: Array<{ chatId: number; label: string | null }> = [];
  const held: Array<{ chatId: number; label: string | null }> = [];
  const failures: Record<string, string> = {};
  for (const r of recipients) {
    let shouldForward = !gated;
    if (gated) {
      shouldForward = await consumeRecipientRequest({
        ruleId,
        recipientChatId: r.recipientChatId,
        windowSeconds: rule.requestWindowSeconds ?? 0,
      }).catch(() => false);
    }
    if (!shouldForward) {
      held.push({ chatId: r.recipientChatId, label: r.recipientLabel });
      continue;
    }
    const out = await sendRuleForward({
      bot,
      chatId: r.recipientChatId,
      text: built.text,
      parseMode: built.parseMode,
    });
    if (out.ok) delivered.push({ chatId: r.recipientChatId, label: r.recipientLabel });
    else failures[String(r.recipientChatId)] = out.error;
  }
  if (logId) {
    await recordRuleMatch({
      ruleId,
      messageLogId: logId,
      formattedText: formatted,
      forwardedTo: delivered.map((d) => d.chatId),
      forwardErrors: failures,
    }).catch(() => {});
  }
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "rule.simulate",
    target: String(ruleId),
    details: {
      matched: true,
      gated,
      delivered: delivered.length,
      held: held.length,
      failed: Object.keys(failures).length,
    },
  });
  return NextResponse.json({
    ok: true,
    matched: true,
    gated,
    outText: built.text,
    delivered,
    held,
    failures: Object.entries(failures).map(([chatId, error]) => ({ chatId, error })),
  });
}
