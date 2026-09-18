// Deterministic guards for the note watchlist, applied to every match
// the LLM proposes. The classifier prompt already says "be
// conservative", and it still returns matches whose own reason says
// "refers to a different person". These guards are the part that
// does not drift. Pure functions, unit-tested in tests/watchlist.test.ts.
//
// The operator's feedback (🚩 گزارش خطا / ✅ تأیید on the notice) feeds
// back in here: a quote the operator rejected becomes a phrase that
// vetoes future matches for the same concept unless the FULL concept
// name is present. That is the loop that was missing — reports were
// stored and never read.

export function normalizeForWatchMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/‌/g, " ")
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[ة]/g, "ه")
    .replace(/[إأآ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ی")
    .replace(/[ء]/g, "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  return normalizeForWatchMatch(s)
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr: number[] = new Array(n + 1);
    curr[0] = i;
    const ai = a.charAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[n]!;
}

// Short Persian words are one letter apart from each other all the
// time ("بالزن" / "بالان"), so no fuzz below 6 chars; one edit for
// 6-8 ("گرشاسبی" ↔ "گرشاسپی"); two only for long Latin names.
function maxFuzzy(token: string): number {
  if (token.length >= 9) return 2;
  if (token.length >= 6) return 1;
  return 0;
}

function tokenEquals(hay: string, needle: string): boolean {
  if (hay === needle) return true;
  const budget = maxFuzzy(needle);
  if (budget === 0) return false;
  if (Math.abs(hay.length - needle.length) <= budget && levenshtein(hay, needle) <= budget) {
    return true;
  }
  // A long needle may sit inside a compound token ("امیربالافشان"),
  // but only EXACTLY: a fuzzy window let "امیربال" match inside
  // "امیرعبدالرحیمی" and "امیرشاه", which is most of the noise.
  if (needle.length >= 6 && hay.length > needle.length && hay.includes(needle)) return true;
  return false;
}

/**
 * Index in `hayTokens` where `phrase` appears as a CONTIGUOUS run of
 * tokens (each fuzzy-equal), or -1. The old check accepted the tokens
 * scattered anywhere in the message, which is how "امیر … بال" in a
 * long report matched "امیر بال".
 */
export function findPhrase(phrase: string, hayTokens: string[]): number {
  const needle = tokenize(phrase);
  if (needle.length === 0) return -1;
  outer: for (let i = 0; i + needle.length <= hayTokens.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (!tokenEquals(hayTokens[i + j]!, needle[j]!)) continue outer;
    }
    return i;
  }
  return -1;
}

export function phrasePresent(phrase: string, message: string): boolean {
  return findPhrase(phrase, tokenize(message)) >= 0;
}

/** Which of concept/aliases appear contiguously; used by the validator. */
export function anchorsPresent(args: {
  message: string;
  concept: string;
  aliases: string[];
}): { concept: boolean; aliases: string[] } {
  const toks = tokenize(args.message);
  return {
    concept: findPhrase(args.concept, toks) >= 0,
    aliases: args.aliases.filter((a) => findPhrase(a, toks) >= 0),
  };
}

// Tokens that follow a first name without making it "someone else":
// vocatives, verbs, particles. Anything else that looks like a word
// after a bare first name is read as a surname.
const NOT_A_SURNAME = new Set(
  [
    "جان", "جون", "جونم", "عزیز", "عزیزم", "آقا", "خانم", "خانوم", "داداش", "بابا",
    "بیا", "بیاد", "برو", "کجاست", "کجایی", "کجا", "چطوره", "چطوری", "خوبه", "خوبی",
    "رو", "را", "و", "که", "از", "به", "در", "با", "هم", "یا", "تا", "چی", "چه", "این", "اون",
    "زنگ", "زد", "گفت", "میگه", "گفته", "اومد", "رفت", "هست", "است", "نیست", "بود", "میاد",
    "خونه", "خونست", "شام", "ناهار", "امروز", "فردا", "دیروز", "الان", "هنوز", "دیگه", "هم",
    "the", "is", "was", "and", "or", "to", "in", "at", "on", "said", "says", "came", "went",
    "new", "album", "song", "concert", "live", "music", "band", "feat", "ft", "x",
  ].map((w) => normalizeForWatchMatch(w)),
);

/**
 * A single-word alias that is the concept's first name ("آرمان" for
 * "آرمان گرشاسبی") followed by a surname-looking token is a different
 * person: "آرمان مهدی‌زاده", "آرمان درویش". Returns the offending
 * phrase or null.
 */
export function nameCollision(args: {
  message: string;
  concept: string;
  aliases: string[];
}): string | null {
  const conceptToks = tokenize(args.concept);
  if (conceptToks.length < 2) return null;
  const conceptSet = new Set(conceptToks);
  const aliasToks = new Set(args.aliases.flatMap((a) => tokenize(a)));
  const firstNames = new Set(
    args.aliases
      .map((a) => tokenize(a))
      .filter((t) => t.length === 1 && tokenEquals(t[0]!, conceptToks[0]!))
      .map((t) => t[0]!),
  );
  firstNames.add(conceptToks[0]!);
  const toks = tokenize(args.message);
  // If the full concept is present anywhere, a collision elsewhere in
  // the same message does not veto it.
  if (findPhrase(args.concept, toks) >= 0) return null;
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i]!;
    if (![...firstNames].some((f) => tokenEquals(t, f))) continue;
    const next = toks[i + 1]!;
    if (NOT_A_SURNAME.has(next)) continue;
    if (next.length < 3) continue;
    if (conceptSet.has(next) || aliasToks.has(next)) continue;
    if ([...conceptSet].some((c) => tokenEquals(next, c))) continue;
    if (/^\d+$/.test(next)) continue;
    return `${t} ${next}`;
  }
  return null;
}

/**
 * The operator flagged these quotes as wrong for this concept. If the
 * message contains one of them (contiguously) and NOT the full
 * concept, the match is vetoed. Returns the matching rejected quote.
 */
export function rejectedPhraseHit(args: {
  message: string;
  concept: string;
  aliases: string[];
  rejectedQuotes: string[];
}): string | null {
  const toks = tokenize(args.message);
  if (findPhrase(args.concept, toks) >= 0) return null;
  const anchorToks = new Set([...tokenize(args.concept), ...args.aliases.flatMap((a) => tokenize(a))]);
  for (const q of args.rejectedQuotes) {
    const qt = tokenize(q);
    if (qt.length === 0) continue;
    // A one-word rejected quote that is just the bare alias ("آرمان")
    // means "the bare first name is not enough": handled by the
    // bare-alias rule, not here — otherwise it would veto everything.
    if (qt.length === 1 && anchorToks.has(qt[0]!)) continue;
    if (qt.length > 12) continue; // long quotes are message excerpts, not names
    if (findPhrase(q, toks) >= 0) return q;
  }
  return null;
}

/**
 * The LLM sometimes emits a match whose own reason says it is not one
 * ("نام امیر در پیام وجود دارد اما به شخص دیگری اشاره دارد"). Take it
 * at its word.
 */
const SELF_NEGATING = /(شخص|فرد|نفر) (دیگر|متفاوت)|شخص دیگری|فرد دیگری|different person|someone else|فقط (نام|اسم) |شباهت (صرف|ظاهری)|صرفاً شباهت|بخشی از نام|only part of|partial name|تطابق (قطعی )?نیست|نیست\.?$|not a match|no match/i;

export function selfNegatingReason(reason: string): boolean {
  return SELF_NEGATING.test(reason.trim());
}

/**
 * Bare first-name aliases ("آرمان", "Arman") were a source of most of
 * the noise. They count only when the operator has confirmed at least
 * one match on that bare alias before, or the message has the concept
 * / a multi-word alias. `bareAlias` is the alias the LLM anchored on.
 */
export function isBareFirstNameAlias(alias: string | null, concept: string): boolean {
  if (!alias) return false;
  const a = tokenize(alias);
  const c = tokenize(concept);
  return a.length === 1 && c.length >= 2 && tokenEquals(a[0]!, c[0]!);
}
