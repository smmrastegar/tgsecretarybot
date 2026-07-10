// LLM-backed rule matcher. The operator describes a rule in plain
// language ("messages containing an OTP / verification code", "links
// to crypto news", etc.). On each incoming message we ask the model
// which of the enabled rules match, and optionally reformat the
// message before forwarding to the recipients.
//
// One LLM call per message regardless of how many rules exist —
// the call gets the full rule list and returns the matching ids
// as JSON. Cheap (~$0.0001 with Gemini 2.0 Flash) and easy to
// reason about.

import {
  listRuleExamples,
  recordAiUsage,
  type MessageRule,
  type RuleExample,
} from "./db";
import { config } from "./config";

// Try multiple model slugs — OpenRouter has been renaming the Gemini
// preview chain frequently and the old hardcoded "gemini-2.0-flash-001"
// was returning empty objects on the suggest path. We pick the first
// one that comes back with usable content.
const MATCH_MODELS = [
  process.env.OPENROUTER_RULE_MODEL,
  config.openrouterModel,
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash-001",
  "google/gemini-flash-1.5",
].filter(
  (m, i, arr): m is string =>
    typeof m === "string" && m.length > 0 && arr.indexOf(m) === i,
);
const MATCH_TIMEOUT_MS = 20_000;
const FORMAT_TIMEOUT_MS = 20_000;
const COST_PER_MATCH_USD = 0.00005;
const COST_PER_FORMAT_USD = 0.00005;

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
      throw new Error(`rule LLM timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function callLlm(args: {
  models: string[];
  systemPrompt: string;
  userPrompt: string;
  jsonObject: boolean;
  purpose: string;
  chatId: number | null;
  businessConnectionId: string | null;
  costUsd: number;
  timeoutMs: number;
}): Promise<{ text: string; model: string }> {
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;
  const errors: string[] = [];
  for (const model of args.models) {
    const body: Record<string, unknown> = {
      model,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
    };
    if (args.jsonObject) body.response_format = { type: "json_object" };
    let res: Response;
    try {
      res = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        { method: "POST", headers, body: JSON.stringify(body) },
        args.timeoutMs,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rules] ${model} network: ${msg}`);
      errors.push(`${model}: ${msg}`);
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[rules] ${model} HTTP ${res.status}: ${txt.slice(0, 200)}`);
      errors.push(`${model}: ${res.status}`);
      continue;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (json.error) {
      console.warn(`[rules] ${model} error: ${json.error.message}`);
      errors.push(`${model}: ${json.error.message ?? "error"}`);
      continue;
    }
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      console.warn(`[rules] ${model} returned empty content`);
      errors.push(`${model}: empty content`);
      continue;
    }
    await recordAiUsage({
      chatId: args.chatId,
      businessConnectionId: args.businessConnectionId,
      model,
      purpose: args.purpose,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: args.costUsd,
    }).catch(() => {});
    return { text, model };
  }
  throw new Error(
    `all rule models failed: ${errors.join(" | ").slice(0, 500)}`,
  );
}

// Pick a DIVERSE sample of at most n items — head + tail — so the
// classifier sees both the oldest and the newest examples. A plain
// slice(0,n) showed only the oldest, so newer example kinds (e.g. a
// bank "رمز پویا" added after 13 card-number examples) were invisible
// and the rule silently narrowed to the old kind.
function pickDiverse<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const head = Math.ceil(n / 2);
  const tail = n - head;
  return [...arr.slice(0, head), ...arr.slice(arr.length - tail)];
}

function extractJson(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const m = trimmed.match(/\{[\s\S]*\}/);
  return m ? m[0] : trimmed;
}

// Pluck NAME: <...> / DESCRIPTION: <...> from a model reply that's
// plain text instead of JSON. The suggest path uses this because
// asking Gemini for JSON kept returning empty objects on this purpose.
function parseSuggestLines(s: string): {
  name: string;
  description: string;
} | null {
  const text = s.trim();
  if (!text) return null;
  const nameMatch = text.match(
    /^\s*(?:NAME|name|اسم|نام)\s*[:：]\s*(.+)$/im,
  );
  const descMatch = text.match(
    /^\s*(?:DESCRIPTION|DESC|description|توصیف|شرح|توضیح)\s*[:：]\s*([\s\S]+?)(?:\n\s*\n|\n[A-Za-z]+\s*:|$)/im,
  );
  const name = nameMatch?.[1]?.trim().replace(/^["'«»]|["'«»]$/g, "") ?? "";
  const description =
    descMatch?.[1]?.trim().replace(/^["'«»]|["'«»]$/g, "") ?? "";
  if (!name && !description) return null;
  return { name: name.slice(0, 80), description: description.slice(0, 600) };
}

export type MatchContext = {
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  messageText: string;
  businessConnectionId?: string | null;
};

// Returns the ids of the rules that match. Empty array = nothing
// matched (or the LLM call failed — we swallow errors so a flaky
// model doesn't break the message pipeline).
export async function matchRules(
  ctx: MatchContext,
  rules: MessageRule[],
  examplesByRule?: Record<number, RuleExample[]>,
): Promise<number[]> {
  if (rules.length === 0) return [];
  if (!ctx.messageText.trim()) return [];
  const examplesMap: Record<number, RuleExample[]> = examplesByRule ?? {};
  const negativesMap: Record<number, RuleExample[]> = {};
  if (!examplesByRule) {
    for (const r of rules) {
      examplesMap[r.id] = await listRuleExamples(r.id).catch(() => []);
    }
  }
  // Counter-examples (must NOT match) are always fetched — they're the
  // main lever against over-matching a vague description.
  for (const r of rules) {
    negativesMap[r.id] = await listRuleExamples(r.id, "negative_match").catch(
      () => [],
    );
  }
  // Plain-text reply (JSON mode kept coming back as "{}" on Gemini —
  // every message would silently look like "no rules matched"). We ask
  // for a single MATCHED: <comma list> line and parse with regex.
  const systemPrompt = `You are a strict routing classifier. The operator has a list of rules. Each rule has an id, a name, a primary description, positive examples (messages that SHOULD match) and counter-examples (messages that must NOT match).

A rule MATCHES the incoming message ONLY when the message CLEARLY fits THAT rule's described KIND of message. Judge by MEANING/INTENT, not by surface features.

Be conservative — when in doubt, do NOT match. Rules to apply PER-RULE (never globally):
- The mere presence of digits/numbers is NOT enough on its own. A number counts only if it is the SPECIFIC kind the rule's description asks for. E.g. a rule about "bank card / account / IBAN numbers" matches a real card/account/IBAN but NOT an unrelated reservation/ticket/order/phone number; a rule about "OTP / verification / dynamic password (رمز پویا)" matches exactly those codes.
- Decide what counts using ONLY this rule's own description, positive examples, and counter-examples — do NOT import assumptions from other rules. A category that is a counter-example for one rule may be the target of another.
- If the message resembles ANY of THIS rule's counter-examples, do NOT match it.

Reply with EXACTLY one line, no preamble, no markdown:

MATCHED: <comma-separated ids>

If nothing matches, reply exactly:

MATCHED: none

Examples:
  MATCHED: 12
  MATCHED: 7, 19
  MATCHED: none

Never explain. Never wrap in code fences.`;
  const rulesBlock = rules
    .map((r) => {
      const exs = pickDiverse(examplesMap[r.id] ?? [], 8)
        .map((e, i) => `    positive_example${i + 1}: "${e.text.slice(0, 200)}"`)
        .join("\n");
      const negs = pickDiverse(negativesMap[r.id] ?? [], 8)
        .map((e, i) => `    counter_example${i + 1} (must NOT match): "${e.text.slice(0, 200)}"`)
        .join("\n");
      return `- id=${r.id}\n  name: "${r.name.slice(0, 60)}"\n  description: "${r.description.slice(0, 400)}"${exs ? "\n" + exs : ""}${negs ? "\n" + negs : ""}`;
    })
    .join("\n");
  const userPrompt = [
    "Rules:",
    rulesBlock,
    "",
    "Incoming message:",
    `chat: ${ctx.chatTitle ?? ctx.senderName} (id=${ctx.chatId})`,
    `from: ${ctx.senderName}`,
    `text:`,
    ctx.messageText.slice(0, 1500),
  ].join("\n");

  let raw: string;
  try {
    const out = await callLlm({
      models: MATCH_MODELS,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_match",
      chatId: ctx.chatId,
      businessConnectionId: ctx.businessConnectionId ?? null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
    raw = out.text;
  } catch (err) {
    console.warn("[rules] match call failed:", err);
    return [];
  }
  const validIds = new Set(rules.map((r) => r.id));
  // FAIL CLOSED: only accept ids from an explicit "MATCHED:" line.
  // The old fallback plucked every \d+ out of the WHOLE reply when the
  // line was missing — a verbose model answer like "rule id=2 does not
  // apply" became a match for rule 2 and forwarded a message to real
  // people. No MATCHED line → treat as no match, log for diagnosis.
  const matchedLine = raw.match(/MATCHED\s*:\s*([^\n]+)/i);
  if (!matchedLine) {
    console.warn(
      `[rules] match output had no MATCHED line — treating as no-match. raw: ${raw.slice(0, 300)}`,
    );
    return [];
  }
  const searchSpace = matchedLine[1] ?? "";
  if (/\bnone\b/i.test(searchSpace)) return [];
  const ids = (searchSpace.match(/\d+/g) ?? [])
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n) && validIds.has(n));
  const unique = Array.from(new Set(ids));
  if (unique.length > 0) {
    console.log(`[rules] match ids=[${unique.join(",")}] for chat=${ctx.chatId}`);
  }
  return unique;
}

// Batch test: classify whether each of `messages` matches `rule`. One
// LLM call covers the whole batch — way cheaper and more reliable than
// 30 single-message calls. Returns an array of booleans aligned with
// the input order.
export async function batchTestRule(args: {
  rule: MessageRule;
  examples: RuleExample[];
  negatives?: RuleExample[];
  messages: { id: number; text: string; sender: string }[];
}): Promise<boolean[]> {
  const out = new Array<boolean>(args.messages.length).fill(false);
  if (args.messages.length === 0) return out;
  const exs = pickDiverse(args.examples, 8)
    .map((e, i) => `  positive_example${i + 1}: "${e.text.slice(0, 200)}"`)
    .join("\n");
  const negs = pickDiverse(args.negatives ?? [], 8)
    .map((e, i) => `  counter_example${i + 1} (must NOT match): "${e.text.slice(0, 200)}"`)
    .join("\n");
  const systemPrompt = `You are testing a single routing rule against multiple historical messages. A message MATCHES ONLY when it CLEARLY fits THIS rule's described KIND of message, judged by MEANING/INTENT — not by surface features.

Be conservative — when in doubt, mark NO. Apply these per THIS rule (not globally):
- The mere presence of digits/numbers is NOT enough on its own. A number counts only if it is the SPECIFIC kind this rule's description asks for. A "bank card / account / IBAN" rule matches a real card/account/IBAN but not an unrelated number; an "OTP / verification / dynamic password (رمز پویا)" rule matches exactly those codes.
- Use ONLY this rule's own description, positive examples, and counter-examples. A category that's a counter-example for another rule may be this rule's target.
- If a message resembles ANY counter-example, mark NO.

Reply with EXACTLY one MATCHED line listing the indexes that matched:

MATCHED: <comma-separated indexes>

If nothing matched, reply:

MATCHED: none

Indexes are 1-based and refer to the "MESSAGES" list below. Never explain, never wrap in code fences.`;
  const userPrompt = [
    "RULE:",
    `  name: "${args.rule.name}"`,
    `  description: "${args.rule.description}"`,
    exs ? `  positive examples:\n${exs}` : "  (no positive examples)",
    negs ? `  counter-examples:\n${negs}` : "",
    "",
    "MESSAGES:",
    ...args.messages.map(
      (m, i) =>
        `[${i + 1}] from ${m.sender}: ${m.text.slice(0, 600).replace(/\n+/g, " ")}`,
    ),
  ].join("\n");
  let raw: string;
  try {
    const out2 = await callLlm({
      models: MATCH_MODELS,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_test_batch",
      chatId: null,
      businessConnectionId: null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: 40_000,
    });
    raw = out2.text;
  } catch (err) {
    console.warn("[rules] batch test call failed:", err);
    return out;
  }
  const matchedLine = raw.match(/MATCHED\s*:\s*([^\n]+)/i);
  const searchSpace = matchedLine?.[1] ?? raw;
  if (/\bnone\b/i.test(searchSpace) || /MATCHED:\s*$/i.test(raw)) {
    return out;
  }
  for (const tok of searchSpace.match(/\d+/g) ?? []) {
    const n = Number(tok);
    if (Number.isFinite(n) && n >= 1 && n <= out.length) out[n - 1] = true;
  }
  if (!matchedLine && !out.some(Boolean)) {
    console.warn(
      `[rules] batch test had no MATCHED line + no parseable ids — raw: ${raw.slice(0, 300)}`,
    );
  }
  return out;
}

// Suggest a short rule name + description from a single message body.
// Used by the "📐 to rule" button so the operator doesn't have to type
// from scratch — they can edit the suggestion before saving.
export async function suggestRuleFromMessage(
  text: string,
): Promise<{ name: string; description: string } | null> {
  if (!text || !text.trim()) return null;
  // Plain-text prompt — JSON mode kept coming back empty on Gemini.
  // The model now writes two labelled lines which we pull out with
  // parseSuggestLines.
  const systemPrompt = `You are labelling messages for an automatic forwarding rule. The operator gave you ONE real example message. Suggest a short name + a generalised description so similar future messages will match.

Reply in EXACTLY this format on two lines, no preamble, no markdown, no quotes:

NAME: <3-6 words. Persian if the message text looks Persian, otherwise English>
DESCRIPTION: <one sentence describing the KIND of messages — mention the trigger like "OTP / verification code", "news link", "delivery update". Same language as NAME>

Never leave either field blank. Never explain. Never wrap in code fences.`;
  const userPrompt = `Message body:\n${text.slice(0, 2000)}`;
  let raw: string;
  let usedModel = "";
  try {
    const out = await callLlm({
      models: MATCH_MODELS,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_suggest",
      chatId: null,
      businessConnectionId: null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
    raw = out.text;
    usedModel = out.model;
  } catch (err) {
    console.warn("[rules] suggest call failed:", err);
    return heuristicSuggest(text);
  }
  // Strip any stray code fences just in case.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Try the labelled-line parser first (matches our prompt).
  const lines = parseSuggestLines(cleaned);
  if (lines) return lines;
  // Fallback: maybe the model went rogue and returned JSON anyway.
  try {
    const parsed = JSON.parse(extractJson(cleaned)) as {
      name?: string;
      description?: string;
    };
    const name = (parsed.name ?? "").trim().slice(0, 80);
    const description = (parsed.description ?? "").trim().slice(0, 600);
    if (name || description) return { name, description };
  } catch {}
  console.warn(
    `[rules] suggest unusable from ${usedModel}. raw: ${raw.slice(0, 300)}`,
  );
  return heuristicSuggest(text);
}

// Ask the LLM to pull the verification code out of a message body.
// Used by OTP-format mode in lieu of regex — regex kept misfiring on
// years / phone fragments / hash IDs and the operator asked to do
// extraction via AI instead. Returns the bare code or null when the
// model says there isn't one.
// Normalise Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9
// before we run them through pre-filters / the LLM. JavaScript's
// default \d class only matches Latin digits so a Persian-only OTP
// like "۱۴۵۵۵۵۵" would otherwise slip past every regex we have.
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function normaliseDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

export async function extractOtpCodeAi(
  text: string,
): Promise<string | null> {
  if (!text || !text.trim()) return null;
  // Normalise digits first so Gemini sees ASCII numbers regardless of
  // source script. This also means the returned code is always in
  // English digits, which is what the dashboard chip + Telegram
  // tap-to-copy want.
  const body = normaliseDigits(text);
  const systemPrompt = `You extract the verification / OTP code from one message.

Reply on EXACTLY one line, nothing else, no preamble, no markdown, no quotes:

  CODE: <the code>

If there is NO verification code in the message reply with:

  CODE: none

The "code" is whatever the message identifies as a one-time login / verification / OTP / PIN value, even when it's surrounded by greeting text or service branding. Do NOT return phone numbers, dates, years, message ids, or fragments of URLs. Persian, Arabic, English — all fine.

Examples:
input: "977487 is your Call.com verification code."
output: CODE: 977487

input: "Your code is 123456. Don't share with anyone."
output: CODE: 123456

input: "کد تایید شما: 9876"
output: CODE: 9876

input: "Hello, how are you?"
output: CODE: none

input: "Source Address: 447480022838\\nDate: Fri, 12 Jun 2026 15:18:17 GMT\\nText: 431459 is your Call.com verification code."
output: CODE: 431459

input: "پنجره ملی خدمات دولت\\nهشدار کد دسترسی به اطلاعات محرمانه!\\n45290"
output: CODE: 45290

input: "ثنا\\nرمز ورود یکبار مصرف: 738261\\nاین رمز را با کسی به اشتراک نگذارید."
output: CODE: 738261`;
  const userPrompt = `Message:\n${body.slice(0, 1500)}`;
  let raw: string;
  try {
    const out = await callLlm({
      models: MATCH_MODELS,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_otp_extract",
      chatId: null,
      businessConnectionId: null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
    raw = out.text;
  } catch (err) {
    console.warn("[rules] OTP extract call failed:", err);
    return null;
  }
  const m = raw.match(/CODE\s*[:：]\s*([^\s\n]+)/i);
  const code = (m?.[1] ?? "").trim().replace(/^["'«»]|["'«»]$/g, "");
  if (!code || /^none$/i.test(code)) return null;
  // Sanity: real OTPs are 4-10 chars. Anything longer is a card
  // number (16), IBAN (24+), tracking id, or phone — all of which
  // have leaked through here before. Reject, don't forward.
  if (code.length < 4 || code.length > 10) return null;
  if (/\s/.test(code)) return null;
  // The code MUST literally appear in the (digit-normalised) message.
  // If the model returned something not present in the text, it
  // hallucinated or reformatted — don't forward a code we can't point
  // to in the source. `body` is already normaliseDigits(text).
  if (!body.toLowerCase().includes(code.toLowerCase())) {
    console.warn(
      `[rules] OTP extract rejected — "${code}" not present in message body`,
    );
    return null;
  }
  return code;
}

// Returns true iff `text` looks like it's asking for whatever the
// operator described. `gateExamples` are stored phrasings (AI- or
// human-authored) that act as additional match seeds.
export async function checkRequestTriggerMatch(
  text: string,
  requestTrigger: string,
  gateExamples: string[] = [],
): Promise<boolean> {
  if (!text.trim()) return false;
  if (!requestTrigger.trim() && gateExamples.length === 0) return false;
  const systemPrompt = `You decide whether a single incoming message is a REQUEST that fits the operator's description and example phrasings.

Reply with EXACTLY one word on one line: YES or NO. No explanation, no punctuation, no markdown.

Be conservative — only answer YES when the message clearly asks for what the description / examples describe.`;
  const examplesBlock =
    gateExamples.length > 0
      ? `\n\nExample phrasings the operator has saved (treat each as a match seed):\n${gateExamples
          .slice(0, 20)
          .map((e) => `- ${e.slice(0, 200)}`)
          .join("\n")}`
      : "";
  const userPrompt = `Request description from operator:
${requestTrigger.slice(0, 400)}${examplesBlock}

Incoming message:
${text.slice(0, 1500)}`;
  try {
    const out = await callLlm({
      models: MATCH_MODELS,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_request_check",
      chatId: null,
      businessConnectionId: null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
    return /^\s*yes\b/i.test(out.text);
  } catch (err) {
    console.warn("[rules] request-trigger check failed:", err);
    return false;
  }
}

// Last-resort name/description guesser — runs when the LLM call fails
// or returns junk. Keyword based; not perfect but better than handing
// the operator empty fields after they clicked the button.
function heuristicSuggest(
  text: string,
): { name: string; description: string } | null {
  const t = text.toLowerCase();
  if (
    /\b(otp|verification|verify|code|verification code)\b/i.test(text) ||
    /\b(?:کد|رمز)\s*(?:تایید|ورود|یکبار|otp)\b/u.test(text) ||
    /\b\d{4,8}\b.*(?:code|verification|otp|تایید|رمز)/iu.test(text) ||
    /(?:verification|otp).*\b\d{4,8}\b/i.test(text)
  ) {
    return {
      name: "کدهای OTP",
      description:
        "پیام‌هایی که حاوی یک کد تایید/OTP/verification هستن، معمولاً ۴ تا ۸ رقمی، از سرویس‌های آنلاین.",
    };
  }
  if (/https?:\/\/|t\.me\//i.test(text)) {
    return {
      name: "لینک‌ها",
      description: "پیام‌هایی که یک لینک HTTP یا تلگرامی توشون هست.",
    };
  }
  if (
    /\b(invoice|receipt|payment|paid|amount|تومان|ریال|پرداخت|فاکتور)\b/iu.test(
      text,
    )
  ) {
    return {
      name: "پرداخت‌ها و فاکتورها",
      description:
        "پیام‌هایی که مربوط به پرداخت، فاکتور یا تراکنش مالی هستن.",
    };
  }
  return null;
}

// Reformats the message text according to the rule's forward_format
export async function formatMessageForRule(
  rule: MessageRule,
  ctx: MatchContext,
): Promise<string | null> {
  if (!rule.forwardFormat || !rule.forwardFormat.trim()) return null;
  const systemPrompt = [
    "You reformat incoming messages for a forwarding pipeline.",
    "The operator gives you a format spec; you produce the output text",
    "that will be sent to the recipient — usually shorter and easier to",
    "scan than the original. Output ONLY the formatted text, no labels,",
    "no quotes, no markdown fences. If the message has no relevant content",
    "matching the format, return the original message text unchanged.",
  ].join(" ");
  const userPrompt = [
    `Format spec from operator:`,
    rule.forwardFormat,
    "",
    "Original message:",
    `from ${ctx.senderName} in ${ctx.chatTitle ?? "DM"}`,
    ctx.messageText.slice(0, 2000),
  ].join("\n");
  try {
    const out = await callLlm({
      models: MATCH_MODELS,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_format",
      chatId: ctx.chatId,
      businessConnectionId: ctx.businessConnectionId ?? null,
      costUsd: COST_PER_FORMAT_USD,
      timeoutMs: FORMAT_TIMEOUT_MS,
    });
    return out.text.trim() || null;
  } catch (err) {
    console.warn("[rules] format call failed:", err);
    return null;
  }
}
