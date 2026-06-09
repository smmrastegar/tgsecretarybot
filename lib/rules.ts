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
  // Load examples per rule if the caller didn't pass them in. Each rule
  // is treated as a disjunction over (description, example1, example2,
  // ...) — match ANY → rule fires.
  const examplesMap: Record<number, RuleExample[]> = examplesByRule ?? {};
  if (!examplesByRule) {
    for (const r of rules) {
      examplesMap[r.id] = await listRuleExamples(r.id).catch(() => []);
    }
  }
  const systemPrompt = [
    "You are a routing classifier. The operator has defined a list of rules.",
    "Each rule has an id, a name, a primary description, and zero or more",
    "example messages. A rule MATCHES the incoming message if it satisfies",
    "the description OR resembles ANY of the examples — it's a disjunction.",
    "Be conservative — include a rule only when the match is clear.",
    "Output strict JSON:",
    '{ "matched": [<id>, <id>, ...] }',
    'If nothing matches, return { "matched": [] }. No prose, no markdown.',
  ].join(" ");
  const rulesBlock = rules
    .map((r) => {
      const exs = (examplesMap[r.id] ?? [])
        .slice(0, 6)
        .map((e, i) => `    example${i + 1}: "${e.text.slice(0, 200)}"`)
        .join("\n");
      return `- id=${r.id}\n  name: "${r.name.slice(0, 60)}"\n  description: "${r.description.slice(0, 400)}"${exs ? "\n" + exs : ""}`;
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
      jsonObject: true,
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
  try {
    const parsed = JSON.parse(extractJson(raw)) as { matched?: unknown };
    if (!Array.isArray(parsed.matched)) return [];
    return parsed.matched
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && rules.some((r) => r.id === n));
  } catch (err) {
    console.warn("[rules] match parse failed:", err, "raw:", raw.slice(0, 200));
    return [];
  }
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
