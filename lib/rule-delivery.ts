// Delivery helper for rule-forwarded messages. The naive approach —
// bot.api.sendMessage(chatId, text) — only works if the recipient
// has /start'd the bot in a direct DM. For most rule recipients
// (the operator's existing Telegram contacts, like Moti), that's
// never happened — the bot reaches them only because it has a
// business_connection to the operator. We try business mode first
// so the forward lands inside the operator's existing business chat
// (appearing as if the operator sent it), and only fall back to a
// direct bot send when the recipient isn't reachable that way.

import type { Bot } from "grammy";
import { listBusinessConnections } from "./db";

export type ForwardResult =
  | {
      ok: true;
      mode: "business" | "direct";
      sentMessageId: number;
      businessConnectionId: string | null;
    }
  | { ok: false; error: string; lastAttempt: "business" | "direct" };

// Cached for 30s so a bursty match doesn't query business_connections
// once per recipient.
let bcCache: { id: string; expiresAt: number } | null = null;

async function pickActiveBusinessConnectionId(): Promise<string | null> {
  if (bcCache && bcCache.expiresAt > Date.now()) return bcCache.id;
  try {
    const rows = await listBusinessConnections();
    const usable = rows.find((r) => r.isEnabled && r.canReply);
    if (!usable) return null;
    bcCache = { id: usable.id, expiresAt: Date.now() + 30_000 };
    return usable.id;
  } catch (err) {
    console.warn("[rules] business connection lookup failed:", err);
    return null;
  }
}

export function invalidateBusinessConnectionCache(): void {
  bcCache = null;
}

export async function sendRuleForward(args: {
  bot: Bot;
  chatId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
}): Promise<ForwardResult> {
  const bcId = await pickActiveBusinessConnectionId();
  const opts = args.parseMode ? { parse_mode: args.parseMode } : undefined;
  if (bcId) {
    try {
      const sent = await args.bot.api.sendMessage(args.chatId, args.text, {
        ...(opts ?? {}),
        business_connection_id: bcId,
      });
      return {
        ok: true,
        mode: "business",
        sentMessageId: sent.message_id,
        businessConnectionId: bcId,
      };
    } catch (bErr) {
      const reason = bErr instanceof Error ? bErr.message : String(bErr);
      console.warn(
        `[rules] business-mode send to ${args.chatId} failed: ${reason} — falling back to direct`,
      );
    }
  }
  try {
    const sent = await args.bot.api.sendMessage(args.chatId, args.text, opts);
    return {
      ok: true,
      mode: "direct",
      sentMessageId: sent.message_id,
      businessConnectionId: null,
    };
  } catch (dErr) {
    const reason = dErr instanceof Error ? dErr.message : String(dErr);
    return { ok: false, error: reason, lastAttempt: "direct" };
  }
}

const HTML_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESC[c] ?? c);
}

// Pick the verification code out of an OTP-style message body. The
// naive /\b\d{4,8}\b/ kept grabbing the year "2026" from the SMS
// header date instead of the actual code "977487". We walk through a
// priority list of OTP shapes before falling back to any 6-8 digit
// run, with years explicitly skipped.
export function extractOtpCode(text: string): string | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    // "977487 is your Call.com verification code" / "… is the OTP"
    /(?<!\d)(\d{4,10})(?!\d)\s+is\s+(?:your|the)\b[\s\S]{0,80}?\b(?:code|otp|verification|verify|pin)\b/i,
    // "verification code 977487", "your OTP: 977487", "PIN = 977487"
    /\b(?:verification\s+code|verification|otp|verify|pin|code|کد|تایید|رمز(?:\s+ورود)?)\b[^\d\n]{0,40}(?<!\d)(\d{4,10})(?!\d)/i,
    // hash style "#977487" (often appended for auto-fill on iOS/Android)
    /#(\d{4,10})\b/,
    // 6-8 digit standalone run (most common SMS OTP length)
    /(?<!\d)(\d{6,8})(?!\d)/,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m?.[1]) return m[1];
  }
  // Last resort: 4-5 digit standalone runs, but reject years (1900-2099)
  // and zero-leading sequences that look like phone fragments.
  const fours = text.match(/(?<!\d)(\d{4,5})(?!\d)/g) ?? [];
  for (const cand of fours) {
    const n = Number(cand);
    if (n >= 1900 && n <= 2099) continue;
    return cand;
  }
  return null;
}

// Build the text of a rule-forwarded message according to the rule's
// formatting flags. Returns the text + a parse_mode hint so the caller
// uses HTML rendering when we've inlined a tap-to-copy code block.
export function buildRuleForwardText(args: {
  ruleName: string;
  senderName: string;
  body: string;
  showRulePrefix: boolean;
  formatAsOtp: boolean;
}): { text: string; parseMode?: "HTML" } {
  if (args.formatAsOtp) {
    // extractOtpCode prefers digits that follow OTP keywords ("code",
    // "verification", "#"…) so we don't accidentally tap-to-copy the
    // year out of the SMS header.
    const code = extractOtpCode(args.body);
    const lines: string[] = [];
    if (args.showRulePrefix) {
      lines.push(
        `🏷 <b>${escapeHtml(args.ruleName)}</b> · از ${escapeHtml(args.senderName)}`,
      );
      lines.push("");
    }
    if (code) {
      // Telegram renders <code>…</code> as monospace; tapping copies
      // the content. This is the canonical "OTP" UX.
      lines.push(`🔑 <code>${escapeHtml(code)}</code>`);
    } else {
      // No digits found — show the raw body in a <code> block so it
      // still copies on tap.
      lines.push(`🔑 <code>${escapeHtml(args.body.slice(0, 200))}</code>`);
    }
    return { text: lines.join("\n"), parseMode: "HTML" };
  }
  // Default: plain text. Prefix optional.
  if (args.showRulePrefix) {
    return {
      text: `🏷 [rule: ${args.ruleName}] · از ${args.senderName}\n\n${args.body}`,
    };
  }
  return { text: args.body };
}
