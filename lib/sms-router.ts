// SMS routing: when an incoming business_message starts with "☎️
// +PHONE …" it's treated as an SMS forwarded by the operator's
// SMS-to-Telegram gateway. We try to identify the phone number's
// owner from existing chat history, then forward the body to every
// chat tagged with the sms_inbox function role, prepended with
// "☎️ +PHONE — Name" (or just "☎️ +PHONE" when the lookup fails).

import type { Bot } from "grammy";
import { findOwnerOfPhone, listChatsByFunction } from "./db";

// Matches: leading ☎️ (with or without variation selector), 📞, or ☎.
// Followed by optional whitespace, then a phone-looking run
// (+ / digits / spaces / dashes / parens), then optional body.
const SMS_PREFIX_RX =
  /^(?:☎️|☎|📞|📱)\s*([+\d][\d\s\-()]{4,20})\s*([\s\S]*)$/u;

export type SmsExtraction = {
  phone: string;
  body: string;
};

export function detectSmsForward(text: string): SmsExtraction | null {
  if (!text) return null;
  const m = text.trim().match(SMS_PREFIX_RX);
  if (!m) return null;
  const rawPhone = (m[1] ?? "").trim();
  const body = (m[2] ?? "").trim();
  if (!rawPhone) return null;
  // Normalise the phone to "+E164-ish" — strip non-digits but keep
  // the leading "+" if present.
  const hadPlus = rawPhone.startsWith("+");
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const phone = (hadPlus ? "+" : "") + digits;
  return { phone, body };
}

export async function routeSmsForward(args: {
  bot: Bot;
  sourceChatId: number;
  sourceMessageId: number;
  text: string;
}): Promise<{ delivered: number; skipped?: string } | null> {
  const sms = detectSmsForward(args.text);
  if (!sms) return null;

  const inboxes = await listChatsByFunction("sms_inbox");
  if (inboxes.length === 0) {
    return { delivered: 0, skipped: "no chat tagged with sms_inbox" };
  }
  // Loop guard: if the source IS one of the inboxes, don't re-forward.
  if (inboxes.some((c) => c.chatId === args.sourceChatId)) {
    return { delivered: 0, skipped: "source chat is the sms_inbox" };
  }

  const owner = await findOwnerOfPhone(sms.phone).catch(() => null);
  const header = owner?.name
    ? `☎️ ${sms.phone} — ${owner.name}`
    : `☎️ ${sms.phone}`;
  const outText = sms.body ? `${header}\n\n${sms.body}` : header;

  const { sendRuleForward } = await import("./rule-delivery");
  let delivered = 0;
  for (const inbox of inboxes) {
    const out = await sendRuleForward({
      bot: args.bot,
      chatId: inbox.chatId,
      text: outText,
    });
    if (out.ok) {
      delivered++;
      console.log(
        `[sms] forwarded phone=${sms.phone} owner="${owner?.name ?? "?"}" → inbox=${inbox.chatId} mode=${out.mode} msg_id=${out.sentMessageId}`,
      );
    } else {
      console.warn(
        `[sms] forward to inbox=${inbox.chatId} failed: ${out.error}`,
      );
    }
  }
  return { delivered };
}
