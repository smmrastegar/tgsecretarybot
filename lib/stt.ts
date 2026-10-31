import { Buffer } from "node:buffer";
import { config } from "./config";
import { getAllSettings, recordAiUsage } from "./db";
import { noteOpenRouterStatus, openRouterGate } from "./openrouter-guard";

import { reportError, reportWarn } from "./report";
// Quality first. Persian is where the models differ most: Gemini hears it far better than Whisper-turbo (which only wins on speed).
// Settings (key/value, no deploy needed): sttOrder = "best" (default) | "fast" (Groq turbo first); sttModel = the OpenRouter audio model.
const OPENROUTER_BEST_MODEL = "google/gemini-2.5-pro";
const OPENROUTER_FALLBACK_MODEL = "google/gemini-2.5-flash";
const OPENROUTER_PRICE: Record<string, [number, number]> = { "google/gemini-2.5-pro": [1.25, 10], "google/gemini-2.5-flash": [0.3, 2.5] }; // USD per million tokens (in, out)
const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_FAST_MODEL = "whisper-large-v3-turbo";
const GROQ_BEST_MODEL = "whisper-large-v3"; // the full model: slower than turbo, clearly more accurate

// Per-fetch timeouts. Without these the upstream can stall the whole
// serverless invocation (we've seen voices "freeze mid-processing" when
// either Telegram's file CDN or the STT provider gets slow).
const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 15_000;
const STT_API_TIMEOUT_MS = 25_000;
const STT_PRO_TIMEOUT_MS = 55_000; // the strongest model takes longer on a long voice note

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
      throw new Error(`timeout after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export function sttConfigured(): boolean {
  return Boolean(config.openrouterApiKey || config.groqApiKey);
}

function mimeToFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("m4a") || m.includes("mp4")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  return "ogg";
}

// Groq answers 400 "unsupported_audio_format" by file extension, and Telegram names voice notes "*.oga".
const GROQ_EXTS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "opus", "wav", "webm"]);
export function groqFileName(name: string, mime: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (GROQ_EXTS.has(ext)) return name;
  const fmt = mimeToFormat(mime);
  return `audio.${fmt === "aac" ? "m4a" : fmt}`;
}

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ data: Uint8Array; mime: string; name: string }> {
  const infoRes = await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
    {},
    TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  );
  if (!infoRes.ok) {
    throw new Error(`getFile ${infoRes.status}: ${await infoRes.text()}`);
  }
  const info = (await infoRes.json()) as {
    ok: boolean;
    result?: { file_path?: string };
    description?: string;
  };
  const filePath = info.result?.file_path;
  if (!info.ok || !filePath) {
    throw new Error(`getFile failed: ${info.description ?? "no file_path"}`);
  }
  const fileRes = await fetchWithTimeout(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
    {},
    TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  );
  if (!fileRes.ok) {
    throw new Error(`download ${fileRes.status}`);
  }
  const mime = fileRes.headers.get("content-type") ?? "application/octet-stream";
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  const name = filePath.split("/").pop() ?? "audio.ogg";
  return { data: buf, mime, name };
}

type TranscribeArgs = {
  botToken: string;
  fileId: string;
  language?: string;
  chatId?: number | null;
  businessConnectionId?: string | null;
};

export async function transcribeAudio(
  args: TranscribeArgs,
): Promise<{ text: string; durationSeconds?: number; provider: string }> {
  const errors: string[] = [];
  const s = await getAllSettings().catch(() => ({} as Record<string, string>));
  const fast = s.sttOrder === "fast";
  const orModel = (s.sttModel ?? "").trim() || OPENROUTER_BEST_MODEL;

  // Order of attempts: best → (best Gemini, lighter Gemini, full Whisper); fast → (Whisper turbo, then Gemini).
  const steps: Array<[string, () => Promise<{ text: string; durationSeconds?: number; provider: string }>]> = [];
  if (fast) {
    if (config.groqApiKey) steps.push(["Groq", () => transcribeViaGroq(args, GROQ_FAST_MODEL)]);
    if (config.openrouterApiKey) steps.push(["OpenRouter", () => transcribeViaOpenRouter(args, orModel)]);
  } else {
    if (config.openrouterApiKey) {
      steps.push([`OpenRouter ${orModel}`, () => transcribeViaOpenRouter(args, orModel)]);
      if (orModel !== OPENROUTER_FALLBACK_MODEL) steps.push([`OpenRouter ${OPENROUTER_FALLBACK_MODEL}`, () => transcribeViaOpenRouter(args, OPENROUTER_FALLBACK_MODEL)]);
    }
    if (config.groqApiKey) steps.push(["Groq", () => transcribeViaGroq(args, GROQ_BEST_MODEL)]);
  }
  for (const [name, run] of steps) {
    try {
      return await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${msg}`);
      reportWarn("stt", `[stt] ${name} failed:`, msg);
    }
  }

  if (errors.length > 0) throw new Error(errors.join(" | "));
  throw new Error("No STT provider configured");
}

async function transcribeViaOpenRouter(
  args: TranscribeArgs,
  model: string,
): Promise<{ text: string; provider: string }> {
  const { data, mime } = await downloadTelegramFile(args.botToken, args.fileId);
  const base64 = Buffer.from(data).toString("base64");
  const format = mimeToFormat(mime);

  // A bare ISO code ("fa") is a weak hint — models often answer in
  // English or transliterate into Latin script. Name the language and
  // demand its native script.
  const LANG_NAMES: Record<string, string> = {
    fa: "Persian/Farsi (فارسی), written in Persian script",
    ar: "Arabic (العربية), written in Arabic script",
    en: "English",
    tr: "Turkish",
  };
  const langHint = args.language
    ? ` The audio is in ${LANG_NAMES[args.language] ?? args.language}. Write the transcript in that language and its native script — never translate or transliterate it.`
    : "";
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Transcribe this audio into plain text, word for word. Do not summarise, shorten, correct or skip anything; keep names, numbers and every sentence, and add normal punctuation." +
              langHint +
              " Output ONLY the transcript, in the same language as the audio. No commentary, no labels, no quotes, no markdown.",
          },
          {
            type: "input_audio",
            input_audio: { data: base64, format },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 8000, // room for the pro model's own thinking tokens as well as the transcript
  };

  await openRouterGate();
  const res = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "Content-Type": "application/json",
        "X-Title": config.openrouterAppName,
      },
      body: JSON.stringify(body),
    },
    model.includes("pro") ? STT_PRO_TIMEOUT_MS : STT_API_TIMEOUT_MS,
  );

  await noteOpenRouterStatus(res.status);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? "openrouter error");

  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("empty transcript");

  if (json.usage) {
    const pt = json.usage.prompt_tokens ?? 0;
    const ct = json.usage.completion_tokens ?? 0;
    const [inP, outP] = OPENROUTER_PRICE[model] ?? OPENROUTER_PRICE[OPENROUTER_FALLBACK_MODEL]!;
    const cost = (pt / 1_000_000) * inP + (ct / 1_000_000) * outP;
    await recordAiUsage({
      chatId: args.chatId ?? null,
      businessConnectionId: args.businessConnectionId ?? null,
      model,
      purpose: "transcribe",
      promptTokens: pt,
      completionTokens: ct,
      totalTokens: json.usage.total_tokens ?? pt + ct,
      costUsd: cost,
    }).catch((err) => reportError("stt", "[stt] usage record failed:", err));
  }

  return { text, provider: `openrouter:${model.replace(/^google\//, "")}` };
}

async function transcribeViaGroq(
  args: TranscribeArgs,
  model: string,
): Promise<{ text: string; durationSeconds?: number; provider: string }> {
  if (!config.groqApiKey) throw new Error("not configured");
  const { data, mime, name } = await downloadTelegramFile(
    args.botToken,
    args.fileId,
  );

  const form = new FormData();
  form.append("file", new Blob([data as BlobPart], { type: mime }), groqFileName(name, mime));
  form.append("model", model);
  form.append("response_format", "verbose_json");
  if (args.language) {
    form.append("language", args.language);
    // Whisper uses `prompt` as a style/script primer. On short or noisy
    // clips (video notes especially) the language flag alone can still
    // yield Latin transliteration, so prime it with native-script text.
    const PRIMER: Record<string, string> = {
      fa: "این یک گفتگوی فارسی است. متن را با خط فارسی بنویس.",
      ar: "هذه محادثة بالعربية. اكتب النص بالحروف العربية.",
    };
    const primer = PRIMER[args.language];
    if (primer) form.append("prompt", primer);
  }

  const res = await fetchWithTimeout(
    GROQ_TRANSCRIBE_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      body: form,
    },
    STT_API_TIMEOUT_MS,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { text?: string; duration?: number };
  const text = (json.text ?? "").trim();
  const seconds = json.duration ?? 0;

  const costUsd = (seconds / 3600) * 0.04;
  await recordAiUsage({
    chatId: args.chatId ?? null,
    businessConnectionId: args.businessConnectionId ?? null,
    model,
    purpose: "transcribe",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd,
  }).catch((err) => reportError("stt", "[stt] usage record failed:", err));

  return { text, durationSeconds: seconds, provider: `groq:${model}` };
}
