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

// ── Deterministic, example-driven matching ──────────────────────
// The operator's mental model: "the message I built this rule from
// MUST match, and every message like it; if one slips through, I paste
// it and it's covered." An LLM classifier can't honour that — it
// rejected messages verbatim-present in a rule's own examples. So the
// PRIMARY matcher is deterministic similarity to the stored examples.
// The LLM is only a fallback for rules that have a description but no
// positive examples yet.

const MATCH_STOP = new Set([
  "به","از","را","که","تا","با","در","این","یا","هم","رو","یه","شما","برای",
  "و","بر","بی","تو","من","ما","اون","اینو","های","ها","شده","شد","می","نمی",
  "the","a","an","to","of","is","are","your","you","for","and","or","in","on",
  "please","this","that","با سلام","سلام",
]);

// Normalise for matching: ASCII digits, digit-runs → "#", drop
// punctuation, lowercase. So "رمز: 709145" and "رمز: 445566" both
// become "رمز #" and compare as identical.
function normForMatch(t: string): string {
  return normaliseDigits(t)
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

// Distinctive NUMBER-SHAPE features. Free-form messages that carry a
// card / IBAN share little wording but the same shape — so a shape is a
// strong signal, weighted well above ordinary words. (Amounts and short
// codes stay as "#" words so they don't cross-match card↔code.)
const PATTERN_WEIGHT = 5;
function shapeFeatures(t: string): string[] {
  const n = normaliseDigits(t);
  const feats: string[] = [];
  // 16-ish card: one 13-19 digit run, or four groups of four.
  if (/(?<!\d)\d{13,19}(?!\d)/.test(n) || /(?:\d{4}[ \-]){3}\d{4}/.test(n))
    feats.push("«card»");
  // Iran IBAN: IR + ~24 digits (tolerate spaces between groups).
  if (/ir\d{20,26}/i.test(n.replace(/[ \-]/g, ""))) feats.push("«iban»");
  return feats;
}
// Feature set = distinctive words (numbers masked) + number-shape tags.
function matchTokens(t: string): Set<string> {
  const words = normForMatch(t)
    .split(/\s+/)
    .filter((w) => w && w.length >= 2 && !MATCH_STOP.has(w));
  return new Set([...words, ...shapeFeatures(t)]);
}
function weight(tk: string): number {
  return tk.startsWith("«") ? PATTERN_WEIGHT : 1;
}
// Weighted containment: how much of `exText`'s distinctive content is
// present in the message. 1.0 = fully present. Shape features dominate.
function exampleScore(
  exText: string,
  msgFeatures: Set<string>,
  msgNorm: string,
): number {
  const ef = matchTokens(exText);
  if (ef.size < 1) {
    const en = normForMatch(exText);
    return en.length >= 2 && msgNorm.includes(en) ? 1 : 0;
  }
  let matchedW = 0;
  let totalW = 0;
  for (const tk of ef) {
    const w = weight(tk);
    totalW += w;
    if (msgFeatures.has(tk)) matchedW += w;
  }
  return totalW === 0 ? 0 : matchedW / totalW;
}

const MATCH_THRESHOLD = 0.6;

// Decide a rule by its examples. Returns true/false when there is at
// least one positive example; null when there are none (→ caller may
// fall back to the LLM/description path).
export function classifyByExamples(
  messageText: string,
  positives: RuleExample[],
  negatives: RuleExample[],
): boolean | null {
  if (positives.length === 0) return null;
  const msgFeatures = matchTokens(messageText);
  const msgNorm = normForMatch(messageText);
  let pos = 0;
  for (const p of positives)
    pos = Math.max(pos, exampleScore(p.text, msgFeatures, msgNorm));
  let neg = 0;
  for (const n of negatives)
    neg = Math.max(neg, exampleScore(n.text, msgFeatures, msgNorm));
  // Match when the message is clearly like a positive AND not more like
  // a counter-example. Guarantees a verbatim example scores 1.0 → match.
  return pos >= MATCH_THRESHOLD && pos > neg;
}

// Returns the ids of the rules that match. Example-driven and
// deterministic for rules that have positive examples; LLM fallback
// only for description-only rules.
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
  for (const r of rules) {
    negativesMap[r.id] = await listRuleExamples(r.id, "negative_match").catch(
      () => [],
    );
  }

  const matched: number[] = [];
  const llmRules: MessageRule[] = [];
  for (const r of rules) {
    const verdict = classifyByExamples(
      ctx.messageText,
      examplesMap[r.id] ?? [],
      negativesMap[r.id] ?? [],
    );
    if (verdict === true) matched.push(r.id);
    else if (verdict === false) {
      /* examples say no — done, no LLM */
    } else {
      // No positive examples → this rule can only be judged from its
      // description. Hand it to the LLM fallback.
      llmRules.push(r);
    }
  }

  if (llmRules.length > 0) {
    const llmIds = await llmMatchRules(ctx, llmRules, negativesMap).catch(
      (err) => {
        console.warn("[rules] LLM fallback failed:", err);
        return [] as number[];
      },
    );
    matched.push(...llmIds);
  }

  const unique = Array.from(new Set(matched));
  if (unique.length > 0) {
    console.log(`[rules] match ids=[${unique.join(",")}] for chat=${ctx.chatId}`);
  }
  return unique;
}

// LLM fallback for description-only rules (no positive examples). Same
// conservative prompt as before, but now it only ever sees rules the
// operator hasn't taught by example.
async function llmMatchRules(
  ctx: MatchContext,
  rules: MessageRule[],
  negativesMap: Record<number, RuleExample[]>,
): Promise<number[]> {
  const systemPrompt = `You are a strict routing classifier. Each rule has an id, a name, a description, and counter-examples (messages that must NOT match).

A rule MATCHES the incoming message ONLY when the message CLEARLY fits THAT rule's described KIND of message, judged by MEANING/INTENT. Be conservative — when in doubt, do NOT match. The mere presence of digits is not enough. If the message resembles any of a rule's counter-examples, do NOT match it.

Reply with EXACTLY one line, no preamble, no markdown:

MATCHED: <comma-separated ids>

If nothing matches, reply exactly: MATCHED: none

Never explain. Never wrap in code fences.`;
  const rulesBlock = rules
    .map((r) => {
      const negs = pickDiverse(negativesMap[r.id] ?? [], 8)
        .map((e, i) => `    counter_example${i + 1} (must NOT match): "${e.text.slice(0, 200)}"`)
        .join("\n");
      return `- id=${r.id}\n  name: "${r.name.slice(0, 60)}"\n  description: "${r.description.slice(0, 400)}"${negs ? "\n" + negs : ""}`;
    })
    .join("\n");
  const userPrompt = [
    "Rules:",
    rulesBlock,
    "",
    "Incoming message:",
    `from: ${ctx.senderName}`,
    `text:`,
    ctx.messageText.slice(0, 1500),
  ].join("\n");

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
  const validIds = new Set(rules.map((r) => r.id));
  const matchedLine = out.text.match(/MATCHED\s*:\s*([^\n]+)/i);
  if (!matchedLine) return [];
  const searchSpace = matchedLine[1] ?? "";
  if (/\bnone\b/i.test(searchSpace)) return [];
  return Array.from(
    new Set(
      (searchSpace.match(/\d+/g) ?? [])
        .map((t) => Number(t))
        .filter((n) => Number.isFinite(n) && validIds.has(n)),
    ),
  );
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
  const negatives = args.negatives ?? [];

  // Example-driven (deterministic) when the rule has positive examples —
  // identical to the live matcher, so the test reflects reality and a
  // message present in the examples always shows as a match.
  if (args.examples.length > 0) {
    for (let i = 0; i < args.messages.length; i++) {
      out[i] =
        classifyByExamples(args.messages[i]!.text, args.examples, negatives) ===
        true;
    }
    return out;
  }

  // Description-only rule → LLM fallback (batched).
  const negs = pickDiverse(negatives, 8)
    .map((e, i) => `  counter_example${i + 1} (must NOT match): "${e.text.slice(0, 200)}"`)
    .join("\n");
  const systemPrompt = `You are testing a single routing rule against multiple historical messages. A message MATCHES ONLY when it CLEARLY fits THIS rule's described KIND of message, judged by MEANING/INTENT. Be conservative — when in doubt, mark NO. If a message resembles ANY counter-example, mark NO.

Reply with EXACTLY one MATCHED line listing the indexes that matched:

MATCHED: <comma-separated indexes>

If nothing matched, reply: MATCHED: none

Indexes are 1-based and refer to the "MESSAGES" list below. Never explain, never wrap in code fences.`;
  const userPrompt = [
    "RULE:",
    `  name: "${args.rule.name}"`,
    `  description: "${args.rule.description}"`,
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
  const searchSpace = matchedLine?.[1] ?? "";
  if (!matchedLine || /\bnone\b/i.test(searchSpace)) return out;
  for (const tok of searchSpace.match(/\d+/g) ?? []) {
    const n = Number(tok);
    if (Number.isFinite(n) && n >= 1 && n <= out.length) out[n - 1] = true;
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

The "code" is whatever the message identifies as a one-time login / verification / OTP / PIN / dynamic password (رمز پویا / رمز یکبار مصرف / رمز دوم) value, even when it's surrounded by greeting text or service branding. Do NOT return phone numbers, dates, years, message ids, fragments of URLs, card/account numbers, or MONEY AMOUNTS (numbers next to مبلغ / ریال / تومان / IRR). When a message has both an amount and a code, return the CODE (the value labelled رمز / کد / password), never the amount. Persian, Arabic, English — all fine.

Examples:
input: "977487 is your Call.com verification code."
output: CODE: 977487

input: "بلو\\nبفرمایید رمز پویا خرید اسنپ فود\\nمبلغ: 24,090,000 ریال\\nرمز: 709145"
output: CODE: 709145

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
