import { config } from "./config";
import { recordAiUsage } from "./db";

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

const GROQ_MODEL = "whisper-large-v3-turbo";

export function sttConfigured(): boolean {
  return Boolean(config.groqApiKey);
}

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ data: Uint8Array; mime: string; name: string }> {
  const infoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
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
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!fileRes.ok) {
    throw new Error(`download ${fileRes.status}`);
  }
  const mime = fileRes.headers.get("content-type") ?? "application/octet-stream";
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  const name = filePath.split("/").pop() ?? "audio.ogg";
  return { data: buf, mime, name };
}

export async function transcribeAudio(args: {
  botToken: string;
  fileId: string;
  language?: string;
  chatId?: number | null;
  businessConnectionId?: string | null;
}): Promise<{ text: string; durationSeconds?: number }> {
  if (!sttConfigured()) {
    throw new Error(
      "Speech-to-text is not configured. Set GROQ_API_KEY in environment.",
    );
  }
  const { data, mime, name } = await downloadTelegramFile(
    args.botToken,
    args.fileId,
  );

  const form = new FormData();
  form.append(
    "file",
    new Blob([data as BlobPart], { type: mime }),
    name,
  );
  form.append("model", GROQ_MODEL);
  form.append("response_format", "verbose_json");
  if (args.language) form.append("language", args.language);

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq STT ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    text?: string;
    duration?: number;
  };
  const text = (json.text ?? "").trim();
  const seconds = json.duration ?? 0;

  // Groq Whisper turbo: $0.04 per audio-hour as of 2026-05.
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

  return { text, durationSeconds: seconds };
}
