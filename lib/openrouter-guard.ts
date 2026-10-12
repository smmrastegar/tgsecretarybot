import { getAllSettings, setSetting } from "@/lib/db";
import { getSettings } from "@/lib/settings";

// OpenRouter answers 402 once the prepaid credit is gone. Every AI feature (message classification,
// rules, SMS routing, transcription fallback) then failed on every call — thousands of identical errors
// a week and slower replies — and nobody was told. This is a small circuit breaker:
//   • a 402 opens it for 20 minutes: calls fail instantly instead of hitting the network;
//   • after 20 minutes one call is let through (a top-up closes it again by itself);
//   • the owner gets ONE Telegram message per 6 hours while it is open.
const OPEN_FOR_MS = 20 * 60_000;
const ALERT_EVERY_MS = 6 * 60 * 60_000;
let openUntil = 0;
let loaded = false;

export class OpenRouterCircuitOpen extends Error {
  constructor() { super("OpenRouter credits exhausted (402) — AI calls paused; top up at openrouter.ai/settings/credits"); }
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  openUntil = Number((await getAllSettings().catch(() => ({} as Record<string, string>))).openrouterOutUntil || 0);
}

/** Call before an OpenRouter request; throws while the credit is known to be exhausted. */
export async function openRouterGate(): Promise<void> {
  await load();
  if (openUntil > Date.now()) throw new OpenRouterCircuitOpen();
}

/** Call with the HTTP status of every OpenRouter answer. */
export async function noteOpenRouterStatus(status: number): Promise<void> {
  if (status !== 402) return;
  openUntil = Date.now() + OPEN_FOR_MS;
  await setSetting("openrouterOutUntil", String(openUntil)).catch(() => {});
  try {
    const s = await getAllSettings();
    if (Date.now() - Number(s.openrouterAlertAt || 0) < ALERT_EVERY_MS) return;
    await setSetting("openrouterAlertAt", String(Date.now()));
    const chat = (await getSettings().catch(() => null))?.ownerNotifyChatId;
    if (!chat) return;
    const { getBot } = await import("@/lib/bot");
    await getBot().api.sendMessage(chat, "⚠️ اعتبار OpenRouter تمام شده (خطای 402).\nتا شارژ نشود طبقه‌بندی پیام‌ها، قانون‌ها، خلاصه‌ها و مسیریابی پیامک کار نمی‌کنند.\nشارژ: openrouter.ai/settings/credits\n(تبدیل ویس با Groq جداست و کار می‌کند؛ این پیام ۶ ساعت یک‌بار تکرار می‌شود.)");
  } catch { /* the alert is best-effort */ }
}
