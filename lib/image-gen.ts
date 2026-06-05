import { Buffer } from "node:buffer";
import { config } from "./config";
import { recordAiUsage } from "./db";

// Gemini 2.5 Flash Image ("nano-banana 2") on OpenRouter. Takes a
// reference photo + a text prompt and returns a generated image.
// Pricing: ~$0.04 per image (~$30 / 1000 generations).
const IMAGE_MODEL = "google/gemini-2.5-flash-image-preview";
const IMAGE_API_TIMEOUT_MS = 60_000;
const COST_PER_IMAGE_USD = 0.04;

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
      throw new Error(`image-gen timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// Phrases that suggest the user is asking for a photo of the operator.
// Mix of Persian + English forms — keeps detection fast (no extra LLM
// call) and obvious to debug.
const PHOTO_REQUEST_PATTERNS: RegExp[] = [
  /عکس(ت|ی? از خودت|ی? از خودتون|ی? از خودش)/iu,
  /یه عکس بفرست/iu,
  /سلفی/iu,
  /\bsend (me )?(a )?(your |selfie|photo|picture|pic)/i,
  /\bselfie\b/i,
  /\byour photo\b/i,
  /\ba (photo|picture|pic) of you\b/i,
  /\bshow me you\b/i,
];

export function looksLikePhotoRequest(text: string): boolean {
  if (!text) return false;
  return PHOTO_REQUEST_PATTERNS.some((rx) => rx.test(text));
}

export type GeneratedImage = {
  data: Uint8Array;
  mime: string;
};

// Calls Gemini's image-gen model with the operator's reference photo
// + a short prompt describing what to render. Returns raw bytes ready
// to pass into grammy's InputFile.
export async function generatePersonalPhoto(args: {
  referenceUrl: string;
  userRequest: string;
  chatId?: number | null;
  businessConnectionId?: string | null;
}): Promise<GeneratedImage> {
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }
  if (!args.referenceUrl) {
    throw new Error("owner reference photo URL not set");
  }

  const prompt = [
    "Generate one new realistic photo of the SAME PERSON shown in the reference image.",
    "Keep their face, hair, body type, ethnicity and approximate age IDENTICAL to the reference — this must be visibly the same person.",
    "Match the request below for pose, setting, mood and outfit.",
    `Request: ${args.userRequest.slice(0, 400)}`,
    "Output ONLY the image. No text, no captions, no watermarks, no signatures.",
  ].join("\n");

  const body = {
    model: IMAGE_MODEL,
    modalities: ["image", "text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: args.referenceUrl } },
        ],
      },
    ],
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": config.openrouterAppName,
  };
  if (config.openrouterAppUrl) headers["HTTP-Referer"] = config.openrouterAppUrl;

  const res = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    { method: "POST", headers, body: JSON.stringify(body) },
    IMAGE_API_TIMEOUT_MS,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`image-gen ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        images?: Array<{ image_url?: { url?: string } | string }>;
        content?: string;
      };
    }>;
    error?: { message?: string };
    usage?: { total_tokens?: number };
  };
  if (json.error) throw new Error(json.error.message ?? "image-gen error");

  // OpenRouter's response for Gemini image models tucks the generated
  // image into choices[0].message.images[0].image_url.url as a data URL.
  const imagesField = json.choices?.[0]?.message?.images;
  const first = imagesField?.[0];
  const dataUrl =
    typeof first === "string"
      ? first
      : (first?.image_url as { url?: string } | undefined)?.url ??
        (typeof first?.image_url === "string" ? first.image_url : undefined);
  if (!dataUrl) {
    throw new Error("image-gen response had no image");
  }
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("image-gen response wasn't a data URL");
  const mime = m[1] ?? "image/png";
  const b64 = m[2] ?? "";
  const data = new Uint8Array(Buffer.from(b64, "base64"));

  // Log cost — image gen is flat-priced per image rather than
  // token-based, so the token columns stay zero and cost goes into
  // costUsd directly.
  await recordAiUsage({
    chatId: args.chatId ?? null,
    businessConnectionId: args.businessConnectionId ?? null,
    model: IMAGE_MODEL,
    purpose: "generate_photo",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: COST_PER_IMAGE_USD,
  }).catch((err) => console.error("[image-gen] usage record failed:", err));

  return { data, mime };
}
