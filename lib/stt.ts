import { Buffer } from "node:buffer";
import { config } from "./config";
import { recordAiUsage } from "./db";

const OPENROUTER_STT_MODEL = "google/gemini-2.5-flash";
const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

// Per-fetch timeouts. Without these the upstream can stall the whole
// serverless invocation (we've seen voices "freeze mid-processing" when
// either Telegram's file CDN or the STT provider gets slow).
const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 15_000;
const STT_API_TIMEOUT_MS = 25_000;

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

  if (config.groqApiKey) {
    try {
      return await transcribeViaGroq(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Groq: ${msg}`);
      console.warn("[stt] Groq failed:", msg);
    }
  }
  if (config.openrouterApiKey) {
    try {
      return await transcribeViaOpenRouter(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`OpenRouter: ${msg}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join(" | "));
  throw new Error("No STT provider configured");
}

async function transcribeViaOpenRouter(
  args: TranscribeArgs,
): Promise<{ text: string; provider: string }> {
  const { data, mime } = await downloadTelegramFile(args.botToken, args.fileId);
  const base64 = Buffer.from(data).toString("base64");
  const format = mimeToFormat(mime);

  const langHint = args.language ? ` The speaker is using ${args.language}.` : "";
  const body = {
    model: OPENROUTER_STT_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Transcribe this audio into plain text, verbatim." +
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
    max_tokens: 4000,
  };

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
    STT_API_TIMEOUT_MS,
  );

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
    const cost = (pt / 1_000_000) * 0.3 + (ct / 1_000_000) * 2.5;
    await recordAiUsage({
      chatId: args.chatId ?? null,
      businessConnectionId: args.businessConnectionId ?? null,
      model: OPENROUTER_STT_MODEL,
      purpose: "transcribe",
      promptTokens: pt,
      completionTokens: ct,
      totalTokens: json.usage.total_tokens ?? pt + ct,
      costUsd: cost,
    }).catch((err) => console.error("[stt] usage record failed:", err));
  }

  return { text, provider: "openrouter:gemini-2.5-flash" };
}

async function transcribeViaGroq(
  args: TranscribeArgs,
): Promise<{ text: string; durationSeconds?: number; provider: string }> {
  if (!config.groqApiKey) throw new Error("not configured");
  const { data, mime, name } = await downloadTelegramFile(
    args.botToken,
    args.fileId,
  );

  const form = new FormData();
  form.append("file", new Blob([data as BlobPart], { type: mime }), name);
  form.append("model", GROQ_MODEL);
  form.append("response_format", "verbose_json");
  if (args.language) form.append("language", args.language);

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
    model: GROQ_MODEL,
    purpose: "transcribe",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd,
  }).catch((err) => console.error("[stt] usage record failed:", err));

  return { text, durationSeconds: seconds, provider: "groq:whisper-turbo" };
}
