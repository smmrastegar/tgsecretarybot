// SMS routing: when an incoming business_message starts with "☎️
// +PHONE …" it's treated as an SMS forwarded by the operator's
// SMS-to-Telegram gateway. Before forwarding we ask the LLM to gate
// it — operator only wants personal / transactional SMS in the
// inbox, NOT promotional / marketing / mass blasts. We try to
// identify the phone number's owner from existing chat history,
// then forward the body to every chat tagged with the sms_inbox
// function role, prepended with "☎️ +PHONE — Name" (or just
// "☎️ +PHONE" when the lookup fails).

import type { Bot } from "grammy";
import { findOwnerOfPhone, listChatsByFunction, recordAiUsage } from "./db";
import { config } from "./config";
import { getSettings } from "./settings";

const GATE_MODELS = [
  process.env.OPENROUTER_RULE_MODEL,
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash-001",
  "google/gemini-flash-1.5",
].filter(
  (m, i, arr): m is string =>
    typeof m === "string" && m.length > 0 && arr.indexOf(m) === i,
);
const GATE_TIMEOUT_MS = 15_000;
const GATE_COST_USD = 0.00005;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(`sms-gate timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

type GateDecision = {
  forward: boolean;
  reason: string;
  category: string;
};

// LLM gate: decide whether the SMS is personal/transactional AND
// addressed to the operator. Skip-on-failure (returns forward=true)
// because losing a real OTP because the model timed out is worse
// than letting one ad through.
async function classifySmsForForwarding(args: {
  phone: string;
  body: string;
}): Promise<GateDecision> {
  if (!args.body.trim()) {
    return {
      forward: true,
      reason: "empty body — let it through",
      category: "unknown",
    };
  }
  if (!config.openrouterApiKey) {
    return {
      forward: true,
      reason: "no openrouter key — skipping gate",
      category: "unknown",
    };
  }
  const settings = await getSettings();
  const ownerName = settings.ownerName || "the recipient";

  const systemPrompt = `You decide whether an incoming SMS should be forwarded to the operator's curated inbox or filtered out.

FORWARD (DECISION: YES) when the SMS is personal / transactional and addressed to the recipient (${ownerName}). Examples:
- One-time codes / OTP / verification / login PINs.
- Bank, payment, or delivery notifications.
- Appointment reminders, account warnings, balance alerts.
- A real person texting them.
- Service-account messages where they personally took an action.

FILTER (DECISION: NO) when the SMS is marketing / promotional / mass blast. Examples:
- "Black Friday 50% off …"
- "Vote for X" / political campaign.
- Generic discount codes meant for many recipients.
- Newsletter / promo / advertising pitch.
- Spam / scam.

Reply on EXACTLY two lines, no preamble, no markdown:

DECISION: YES
CATEGORY: <one short label like "otp" / "bank" / "appointment" / "promo" / "spam" / "person">

or

DECISION: NO
CATEGORY: <same labels>

Never explain, never wrap in code fences.`;
  const userPrompt = `From phone: ${args.phone}
Body:
${args.body.slice(0, 1500)}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;

  let raw = "";
  let usedModel = "";
  for (const model of GATE_MODELS) {
    try {
      const res = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 60,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        },
        GATE_TIMEOUT_MS,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (json.error) continue;
      const text = (json.choices?.[0]?.message?.content ?? "").trim();
      if (!text) continue;
      raw = text;
      usedModel = model;
      break;
    } catch (err) {
      console.warn(`[sms] gate ${model} failed:`, err);
    }
  }
  if (!raw) {
    return {
      forward: true,
      reason: "all gate models failed — fail-open to avoid dropping real SMS",
      category: "unknown",
    };
  }
  await recordAiUsage({
    chatId: null,
    businessConnectionId: null,
    model: usedModel,
    purpose: "sms_gate",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: GATE_COST_USD,
  }).catch(() => {});
  const decisionMatch = raw.match(/DECISION\s*:\s*(YES|NO)\b/i);
  const categoryMatch = raw.match(/CATEGORY\s*:\s*([^\n]+)/i);
  const decision = decisionMatch?.[1]?.toUpperCase() ?? "YES";
  const category = (categoryMatch?.[1] ?? "unknown").trim().slice(0, 40);
  return {
    forward: decision !== "NO",
    reason: `model=${usedModel} category=${category}`,
    category,
  };
}

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

  // LLM gate: only forward personal / transactional SMS. Promotional
  // / mass blasts are filtered out so the inbox stays clean.
  const decision = await classifySmsForForwarding({
    phone: sms.phone,
    body: sms.body,
  });
  if (!decision.forward) {
    console.log(
      `[sms] gate=NO phone=${sms.phone} category=${decision.category} — skipping forward (${decision.reason})`,
    );
    return {
      delivered: 0,
      skipped: `gate filtered (${decision.category})`,
    };
  }
  console.log(
    `[sms] gate=YES phone=${sms.phone} category=${decision.category} (${decision.reason})`,
  );

  const owner = await findOwnerOfPhone(sms.phone).catch(() => null);
  const headerPlain = owner?.name
    ? `☎️ ${sms.phone} — ${owner.name}`
    : `☎️ ${sms.phone}`;

  // Try to pull the OTP code out so we can inline it inside
  // <code>…</code> — Telegram renders that as tap-to-copy.
  let otp: string | null = null;
  if (sms.body) {
    try {
      const { extractOtpCodeAi } = await import("./rules");
      otp = await extractOtpCodeAi(sms.body);
    } catch {}
  }

  // HTML so we can attach the code block. Escape everything we
  // didn't construct ourselves.
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
    );
  const parts: string[] = [esc(headerPlain)];
  if (otp) parts.push("", `🔑 <code>${esc(otp)}</code>`);
  if (sms.body) parts.push("", esc(sms.body));
  const outText = parts.join("\n");

  const { sendRuleForward } = await import("./rule-delivery");
  let delivered = 0;
  for (const inbox of inboxes) {
    const out = await sendRuleForward({
      bot: args.bot,
      chatId: inbox.chatId,
      text: outText,
      parseMode: "HTML",
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
