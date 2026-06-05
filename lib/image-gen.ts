import { Buffer } from "node:buffer";
import { config } from "./config";
import { getOwnerAsset, recordAiUsage } from "./db";

// Gemini 2.5 Flash Image ("nano-banana 2") on OpenRouter. Takes a
// reference photo + a text prompt and returns a generated image.
// Pricing: ~$0.04 per image (~$30 / 1000 generations).
// Model can be overridden via env so we don't have to redeploy when
// OpenRouter renames the preview slug.
const IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-image-preview";
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

// Photo-request detection. We need BOTH a photo-noun AND a request-verb
// (or a clearly "your photo" pattern) — otherwise sentences like
// "این عکس قشنگه" (this photo is pretty) would trigger a wasted
// generation. The two-part match keeps false positives down without
// needing an LLM intent call on every message.
const PHOTO_NOUN_RX =
  /(?:عکس[تشمان]?|سلفی|پرتره|پیکچر|\b(?:selfie|photo|picture|pic|portrait|snap|image)\b)/iu;
const REQUEST_VERB_RX =
  /(?:بده|بفرست|بنداز|بگیر|بزن|بزار|بذار|می‌?خوام|میخوام|میشه|می‌شه|داری|نشون|ببینم|می‌بینی|ببین|دارم|ازت|please|send|give|show|share|got|have|let me see)/iu;
const EXPLICIT_PHOTO_OF_YOU_RX =
  /(?:عکس(?:ی? از خود(?:ت|تون|ش))|سلفی|\byour photo\b|\ba (?:photo|picture|pic|selfie) of you\b|\bshow me you(?:rself)?\b|\bpic of you\b|\b\/selfie\b|\b\/photo\b)/iu;

export function looksLikePhotoRequest(text: string): boolean {
  if (!text) return false;
  if (EXPLICIT_PHOTO_OF_YOU_RX.test(text)) return true;
  return PHOTO_NOUN_RX.test(text) && REQUEST_VERB_RX.test(text);
}

export type GeneratedImage = {
  data: Uint8Array;
  mime: string;
};

// Calls Gemini's image-gen model with the operator's reference photo
// + a short prompt describing what to render. Returns raw bytes ready
// to pass into grammy's InputFile.
//
// Reference resolution priority:
//   1. Uploaded blob in owner_assets ('photo') — what the dashboard
//      file picker writes.
//   2. settings.ownerPhotoUrl — public URL fallback for power users
//      who'd rather host it elsewhere.
export async function generatePersonalPhoto(args: {
  referenceUrl: string;
  userRequest: string;
  chatId?: number | null;
  businessConnectionId?: string | null;
}): Promise<GeneratedImage> {
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }
  let referenceImageUrl: string;
  const uploaded = await getOwnerAsset("photo").catch(() => null);
  if (uploaded) {
    const b64 = Buffer.from(uploaded.data).toString("base64");
    referenceImageUrl = `data:${uploaded.mime};base64,${b64}`;
  } else if (args.referenceUrl) {
    referenceImageUrl = args.referenceUrl;
  } else {
    throw new Error("owner reference photo not set (upload one in Settings)");
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
          { type: "image_url", image_url: { url: referenceImageUrl } },
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

  console.log(
    `[image-gen] model=${IMAGE_MODEL} refSource=${
      uploaded ? "uploaded-blob" : "url"
    } refBytes=${uploaded ? uploaded.data.length : "n/a"}`,
  );
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
        images?: Array<{ image_url?: { url?: string } | string } | string>;
        content?: string | Array<{ type?: string; image_url?: { url?: string } | string }>;
      };
    }>;
    error?: { message?: string };
    usage?: { total_tokens?: number };
  };
  if (json.error) throw new Error(json.error.message ?? "image-gen error");

  // OpenRouter's Gemini image responses have shifted shape across
  // versions. We try, in priority order:
  //   choices[0].message.images[0].image_url.url  (current)
  //   choices[0].message.images[0]                (sometimes a raw URL)
  //   choices[0].message.content[].image_url.url  (when modalities is array)
  const msg0 = json.choices?.[0]?.message;
  const imagesField = msg0?.images;
  const first = imagesField?.[0];
  let dataUrl: string | undefined =
    typeof first === "string"
      ? first
      : first
        ? (first.image_url as { url?: string } | undefined)?.url ??
          (typeof first.image_url === "string" ? first.image_url : undefined)
        : undefined;
  if (!dataUrl && Array.isArray(msg0?.content)) {
    for (const part of msg0.content) {
      if (part && typeof part === "object" && part.image_url) {
        const u =
          typeof part.image_url === "string"
            ? part.image_url
            : (part.image_url as { url?: string }).url;
        if (u) {
          dataUrl = u;
          break;
        }
      }
    }
  }
  if (!dataUrl) {
    console.warn(
      `[image-gen] no image in response. shape: ${JSON.stringify(json).slice(0, 600)}`,
    );
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
