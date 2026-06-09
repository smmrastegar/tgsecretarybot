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

const MATCH_MODEL = "google/gemini-2.0-flash-001";
const FORMAT_MODEL = "google/gemini-2.0-flash-001";
const MATCH_TIMEOUT_MS = 15_000;
const FORMAT_TIMEOUT_MS = 15_000;
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
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonObject: boolean;
  purpose: string;
  chatId: number | null;
  businessConnectionId: string | null;
  costUsd: number;
  timeoutMs: number;
}): Promise<string> {
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;
  const body: Record<string, unknown> = {
    model: args.model,
    temperature: 0,
    max_tokens: 600,
    messages: [
      { role: "system", content: args.systemPrompt },
      { role: "user", content: args.userPrompt },
    ],
  };
  if (args.jsonObject) body.response_format = { type: "json_object" };
  const res = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    { method: "POST", headers, body: JSON.stringify(body) },
    args.timeoutMs,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`rule LLM ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? "rule LLM error");
  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  await recordAiUsage({
    chatId: args.chatId,
    businessConnectionId: args.businessConnectionId,
    model: args.model,
    purpose: args.purpose,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: args.costUsd,
  }).catch(() => {});
  return text;
}

function extractJson(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const m = trimmed.match(/\{[\s\S]*\}/);
  return m ? m[0] : trimmed;
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
  const model = MATCH_MODEL;
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
    raw = await callLlm({
      model,
      systemPrompt,
      userPrompt,
      jsonObject: true,
      purpose: "rule_match",
      chatId: ctx.chatId,
      businessConnectionId: ctx.businessConnectionId ?? null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
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
  const systemPrompt = [
    "You generate routing-rule labels from a single message body.",
    "Output strict JSON:",
    '{ "name": "<3-6 words, Persian or English, no quotes>",',
    '  "description": "<one-sentence rule that captures what KIND of',
    '  messages this is (not just this specific one). Persian when the',
    '  source is Persian, otherwise English. No quotes.>" }',
    "No prose, no markdown, no extra fields.",
  ].join(" ");
  const userPrompt = `Message body:\n${text.slice(0, 2000)}`;
  let raw: string;
  try {
    raw = await callLlm({
      model: MATCH_MODEL,
      systemPrompt,
      userPrompt,
      jsonObject: true,
      purpose: "rule_suggest",
      chatId: null,
      businessConnectionId: null,
      costUsd: COST_PER_MATCH_USD,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
  } catch (err) {
    console.warn("[rules] suggest call failed:", err);
    return null;
  }
  try {
    const parsed = JSON.parse(extractJson(raw)) as {
      name?: string;
      description?: string;
    };
    const name = (parsed.name ?? "").trim().slice(0, 80);
    const description = (parsed.description ?? "").trim().slice(0, 600);
    if (!name || !description) return null;
    return { name, description };
  } catch (err) {
    console.warn(
      "[rules] suggest parse failed:",
      err,
      "raw:",
      raw.slice(0, 200),
    );
    return null;
  }
}

// Reformats the message text according to the rule's forward_format
export async function formatMessageForRule(
  rule: MessageRule,
  ctx: MatchContext,
): Promise<string | null> {
  if (!rule.forwardFormat || !rule.forwardFormat.trim()) return null;
  const model = FORMAT_MODEL;
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
      model,
      systemPrompt,
      userPrompt,
      jsonObject: false,
      purpose: "rule_format",
      chatId: ctx.chatId,
      businessConnectionId: ctx.businessConnectionId ?? null,
      costUsd: COST_PER_FORMAT_USD,
      timeoutMs: FORMAT_TIMEOUT_MS,
    });
    return out.trim() || null;
  } catch (err) {
    console.warn("[rules] format call failed:", err);
    return null;
  }
}
