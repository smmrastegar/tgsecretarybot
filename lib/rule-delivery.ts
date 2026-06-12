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
}): Promise<ForwardResult> {
  const bcId = await pickActiveBusinessConnectionId();
  if (bcId) {
    try {
      const sent = await args.bot.api.sendMessage(args.chatId, args.text, {
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
    const sent = await args.bot.api.sendMessage(args.chatId, args.text);
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
