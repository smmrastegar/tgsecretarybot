import { config } from "./config";
import { getSettings } from "./settings";
import { recordAiUsage } from "./db";

const MODEL_RATES: Record<string, { in: number; out: number }> = {
  "google/gemini-2.0-flash-lite-001": { in: 0.075, out: 0.3 },
  "google/gemini-2.0-flash-001": { in: 0.1, out: 0.4 },
  "google/gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "anthropic/claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "anthropic/claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
};

function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rate = MODEL_RATES[model];
  if (!rate) return 0;
  return (promptTokens / 1_000_000) * rate.in + (completionTokens / 1_000_000) * rate.out;
}

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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

async function modelsToTry(purpose?: string): Promise<string[]> {
  const s = await getSettings();
  const parseCsv = (csv: string): string[] =>
    csv
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

  // For extract we want the most accurate model first. The user typically
  // orders the list cheapest-first (via the "Sort cheapest first" button),
  // so we reverse it to bias toward Sonnet / GPT-4o / Gemini Pro before
  // falling back to the cheaper tiers.
  if (purpose === "extract") {
    const chat = parseCsv((s.aiChatModelsCsv ?? "").trim());
    const general = parseCsv((s.aiModelsCsv ?? "").trim());
    const merged = [...chat.reverse(), ...general.reverse()];
    const seen = new Set<string>();
    const ordered = merged.filter((m) => (seen.has(m) ? false : seen.add(m)));
    if (ordered.length > 0) return ordered;
    return [config.openrouterModel];
  }

  // Chat / friendly replies benefit from a more capable model and the user
  // can curate that list separately. Fall back to the general list if it's
  // empty, and finally to the OPENROUTER_MODEL env value.
  const candidates: string[] = [];
  if (purpose === "ai_chat" || purpose === "friendly_reply") {
    const chatCsv = (s.aiChatModelsCsv ?? "").trim();
    if (chatCsv) candidates.push(chatCsv);
  }
  const generalCsv = (s.aiModelsCsv ?? "").trim();
  if (generalCsv) candidates.push(generalCsv);
  for (const csv of candidates) {
    const list = parseCsv(csv);
    if (list.length > 0) return list;
  }
  return [config.openrouterModel];
}

async function callOpenRouter(
  messages: Array<{ role: string; content: string }>,
  opts: {
    maxTokens?: number;
    jsonObject?: boolean;
    temperature?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    purpose: string;
    chatId?: number | null;
    businessConnectionId?: string | null;
  },
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;

  const models = await modelsToTry(opts.purpose);
  let lastErr: unknown = null;
  for (const model of models) {
    const body: Record<string, unknown> = {
      model,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 200,
      messages,
    };
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.frequencyPenalty !== undefined)
      body.frequency_penalty = opts.frequencyPenalty;
    if (opts.presencePenalty !== undefined)
      body.presence_penalty = opts.presencePenalty;
    if (opts.jsonObject) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      lastErr = new Error(`OpenRouter ${res.status} (${model}): ${txt.slice(0, 200)}`);
      console.warn(`[ai] ${model} failed: ${res.status}, trying next.`);
      continue;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    if (data.error) {
      lastErr = new Error(`OpenRouter error (${model}): ${data.error.message}`);
      console.warn(`[ai] ${model} error: ${data.error.message}, trying next.`);
      continue;
    }

    const u = data.usage;
    if (u) {
      const promptTokens = u.prompt_tokens ?? 0;
      const completionTokens = u.completion_tokens ?? 0;
      const totalTokens = u.total_tokens ?? promptTokens + completionTokens;
      const cost = estimateCost(model, promptTokens, completionTokens);
      recordAiUsage({
        chatId: opts.chatId ?? null,
        businessConnectionId: opts.businessConnectionId ?? null,
        model,
        purpose: opts.purpose,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: cost,
      }).catch((err) => console.error("[ai_usage] record failed:", err));
    }

    return data.choices?.[0]?.message?.content ?? "";
  }
  throw lastErr ?? new Error("no models succeeded");
}

export async function classify(input: {
  chatType: string;
  chatTitle?: string;
  senderName: string;
  text: string;
  chatId?: number;
  businessConnectionId?: string;
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
    {
      maxTokens: 200,
      jsonObject: true,
      purpose: "classify",
      chatId: input.chatId ?? null,
      businessConnectionId: input.businessConnectionId ?? null,
    },
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
    { maxTokens: 700, jsonObject: true, purpose: "summary" },
  );
  return parseSummary(content);
}

const AI_CHAT_PROMPT = `You are impersonating the owner of a Telegram account
in a private DM. Read the recent conversation between the owner and the other
person and write the owner's NEXT reply to the last incoming message, in the
owner's voice and language.

HARD RULES — read these carefully, the most common failure mode is breaking
them:
1. ANTI-REPETITION (CRITICAL): if the payload includes "previous_replies",
   your output MUST be substantively different from every entry there —
   different words, different angle, different verbs. Do NOT paraphrase a
   previous reply, do NOT just shuffle the same words. If the person asks
   the same question twice, that means your earlier answer was unclear or
   unsatisfying — give a NEW, more specific answer this time, ideally with
   concrete details or by asking a sharp clarifying question.
2. NO STALLING. Do not output any sentence that means "I'm checking", "I'm
   investigating", "I'm looking into it", "I'll get back to you", "wait a
   sec", "let me think", "I'm busy", "got it", "noted". Forbidden in any
   language. Examples that are FORBIDDEN: "اوکی حواسم هست",
   "هنوز در حال بررسی هستم", "دارم بررسی می‌کنم", "بعداً جواب می‌دم",
   "صبر کن", "بذار ببینم", "let me think about it", "I'll get back to you".
   These dodge the question. Always say something CONCRETE instead — even
   if it's a specific follow-up question.
3. ENGAGE THE LAST MESSAGE. Look at what they actually said and respond to
   THAT. If they asked "what?", explain the what. If they greeted you,
   greet back AND add a specific next step / question. If they pointed out
   that you're stuck in a loop, acknowledge it directly and break the loop
   with a real answer.
4. MATCH THE STYLE. Same language, same formality, same emoji density,
   same sentence length as the prior owner messages in the conversation.
   If the owner uses Persian with emojis, you use Persian with emojis. If
   they're terse, be terse.
5. PERSONA. Reply in first person AS the owner. Never reveal you are an
   AI. Never apologise on the owner's behalf. Never refuse to answer.
6. LENGTH. Usually 1-2 sentences. Greetings get greetings + a specific
   follow-up about something from context.
7. RELATIONSHIP. If the payload provides "relationship_guidance", follow
   that tone strictly — it overrides the prior conversation style when
   they conflict. If "nickname" is set, prefer addressing the person by
   that nickname (especially for close_friend / friend).

Output STRICT JSON only, no prose, no code fences:
{ "reply": "<the reply text>" }`;

// Phrases that are common AI stall fallbacks. If the model produces one of
// these (or something normalised to one), we reject the reply and retry
// rather than send another empty filler to the user.
const FORBIDDEN_STALL_PATTERNS: RegExp[] = [
  /هنوز\s*در\s*حال\s*بررسی/i,
  /دارم\s*بررسی\s*می\s*کنم/i,
  /حواسم\s*هست/i,
  /بعد(ا|اً)\s*جواب\s*می\s*[‌\s]?دم/i,
  /بذار\s*ببینم/i,
  /صبر\s*کن/i,
  /let me (think|check|see)/i,
  /i('?| a)?m (still )?(checking|investigating|looking into)/i,
  /i'?ll get back to you/i,
  /^got it\.?$/i,
  /^noted\.?$/i,
];

function looksLikeStall(reply: string): boolean {
  const t = reply.trim();
  if (!t) return true;
  return FORBIDDEN_STALL_PATTERNS.some((re) => re.test(t));
}

function normaliseForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const RELATIONSHIP_GUIDANCE: Record<string, string> = {
  close_friend:
    "دوست خیلی صمیمی — کاملاً خودمونی و صمیمی، شوخی و طعنه آزاد، بدون تعارف. کوتاه و راحت بنویس.",
  friend:
    "دوست معمولی — لحن دوستانه و راحت ولی نه خیلی پررو. می‌توانی شوخی کنی اما حد نگه‌دار.",
  work_acquaintance:
    "آشنای کاری — مودب، حرفه‌ای، گرم ولی مرزدار. از تعارف بیش از حد پرهیز کن، روی موضوع کاری بمان.",
  employer:
    "کارفرما — کاملاً محترمانه و رسمی، با احترام بالا. لحن مودب با «شما» و فعل جمع. سریع و دقیق پاسخ بده.",
  formal:
    "رودروایسی — لحن مودبانه و کمی محتاط. تعارف معمول ولی نه خیلی صمیمی. کلمات سنگین‌تر استفاده کن.",
  suspicious:
    "آدم مشکوک — مختصر و سرد. هیچ اطلاعات شخصی نده، روی پاسخ‌های کلی و حداقلی بمان. اگر سوال خاصی پرسید جواب مستقیم نده.",
  stranger:
    "آدم ناشناس — مودب، خنثی، حداقلی. اطلاعات شخصی نده، فقط جواب مناسب جنرال بده.",
};

export async function aiConversationReply(input: {
  ownerName: string;
  ownerDisplayName: string;
  ownerContext: string;
  senderName: string;
  history: Array<{ from: "owner" | "other"; senderName: string; text: string }>;
  nickname?: string | null;
  relationship?: string | null;
  chatId?: number;
  businessConnectionId?: string;
}): Promise<string> {
  // Pull the owner's last few replies out of history so we can tell the
  // model "don't repeat any of these". This is what kills the most common
  // failure mode (model gets stuck restating the same stall phrase).
  const previousReplies = input.history
    .filter((m) => m.from === "owner")
    .slice(-5)
    .map((m) => m.text.trim())
    .filter((t) => t.length > 0);

  const buildPayload = (extra?: { critique?: string }) => ({
    owner_name: input.ownerDisplayName || input.ownerName,
    owner_context: input.ownerContext || undefined,
    talking_to: input.senderName,
    nickname: input.nickname || undefined,
    relationship: input.relationship || undefined,
    relationship_guidance: input.relationship
      ? RELATIONSHIP_GUIDANCE[input.relationship]
      : undefined,
    previous_replies:
      previousReplies.length > 0 ? previousReplies : undefined,
    critique: extra?.critique || undefined,
    conversation: input.history.slice(-30).map((m) => ({
      role: m.from === "owner" ? "owner" : "them",
      name: m.senderName,
      text: m.text.slice(0, 600),
    })),
  });

  const runOnce = async (extra?: { critique?: string }) => {
    const content = await callOpenRouter(
      [
        { role: "system", content: AI_CHAT_PROMPT },
        { role: "user", content: JSON.stringify(buildPayload(extra)) },
      ],
      {
        maxTokens: 400,
        jsonObject: true,
        temperature: 1.0,
        topP: 0.95,
        frequencyPenalty: 0.6,
        presencePenalty: 0.6,
        purpose: "ai_chat",
        chatId: input.chatId ?? null,
        businessConnectionId: input.businessConnectionId ?? null,
      },
    );
    try {
      const parsed = JSON.parse(content) as { reply?: string };
      return (parsed.reply ?? "").trim();
    } catch {
      return content.trim();
    }
  };

  const previousSet = new Set(previousReplies.map(normaliseForCompare));
  const isRepeat = (r: string) => previousSet.has(normaliseForCompare(r));

  let reply = await runOnce();
  // If the model produced a stall or just copied a previous reply, give it
  // one explicit second chance with a critique. This is enough to break
  // most loops without paying for an extra call on the happy path.
  if (!reply || looksLikeStall(reply) || isRepeat(reply)) {
    const critique = looksLikeStall(reply)
      ? "Your previous attempt was a generic stalling phrase. Forbidden. Write something concrete that engages the LAST message specifically — a real answer, a specific question, or an explicit acknowledgement and a new direction."
      : "Your previous attempt was identical or near-identical to a reply you already sent. Write something materially different — different verbs, different angle, more specific information.";
    reply = await runOnce({ critique });
  }
  return reply;
}

const FRIENDLY_PROMPT = `You are impersonating the owner of a Telegram account.
The owner has a default away-message they want sent to people right now. Read
the recent conversation between the owner and the other person, then rewrite
the away-message in the same language, tone, and formality the owner uses with
THIS person. Keep the meaning of the away-message (that the owner is not
available and will respond later), but make it feel personal, warm, and like
something the owner would actually type.

If "relationship_guidance" is set in the payload, follow that tone strictly
— it overrides the prior conversation style when they conflict. If
"nickname" is set, prefer it when addressing the person (especially for
close_friend / friend).

Output STRICT JSON: { "reply": "..." }`;

export async function friendlyAutoReply(input: {
  ownerName: string;
  ownerDisplayName: string;
  ownerContext: string;
  senderName: string;
  awayMessage: string;
  history: Array<{ from: "owner" | "other"; senderName: string; text: string }>;
  nickname?: string | null;
  relationship?: string | null;
  chatId?: number;
  businessConnectionId?: string;
}): Promise<string> {
  const payload = {
    owner_name: input.ownerDisplayName || input.ownerName,
    owner_context: input.ownerContext || undefined,
    talking_to: input.senderName,
    nickname: input.nickname || undefined,
    relationship: input.relationship || undefined,
    relationship_guidance: input.relationship
      ? RELATIONSHIP_GUIDANCE[input.relationship]
      : undefined,
    away_message: input.awayMessage,
    conversation: input.history.slice(-20).map((m) => ({
      role: m.from === "owner" ? "owner" : "them",
      name: m.senderName,
      text: m.text.slice(0, 400),
    })),
  };
  const content = await callOpenRouter(
    [
      { role: "system", content: FRIENDLY_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
    {
      maxTokens: 200,
      jsonObject: true,
      temperature: 0.5,
      purpose: "friendly_reply",
      chatId: input.chatId ?? null,
      businessConnectionId: input.businessConnectionId ?? null,
    },
  );
  try {
    const parsed = JSON.parse(content) as { reply?: string };
    return (parsed.reply ?? "").trim() || input.awayMessage;
  } catch {
    return content.trim() || input.awayMessage;
  }
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

const EXTRACT_PROMPT = `You extract actionable items from a Telegram message
for a Persian-speaking owner's secretary dashboard. Look for events
(meetings, calls, appointments), deadlines, reminders, tasks, decisions, or
anything else the owner should not forget.

CRITICAL OUTPUT LANGUAGE: title, description, location, and participants
MUST be written in natural Persian (فارسی). Translate any English / Arabic
/ other text in the source message into Persian. Use natural Persian
phrasing — not literal word-for-word translation. Latin digits inside
Persian sentences are fine.

Reply with STRICT JSON only, no prose, no code fences:
{
  "items": [
    {
      "kind": "event" | "task" | "reminder" | "deadline" | "decision" | "note",
      "title": "<عنوان کوتاه فارسی، حداکثر ۸۰ کاراکتر>",
      "description": "<توضیح اختیاری یک‌جمله‌ای به فارسی>",
      "due_at": "<ISO 8601 timestamp WITH timezone, or null>",
      "location": "<مکان به فارسی، اختیاری>",
      "participants": ["<نام افراد به فارسی، اختیاری>"]
    }
  ]
}

Rules:
- Use due_at ONLY when the message specifies a concrete date or time
  (e.g., "فردا ساعت ۴ بعدازظهر", "پنج‌شنبه صبح", "10/05 14:00",
  "tomorrow at 3pm"). Resolve relative dates against the "now" timestamp
  provided in the payload. Use the Asia/Tehran timezone offset
  (+03:30 or +04:30 with DST) for due_at unless the message specifies
  another timezone. If the message is vague ("بعداً", "زود", "soon"), set
  due_at to null.
- Persian dates like "فردا ۴ عصر", "پنج‌شنبه ساعت ۸ شب", "هفته‌ی بعد سه‌شنبه"
  MUST be fully resolved to ISO 8601.
- Persian numerals (۰-۹) and Arabic-Indic numerals are equivalent to
  Latin numerals — interpret them the same way.
- Don't invent items that aren't in the message. If there's nothing
  actionable, return {"items": []}.
- "kind" meaning:
    event = a scheduled get-together or appointment
    task = something the owner has to do
    reminder = something to remember
    deadline = something that's due by a specific time
    decision = something that was agreed
    note = miscellaneous info worth keeping
- Keep titles short and concrete; prefer noun phrases ("جلسه با علی",
  "خرید نان", "تماس با پزشک") over full sentences.`;

export type ExtractedItemPayload = {
  kind: string;
  title: string;
  description?: string | null;
  due_at?: string | null;
  location?: string | null;
  participants?: string[] | null;
};

export async function extractActions(input: {
  text: string;
  senderName?: string;
  nowIso?: string;
  chatId?: number;
  businessConnectionId?: string;
}): Promise<ExtractedItemPayload[]> {
  const payload = {
    now: input.nowIso ?? new Date().toISOString(),
    from: input.senderName,
    message: input.text,
  };
  const content = await callOpenRouter(
    [
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
    {
      maxTokens: 600,
      jsonObject: true,
      temperature: 0.1,
      purpose: "extract",
      chatId: input.chatId ?? null,
      businessConnectionId: input.businessConnectionId ?? null,
    },
  );
  try {
    const parsed = JSON.parse(content) as { items?: ExtractedItemPayload[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}
