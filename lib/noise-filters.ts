// Two cheap, deterministic guards against the flood that made the owner's lists unusable (≈6,900 "reminders" with
// nothing ever completed, ≈6 % of all messages flagged urgent): automated messages are not tasks, and the same
// alert repeated within hours is one alert, not ten.

const NOISE_TITLE = /کد\s*(ورود|تأیید|تایید|دسترسی|فعال‌?سازی|یکبار|یک‌بار)|رمز\s*(عبور|یکبار|یک‌بار|پویا)|احراز\s*هویت|هشدار\s*ورود|ورود\s*به\s*(حساب|سامانه)|otp|verification\s*code|one[- ]time|2fa|mfa|multi-?factor|security\s*alert|login\s*(code|alert)/i;
const NOISE_SOURCE = /\b\d{4,8}\b[^\n]{0,40}(کد|code)|(کد|code)[^\n]{0,40}\b\d{4,8}\b|CrashLoopBackOff|Jaryan alert/i;

/** True when an auto-extracted item is really an automated notice (login code, security alert, infra alarm). */
export function isAutomatedNoise(item: { title: string; sourceText?: string | null }): boolean {
  return NOISE_TITLE.test(item.title) || NOISE_SOURCE.test(item.sourceText ?? "");
}

/** Same task seen again in the same chat: compare titles without digits/punctuation/spacing. */
export function titleKey(title: string): string {
  return title.normalize("NFKD").toLowerCase().replace(/[ً-ٟ̀-ͯ]/g, "").replace(/[^\p{L}]+/gu, "");
}

const seen = new Map<string, number>();
const REPEAT_MS = 3 * 60 * 60_000;

/** First call for a given (chat, text) returns false and remembers it; repeats within 3 h return true. Digits are ignored so "alert (new) 12:01" and "… 12:07" count as the same. */
export function isRepeatAlert(chatId: number, text: string, now = Date.now()): boolean {
  const key = `${chatId}|${text.replace(/\d+/g, "N").replace(/\s+/g, " ").trim().slice(0, 240)}`;
  const at = seen.get(key);
  if (at && now - at < REPEAT_MS) return true;
  seen.set(key, now);
  if (seen.size > 2000) for (const [k, t] of seen) if (now - t > REPEAT_MS) seen.delete(k);
  return false;
}
