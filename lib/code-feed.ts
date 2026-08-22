// Extraction of verification codes from SMS-style channel posts, plus
// the shared shape of a token-gated code feed.
//
// The channels these feeds read carry a lot of marketing SMS alongside
// the real OTPs ("۶۰٪تخفیف …", "لغو11", invoice amounts like
// "704,000,000 ریال"). Matching bare digits would surface all of that,
// so a message only counts as carrying a code when a code-ish KEYWORD
// appears near a short digit run.

const CODE_WORDS = [
  "code", "otp", "pin", "verification", "verify", "password", "passcode",
  "کد", "رمز", "تایید", "تأیید", "احراز", "پویا", "یکبار", "یک‌بار",
];

// Persian/Arabic-Indic digits → ASCII so one regex handles every form.
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

// A code is 4–8 digits that is NOT part of a longer number (phone
// numbers, invoice ids, prices) — hence the digit-boundary guards.
// A code is 4–8 digits that is NOT part of a longer number (phone
// numbers, invoice ids, prices) — hence the digit-boundary guards.
const CODE_RE = /(?<![\d۰-۹٠-٩])(\d{4,8})(?![\d۰-۹٠-٩])/g;

// Keyword hits must be whole words. Persian has no spaces inside many
// compounds, and a naive substring test matched "کد" inside "بانکداری",
// which turned a bank login notice into a "code" message.
const KEYWORD_RE = new RegExp(
  `(?<!\\p{L})(${CODE_WORDS.join("|")})(?!\\p{L})`,
  "giu",
);

function hasKeyword(s: string): boolean {
  KEYWORD_RE.lastIndex = 0;
  return KEYWORD_RE.test(s);
}

// URLs carry long digit runs that look like codes (".../otp/30625419").
// Blank them out before scanning rather than trying to exclude them later.
function stripUrls(s: string): string {
  return s.replace(/https?:\/\/\S+|\b[\w-]+\.(ir|com|net|org|co)\/\S*/gi, " ");
}

// 1405/05/30 or 2026-08-21 — a date, never a verification code.
function looksLikeDate(text: string, at: number, len: number): boolean {
  const before = text.slice(Math.max(0, at - 1), at);
  const after = text.slice(at + len, at + len + 1);
  return /[/\-.]/.test(before) || /[/\-.]/.test(after);
}

export function extractCodes(raw: string): string[] {
  if (!raw) return [];
  const text = stripUrls(normalizeDigits(raw));
  if (!hasKeyword(text)) return [];
  const out: string[] = [];
  for (const m of text.matchAll(CODE_RE)) {
    const code = m[1]!;
    const at = m.index ?? 0;
    if (looksLikeDate(text, at, code.length)) continue;
    // A 4-digit Gregorian or Persian year is a date, not a code.
    if (/^(1[34]\d{2}|19\d{2}|20\d{2})$/.test(code)) continue;
    // Keep only digits sitting near a code word, so a marketing SMS that
    // merely mentions "کد" elsewhere can't donate its price or year.
    const around = text.slice(Math.max(0, at - 45), at + code.length + 12);
    if (!hasKeyword(around)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export function hasCode(text: string): boolean {
  return extractCodes(text).length > 0;
}

export type FeedFormat = "json" | "text" | "codes";

export function renderFeed(
  format: FeedFormat,
  items: Array<{ at: string; text: string; codes: string[] }>,
): { body: string; contentType: string } {
  if (format === "codes") {
    return {
      body: items.flatMap((i) => i.codes).join("\n"),
      contentType: "text/plain; charset=utf-8",
    };
  }
  if (format === "text") {
    return {
      body: items
        .map((i) => `${i.at}  ${i.codes.join(", ")}\n${i.text}`)
        .join("\n\n"),
      contentType: "text/plain; charset=utf-8",
    };
  }
  return {
    body: JSON.stringify({ count: items.length, items }, null, 2),
    contentType: "application/json; charset=utf-8",
  };
}
