import { config } from "./config";
import { getSettings } from "./settings";

export type Classification = {
  importance: number;
  urgent: boolean;
  concernsOwner: boolean;
  reason: string;
};

const SYSTEM_PROMPT = `You are a screening secretary for the owner of a Telegram account.
For each incoming message you see, decide whether the owner must be alerted
IMMEDIATELY via a physical alert device, or whether the message can wait until
the owner next opens Telegram.

You will receive ONE message at a time as JSON with metadata about the chat and sender.

Reply with STRICT JSON only, no prose, no code fences:
{
  "importance": <integer 0-10>,
  "urgent": <true|false>,
  "concerns_owner": <true|false>,
  "reason": "<one short sentence, English>"
}

Scoring rubric:
- 0-3: spam, ads, casual chatter, group noise, jokes, forwards, automated notifications.
- 4-6: ordinary personal or work conversation; can wait hours.
- 7-8: messages explicitly addressed to the owner that expect an action soon.
- 9-10: real emergencies (medical, security, family crisis, severe financial/legal threat).

Set "urgent" = true ONLY if the message cannot wait a few hours.
Set "concerns_owner" = true if the message is addressed to the owner, mentions them
by name, or clearly expects them to act. In group chats default to false unless the
owner is explicitly tagged or named.

Be conservative. False alarms train the owner to ignore the alert device.`;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

async function callOpenRouter(messages: Array<{ role: string; content: string }>, opts: {
  maxTokens?: number;
  jsonObject?: boolean;
}): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;

  const body: Record<string, unknown> = {
    model: config.openrouterModel,
    temperature: 0,
    max_tokens: opts.maxTokens ?? 200,
    messages,
  };
  if (opts.jsonObject) body.response_format = { type: "json_object" };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as ChatCompletionResponse;
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
  return data.choices?.[0]?.message?.content ?? "";
}

export async function classify(input: {
  chatType: string;
  chatTitle?: string;
  senderName: string;
  text: string;
}): Promise<Classification> {
  const s = await getSettings();
  const userPayload = {
    chat_type: input.chatType,
    chat_title: input.chatTitle,
    sender_name: input.senderName,
    owner_name: s.ownerName,
    owner_context: s.ownerContext || undefined,
    message: input.text,
  };
  const content = await callOpenRouter(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    { maxTokens: 200, jsonObject: true },
  );
  return parseVerdict(content);
}

function parseVerdict(raw: string): Classification {
  const json = extractJson(raw);
  const parsed = json
    ? (JSON.parse(json) as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  const importance = Number(parsed.importance);
  return {
    importance: Number.isFinite(importance)
      ? Math.max(0, Math.min(10, Math.round(importance)))
      : 0,
    urgent: parsed.urgent === true,
    concernsOwner: parsed.concerns_owner === true,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

function extractJson(s: string): string | null {
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

const SUMMARY_PROMPT = `You analyze a group chat's recent activity for a Telegram secretary
and return a STRICT JSON summary the owner can scan in 20 seconds.

Reply with JSON only, no prose, no code fences:
{
  "summary": "<2-4 sentence overview in the same language as the messages>",
  "topics": ["short topic", ...],
  "action_items": ["specific TODO or unanswered question, who should act if known", ...],
  "mentions_owner": <true|false>
}

Guidance:
- Topics: 3-7 short labels, prefer concrete nouns over generic ones.
- Action items: things still open, especially anything the owner should look at.
- mentions_owner=true if the owner is asked something, tagged, or expected to act.
- Stay neutral; do not invent facts not in the messages.`;

export type GroupSummary = {
  summary: string;
  topics: string[];
  actionItems: string[];
  mentionsOwner: boolean;
};

export async function summarizeGroup(input: {
  chatTitle: string | null;
  ownerName: string;
  ownerContext: string;
  messages: { sender: string; text: string; at: Date }[];
}): Promise<GroupSummary> {
  const payload = {
    chat_title: input.chatTitle,
    owner_name: input.ownerName,
    owner_context: input.ownerContext || undefined,
    messages: input.messages.slice(-150).map((m) => ({
      sender: m.sender,
      text: m.text.slice(0, 400),
      at: m.at.toISOString(),
    })),
  };
  const content = await callOpenRouter(
    [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
    { maxTokens: 700, jsonObject: true },
  );
  return parseSummary(content);
}

function parseSummary(raw: string): GroupSummary {
  const json = extractJson(raw);
  const parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    topics: Array.isArray(parsed.topics)
      ? (parsed.topics as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    actionItems: Array.isArray(parsed.action_items)
      ? (parsed.action_items as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [],
    mentionsOwner: parsed.mentions_owner === true,
  };
}
