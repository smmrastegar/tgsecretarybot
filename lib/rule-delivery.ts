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

// OTP extraction is now AI-backed and lives in lib/rules.ts —
// extractOtpCodeAi. Callers must call it BEFORE buildRuleForwardText
// and pass the result through as `otpCode`. This file stays sync.

// Build the text of a rule-forwarded message according to the rule's
// formatting flags. Returns the text + a parse_mode hint so the caller
// uses HTML rendering when we've inlined a tap-to-copy code block.
// otpCode (when formatAsOtp is on) comes from extractOtpCodeAi —
// caller fetches it before invoking us.
export function buildRuleForwardText(args: {
  ruleName: string;
  senderName: string;
  body: string;
  showRulePrefix: boolean;
  formatAsOtp: boolean;
  otpCode?: string | null;
  /** Operator-written static header prepended to the forward. */
  forwardHeader?: string | null;
}): { text: string; parseMode?: "HTML" } {
  const header = (args.forwardHeader ?? "").trim();
  if (args.formatAsOtp) {
    // No extractable OTP = the matched message wasn't actually an
    // OTP carrier. Returning empty signals the caller to SKIP the
    // forward; the old behavior of "wrap raw body in 🔑 <code>"
    // produced \"🔑 کد بده\" replies that just confused the
    // recipient. Callers already check rule.formatAsOtp && !otpCode
    // and `continue` — this is a final safety net.
    if (!args.otpCode) {
      return { text: "" };
    }
    const lines: string[] = [];
    if (header) {
      lines.push(`<b>${escapeHtml(header)}</b>`);
      lines.push("");
    }
    if (args.showRulePrefix) {
      lines.push(
        `🏷 <b>${escapeHtml(args.ruleName)}</b> · از ${escapeHtml(args.senderName)}`,
      );
      lines.push("");
    }
    // Telegram renders <code>…</code> as monospace; tapping copies
    // the content. This is the canonical "OTP" UX.
    lines.push(`🔑 <code>${escapeHtml(args.otpCode)}</code>`);
    return { text: lines.join("\n"), parseMode: "HTML" };
  }
  // Default: plain text. Header and rule-prefix are both optional and
  // compose: header first, then the "[rule: …]" line, then the body.
  const parts: string[] = [];
  if (header) parts.push(header);
  if (args.showRulePrefix) {
    parts.push(`🏷 [rule: ${args.ruleName}] · از ${args.senderName}`);
  }
  parts.push(args.body);
  return { text: parts.join("\n\n") };
}
