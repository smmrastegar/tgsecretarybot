// SMS routing: when an incoming business_message starts with "☎️
// +PHONE …" it's treated as an SMS forwarded by the operator's
// SMS-to-Telegram gateway. Before forwarding we ask the LLM to gate
// it — operator only wants personal / transactional SMS in the
// inbox, NOT promotional / marketing / mass blasts. We try to
// identify the phone number's owner from existing chat history,
// then forward the body to every chat tagged with the sms_inbox
// function role, prepended with "☎️ +PHONE — Name" (or just
// "☎️ +PHONE" when the lookup fails).

import { InlineKeyboard, type Bot } from "grammy";
import {
  findOwnerOfPhone,
  findSmsDedup,
  getMaxSmsMessageIdInInbox,
  isSmsAcceptedSignature,
  listChatsByFunction,
  listSmsBlockRules,
  recordAiUsage,
  resetSmsDedupCounter,
  smsBodySignature,
  setSmsDedupMessageId,
  touchSmsAcceptSignature,
  touchSmsBlockRule,
  upsertSmsDedup,
} from "./db";
import { config } from "./config";
import { getSettings } from "./settings";

import { reportWarn } from "./report";
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

// Ask the LLM: "does this new SMS match ANY of the operator's
// blocked examples?". Returns the id of the matching rule (so we can
// bump hit_count and the operator can see which rule fired) or null
// when nothing matched. Fail-open: any error returns null so the
// gate flow still decides.
async function checkBlockedByOperator(args: {
  body: string;
}): Promise<{ ruleId: number; reason: string } | null> {
  if (!config.openrouterApiKey) return null;
  const rules = await listSmsBlockRules({ enabledOnly: true }).catch(() => []);
  if (rules.length === 0) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;
  const systemPrompt = `You are a junk-mail filter. The operator has saved a list of
EXAMPLE SMS bodies they want blocked — "don't bring me this kind again". Each
example is one full message. A new SMS just arrived; tell me if it's the SAME
KIND as ANY of the blocked examples.

"Same kind" means: same sender role + same purpose + similar phrasing pattern
(e.g. two real-estate listings from different agencies are the same kind; two
beauty-salon discount ads are the same kind; an OTP and a real-estate ad are
NOT the same kind even if they share words).

Reply on EXACTLY one line, no preamble:

MATCH: <id of the example it matches>

or, when nothing matches:

MATCH: none

Never explain.`;
  const rulesBlock = rules
    .slice(0, 30)
    .map((r) => `- id=${r.id}: ${r.exampleBody.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  const userPrompt = `BLOCKED EXAMPLES:\n${rulesBlock}\n\nNEW SMS:\n${args.body.slice(0, 1500)}`;
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
            max_tokens: 30,
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
      await recordAiUsage({
        chatId: null,
        businessConnectionId: null,
        model,
        purpose: "sms_block_check",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: GATE_COST_USD,
      }).catch(() => {});
      const m = text.match(/MATCH\s*:\s*(\d+|none)/i);
      const tok = m?.[1]?.toLowerCase();
      if (!tok || tok === "none") return null;
      const ruleId = Number(tok);
      if (!Number.isFinite(ruleId)) return null;
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return null;
      return {
        ruleId,
        reason: `matches operator block rule #${ruleId} (${rule.label ?? rule.exampleBody.slice(0, 40)})`,
      };
    } catch (err) {
      reportWarn("sms-router", `[sms] block-check ${model} failed:`, err);
    }
  }
  return null;
}

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

The operator's preference is LOOSE — they want most SMS through. ONLY the specific clearly-promotional categories below should be filtered. EVERYTHING ELSE is forwarded, including news, event announcements, concerts, theater, charity, religious notices, government notices, election notices, weather alerts, and even mildly-promotional "discount available" messages from services the operator may genuinely use.

ALWAYS FORWARD (DECISION: YES). Examples:
- ONE-TIME CODES — OTP / verification / login PINs / access codes / security codes / 2FA codes. ANY isolated 4-8 digit number presented as a code (English OR Persian digits ۰-۹) is an OTP, even when the SMS frames it as a "warning" / "alert" / "هشدار" — that's just decoration to draw attention.
- Bank, payment, transaction, or delivery notifications.
- Appointment reminders, account warnings, balance alerts.
- Government, court, tax, customs, ثبت احوال, پنجره ملی, ثنا notices.
- Event / concert / theater / cinema / festival / exhibition / conference announcements.
- News, weather alerts, traffic, power outage notices, water cut notices.
- Charity / religious / educational announcements.
- A real person texting them.
- Service-account messages where they personally took an action.
- Tickets / boarding passes / parking violations.
- Anything carrying a useful link or address.
- SERVICE / SITE MONITORING / UPTIME / ERROR / DOWNTIME / OUTAGE alerts — anything saying a website, server, API, or service is down, slow, broken, or has thrown an error. Includes monitoring services (Limoome, Uptime Robot, Pingdom, StatusCake, ...), DevOps alerts, log-watcher pings, and anything mentioning "با خطا مواجه شده", "down", "offline", "unreachable", "5xx", "error". The recipient set up this monitoring themselves — it's personal infra, not promo.

CRITICAL — Iranian SMS legal note:
ALL bulk-SMS senders in Iran are LEGALLY REQUIRED to append "لغو11" /
"لغو10" / "لغو<digits>" / "Unsubscribe" to every commercial message.
That tail by itself is NOT proof of promo content. Banks, government,
hospitals, monitoring services, and legitimate transactional senders
also include it. JUDGE THE BODY, NOT THE TAIL. A monitoring alert
ending in "لغو11" is still a monitoring alert, not a discount blast.

FILTER (DECISION: NO) — only these clearly-annoying categories:
- Real-estate listings / apartment-for-rent / apartment-for-sale ads ("املاک", "اجاره", "فروش آپارتمان", "خرید ملک", ...).
- Beauty / cosmetics / spa / makeup / skin-care ads ("لوازم آرایشی", "بهداشتی", "آرایش", "مژه", "ناخن", "میکاپ", ...).
- Discount / sale / coupon mass-blasts with no recipient action ("X% off", "حراج", "تخفیف", "Black Friday", "جمعه سیاه", ...).
- Newsletter / promo / advertising pitch with no recipient action.
- Political campaign solicitations / vote-for-X.
- Pure spam / phishing / obvious scam.

If in doubt FORWARD. False alarms are cheap; missing real content is expensive.

Reply on EXACTLY two lines, no preamble, no markdown:

DECISION: YES
CATEGORY: <one short label like "otp" / "bank" / "appointment" / "promo" / "spam" / "person" / "gov" / "delivery" / "event" / "news" / "real_estate" / "beauty" / "discount">

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
      reportWarn("sms-router", `[sms] gate ${model} failed:`, err);
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

// Try these patterns in order. The first to match wins.
//
//   1. ☎️ <phone> <body>          — classic numeric sender ("☎️ +989… …")
//   2. ☎️ <name>: <body>          — colon-separated alphanumeric sender
//                                   ("☎️ ParsianBank: ...", "📱 BANK …")
//   3. ☎️ <header line>\n<body>   — alphanumeric sender on its own line
//                                   followed by the body on next line(s)
//
// We also accept the operator's webhook-pasted SMS in the format the
// Android SMS-Forwarder sends after URL-decoding. When NONE of these
// match, routeSmsForward falls back to treating the whole text as
// body — see that function.
const SMS_PHONE_RX =
  /^(?:☎️|☎|📞|📱)\s*([+\d][\d\s\-()]{4,20})\s+([\s\S]+)$/u;
const SMS_NAMED_RX =
  /^(?:☎️|☎|📞|📱)\s*([^\n]+?)\s*[:：]\s*([\s\S]+)$/u;
const SMS_LINE_RX =
  /^(?:☎️|☎|📞|📱)\s*([^\n]+)\n+([\s\S]+)$/u;

// Normalize for pattern matching: lowercase, unify Arabic/Persian
// letter variants (ي→ی, ك→ک), collapse whitespace. So a pattern like
// "مانیتورینگ" matches the SMS sender "سرويس مانيتورينگ ليمومي" even
// though the SMS uses the Arabic ي/ك glyphs.
function normSilent(s: string): string {
  return s
    .toLowerCase()
    .replace(/[يﻱﻲ]/g, "ی")
    .replace(/[كﻙﻚ]/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}

// Should this SMS be posted silently? True when the sender name OR the
// body contains any of the operator's configured silent patterns.
export function isSilentSms(args: {
  sender: string;
  body: string;
  patternsRaw: string;
}): boolean {
  const patterns = args.patternsRaw
    .split(/[\n,]+/)
    .map((p) => normSilent(p))
    .filter((p) => p.length > 0);
  if (patterns.length === 0) return false;
  const hay = normSilent(`${args.sender}\n${args.body}`);
  return patterns.some((p) => hay.includes(p));
}

export type SmsExtraction = {
  phone: string;
  body: string;
  // True when `phone` is actually an alphanumeric sender ID
  // (ParsianBank / Snapp / MTN …) rather than a real phone number.
  // Owner lookup is skipped for these since the phone_contacts table
  // is keyed by digits.
  isAlphanumeric: boolean;
};

export function detectSmsForward(text: string): SmsExtraction | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Numeric phone.
  let m = trimmed.match(SMS_PHONE_RX);
  if (m) {
    const rawPhone = (m[1] ?? "").trim();
    const body = (m[2] ?? "").trim();
    if (rawPhone) {
      const hadPlus = rawPhone.startsWith("+");
      const digits = rawPhone.replace(/\D/g, "");
      if (digits.length >= 6) {
        return {
          phone: (hadPlus ? "+" : "") + digits,
          body,
          isAlphanumeric: false,
        };
      }
    }
  }

  // 2. Alphanumeric sender + colon + body. The named header MUST
  // contain at least one letter so we don't mistakenly route plain
  // numbers through this branch.
  m = trimmed.match(SMS_NAMED_RX);
  if (m) {
    const sender = (m[1] ?? "").trim();
    const body = (m[2] ?? "").trim();
    if (sender && body && /\p{L}/u.test(sender)) {
      return {
        phone: sender.slice(0, 60),
        body,
        isAlphanumeric: true,
      };
    }
  }

  // 3. Alphanumeric header on its own line.
  m = trimmed.match(SMS_LINE_RX);
  if (m) {
    const sender = (m[1] ?? "").trim();
    const body = (m[2] ?? "").trim();
    if (sender && body && /\p{L}/u.test(sender)) {
      return {
        phone: sender.slice(0, 60),
        body,
        isAlphanumeric: true,
      };
    }
  }

  return null;
}

export async function routeSmsForward(args: {
  bot: Bot;
  sourceChatId: number;
  sourceMessageId: number;
  text: string;
  // Optional fallback identity used in the forward header when the
  // phone-owner lookup returns nothing. The SMS webhook endpoint
  // passes the webhook's own name here so a "📱 پیامک مرضیه" tag
  // shows up instead of just "☎️ +PHONE" (or a wrong contact
  // matched against the SMS-aggregator's own messages_log rows).
  sourceLabel?: string | null;
  // When true (set ONLY by the SMS webhook route), allow routing
  // even when the body lacks a ☎️/📱 prefix — the message arrived
  // through an explicit SMS channel so it IS an SMS regardless of
  // header shape. NEVER set this from bot.ts; we'd accidentally
  // forward every DM message into the sms_inbox.
  allowNoHeader?: boolean;
  // When set, the body is replaced with a "🔒 پیام خصوصی" placeholder
  // and a "👁 نمایش متن" button is added. The body comes from
  // messages_log when the operator reveals.
  privateConversation?: { logId: number; reason: string } | null;
}): Promise<{ delivered: number; skipped?: string } | null> {
  // Try to parse a phone-or-name header. When that fails and the
  // caller didn't opt into the no-header fallback (i.e. we're being
  // invoked from a regular DM hot path), bail out — these messages
  // are NOT SMS and must not land in the sms_inbox.
  const parsed = detectSmsForward(args.text);
  if (!parsed && !args.allowNoHeader) return null;
  const sms: SmsExtraction =
    parsed ?? {
      phone: args.sourceLabel?.trim() || "SMS",
      body: args.text.trim(),
      isAlphanumeric: true,
    };
  if (!sms.body) return null;

  const inboxes = await listChatsByFunction("sms_inbox");
  if (inboxes.length === 0) {
    return { delivered: 0, skipped: "no chat tagged with sms_inbox" };
  }
  // Loop guard: if the source IS one of the inboxes, don't re-forward.
  if (inboxes.some((c) => c.chatId === args.sourceChatId)) {
    return { delivered: 0, skipped: "source chat is the sms_inbox" };
  }

  // OTP pre-check: pull the verification code out FIRST so we have it
  // for tap-to-copy AND so we can short-circuit the gate. An SMS that
  // carries a clear OTP is ALWAYS personal/transactional — the user
  // needs to see it — and we don't want phrasing like "هشدار کد
  // دسترسی" tricking the gate into classifying it as a security
  // alert instead of a code.
  let otp: string | null = null;
  if (sms.body) {
    try {
      const { extractOtpCodeAi } = await import("./rules");
      otp = await extractOtpCodeAi(sms.body);
    } catch (err) {
      reportWarn("sms-router", "[sms] otp pre-extract failed:", err);
    }
  }

  // Block-list pre-check: when an OTP isn't already detected,
  // consult the operator's curated "don't bring me this kind again"
  // rules. A match drops the SMS entirely — silently, since the
  // operator already decided once that they don't want it.
  if (!otp && sms.body) {
    const blocked = await checkBlockedByOperator({ body: sms.body }).catch(
      () => null,
    );
    if (blocked) {
      await touchSmsBlockRule(blocked.ruleId).catch(() => {});
      console.log(
        `[sms] blocked phone=${sms.phone} rule=${blocked.ruleId} (${blocked.reason})`,
      );
      return {
        delivered: 0,
        skipped: `blocked by operator (rule ${blocked.ruleId})`,
      };
    }
  }

  // LLM gate: only forward personal / transactional SMS. Promotional
  // / mass blasts are filtered out so the inbox stays clean. Bypassed
  // when the pre-check found an OTP — see above.
  let decision: GateDecision;
  if (otp) {
    decision = {
      forward: true,
      reason: `OTP detected (${otp}) — bypassing gate`,
      category: "otp",
    };
    console.log(
      `[sms] gate bypassed phone=${sms.phone} otp=${otp} — auto-forward`,
    );
  } else {
    decision = await classifySmsForForwarding({
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
  }

  // Owner lookup only makes sense for numeric phones. Alphanumeric
  // sender IDs like "ParsianBank" / "Snapp" / "MTN" aren't in the
  // phone_contacts table.
  const owner = sms.isAlphanumeric
    ? null
    : await findOwnerOfPhone(sms.phone).catch(() => null);
  const fallbackLabel = args.sourceLabel?.trim() || null;
  // Header rendering depends on what we have:
  //   - alphanumeric sender: "📨 ParsianBank — <webhook label?>"
  //   - numeric phone with owner: "☎️ +989… — Moti"
  //   - numeric phone, no owner: "☎️ +989…" (+ webhook label fallback)
  const headerPlain = sms.isAlphanumeric
    ? fallbackLabel && fallbackLabel.toLowerCase() !== sms.phone.toLowerCase()
      ? `📨 ${sms.phone} — ${fallbackLabel}`
      : `📨 ${sms.phone}`
    : owner?.name
      ? `☎️ ${sms.phone} — ${owner.name}`
      : fallbackLabel
        ? `☎️ ${sms.phone} — ${fallbackLabel}`
        : `☎️ ${sms.phone}`;

  // OTP was already extracted by the pre-check above; the variable
  // `otp` is in scope here. The dashboard's saveOtpCode call still
  // happens in the webhook route handler.

  // HTML so we can attach the code block. Escape everything we
  // didn't construct ourselves.
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
    );
  const isPrivate = !!args.privateConversation;
  const parts: string[] = [esc(headerPlain)];
  if (otp) parts.push("", `🔑 <code>${esc(otp)}</code>`);
  if (isPrivate) {
    parts.push("", `🔒 <i>پیام خصوصی — تا «👁 نمایش متن» رو نزدی، متن نشون داده نمی‌شه.</i>`);
  } else if (sms.body) {
    parts.push("", esc(sms.body));
  }
  const outText = parts.join("\n");

  // Silent-publish check: monitoring / uptime alerts and any other
  // sender the operator flagged should land in the inbox WITHOUT a
  // notification ping. Matched against sender name AND body.
  let silent = false;
  let silentCopyChatId = 0;
  let silentCopyThreadId: number | undefined;
  try {
    const settings = await getSettings();
    silent = isSilentSms({
      sender: sms.phone,
      body: sms.body,
      patternsRaw: settings.smsSilentSenderPatterns ?? "",
    });
    const rawCopyChat = Number(settings.smsSilentCopyChatId ?? "");
    if (Number.isFinite(rawCopyChat) && rawCopyChat !== 0) {
      silentCopyChatId = rawCopyChat;
      const rawThread = Number(settings.smsSilentCopyThreadId ?? "");
      if (Number.isFinite(rawThread) && rawThread > 0) {
        silentCopyThreadId = rawThread;
      }
    }
  } catch (err) {
    reportWarn("sms-router", "[sms] silent-pattern check failed:", err);
  }
  if (silent) {
    console.log(`[sms] silent publish sender="${sms.phone}"`);
  }

  // Dedup signature for "same SMS arrived again" → edit-in-place
  // instead of posting a new copy.
  const signature = otp
    ? `otp:${otp}` // OTP body changes a lot but the code is the dedup key
    : smsBodySignature(sms.body || sms.phone);

  // Was this kind of SMS already explicitly accepted by the
  // operator? If yes, deliver clean — no inline buttons, no
  // dedup ping. They told us they're fine with this pattern;
  // they don't want to be asked again.
  const accepted = await isSmsAcceptedSignature(signature).catch(() => false);
  if (accepted) {
    await touchSmsAcceptSignature(signature).catch(() => {});
  }

  let delivered = 0;
  for (const inbox of inboxes) {
    const existing = await findSmsDedup(inbox.chatId, signature, 48).catch(
      () => null,
    );
    // Only edit-in-place if the existing dedup target is STILL the
    // bottom of the chat. If any other SMS has landed between, the
    // operator wouldn't see the silent edit — treat as a fresh
    // occurrence and send a new message.
    const maxInInbox = await getMaxSmsMessageIdInInbox(inbox.chatId).catch(
      () => null,
    );
    const isStillLast =
      existing != null &&
      existing.telegramMessageId != null &&
      maxInInbox != null &&
      existing.telegramMessageId === maxInInbox;

    if (isStillLast && existing && existing.telegramMessageId) {
      // Same SMS again AND it's still the last message in the chat —
      // edit the original to bump the count + the hh:mm clock of the
      // latest arrival.
      const repeats = existing.repeatCount + 1;
      const augmented =
        outText +
        `\n\n🔁 <i>دفعه ${repeats} — آخرین: ${formatTehranTime(new Date())}</i>`;
      try {
        await args.bot.api.editMessageText(
          inbox.chatId,
          existing.telegramMessageId,
          augmented.slice(0, 4096),
          {
            parse_mode: "HTML",
            reply_markup: accepted
              ? undefined
              : buildSmsActionKeyboard(
                  existing.id,
                  args.privateConversation?.logId ?? null,
                ),
          },
        );
        // (edit doesn't re-notify; disable_notification only affects
        // fresh sends — handled below.)
        await upsertSmsDedup({
          inboxChatId: inbox.chatId,
          bodySignature: signature,
          bodyPreview: sms.body.slice(0, 200),
          telegramMessageId: existing.telegramMessageId,
        });
        delivered++;
        console.log(
          `[sms] dedup edit inbox=${inbox.chatId} msg=${existing.telegramMessageId} repeats=${repeats} accepted=${accepted}`,
        );
        continue;
      } catch (err) {
        // editMessageText fails when the original message was
        // deleted by the operator — fall through to fresh send.
        reportWarn("sms-router", 
          `[sms] dedup edit failed inbox=${inbox.chatId}, falling back to fresh send:`,
          err,
        );
      }
    } else if (existing) {
      console.log(
        `[sms] dedup row exists but not last in chat ` +
          `(existing msg=${existing.telegramMessageId}, max=${maxInInbox}) ` +
          `— sending fresh, resetting counter`,
      );
    }

    // Fresh send. If a dedup row already exists (re-occurrence after
    // other SMS), upsert keeps the same id but increments counter; we
    // reset the counter to 1 below so the next "🔁 دفعه N" starts
    // from THIS fresh send, not from history.
    const dedup = await upsertSmsDedup({
      inboxChatId: inbox.chatId,
      bodySignature: signature,
      bodyPreview: sms.body.slice(0, 200),
      telegramMessageId: null,
    });
    try {
      const sent = await args.bot.api.sendMessage(inbox.chatId, outText, {
        parse_mode: "HTML",
        disable_notification: silent,
        reply_markup: accepted
          ? undefined
          : buildSmsActionKeyboard(
              dedup.id,
              args.privateConversation?.logId ?? null,
            ),
      });
      if (existing) {
        await resetSmsDedupCounter({
          dedupId: dedup.id,
          telegramMessageId: sent.message_id,
          bodyPreview: sms.body.slice(0, 200),
        });
      } else {
        await setSmsDedupMessageId(dedup.id, sent.message_id);
      }
      delivered++;
      console.log(
        `[sms] forwarded phone=${sms.phone} owner="${owner?.name ?? "?"}" → inbox=${inbox.chatId} msg=${sent.message_id} dedup=${dedup.id} accepted=${accepted}`,
      );
    } catch (err) {
      reportWarn("sms-router", 
        `[sms] forward to inbox=${inbox.chatId} failed:`,
        err,
      );
    }
  }

  // Silent copy: when the SMS is silent AND a copy destination is
  // configured (a group + optional forum topic), drop a running-log
  // copy there too — always silently, no action buttons. Each
  // occurrence is a fresh message so the topic keeps a full history
  // (unlike the inbox, which dedup-edits repeats into one line).
  if (silent && silentCopyChatId !== 0) {
    try {
      await args.bot.api.sendMessage(silentCopyChatId, outText, {
        parse_mode: "HTML",
        disable_notification: true,
        ...(silentCopyThreadId
          ? { message_thread_id: silentCopyThreadId }
          : {}),
      });
      console.log(
        `[sms] silent copy → chat=${silentCopyChatId} thread=${silentCopyThreadId ?? "-"}`,
      );
    } catch (err) {
      reportWarn("sms-router", 
        `[sms] silent copy to chat=${silentCopyChatId} failed:`,
        err,
      );
    }
  }

  return { delivered };
}

function buildSmsActionKeyboard(
  dedupId: number,
  privateLogId?: number | null,
): InlineKeyboard {
  // Three actions per SMS: delete the Telegram copy, block this
  // kind so the AI gate filters similar messages, or accept this
  // kind so future repeats arrive WITHOUT buttons (the operator's
  // "don't ask me again" tick). Plus an optional reveal button when
  // the body is hidden behind a "🔒 پیام خصوصی" placeholder.
  const kb = new InlineKeyboard();
  if (privateLogId) {
    kb.text("👁 نمایش متن", `sms:reveal:${privateLogId}`).row();
  }
  kb.text("🗑 پاک کن", `sms:rm:${dedupId}`)
    .text("🚫 این مدل رو نیار", `sms:block:${dedupId}`)
    .row()
    .text("✅ پذیرفتم", `sms:ok:${dedupId}`);
  return kb;
}

function formatTehranTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
