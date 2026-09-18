// Lexical "same kind of SMS" scoring shared by the accept and block
// feedback paths (lib/sms-router.ts). Pure; tested in tests/sms.test.ts.
//
// The operator's ✅ used to be an exact-signature switch: one changed
// word and the same bank notice came back with buttons. Jaccard over
// normalised tokens (digit runs masked, so codes/amounts/dates do not
// count) gives a cheap "how alike is this to what they already
// decided" score. Clear cases are settled without a model call; the
// grey zone goes to the small gate model with only the nearest
// examples in the prompt instead of the first 30 rows.

export function smsTokens(body: string): Set<string> {
  const s = body
    .toLowerCase()
    .replace(/[‌]+/g, " ")
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/https?:\/\/\S+/g, " urltoken ")
    .replace(/\d{3,}/g, " numtoken ")
    .replace(/[\p{P}\p{S}]+/gu, " ");
  const out = new Set<string>();
  for (const t of s.split(/\s+/)) {
    if (t.length >= 2) out.add(t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type SimilarExample<T> = { example: T; score: number; sameSender: boolean };

/**
 * Rank `examples` by similarity to `body`. A matching sender (when both
 * sides know it) adds a small bonus so "same bank, slightly different
 * wording" outranks "different sender, similar wording".
 */
export function rankSimilar<T extends { text: string; sender?: string | null }>(
  body: string,
  sender: string | null | undefined,
  examples: T[],
  opts?: { min?: number; limit?: number },
): SimilarExample<T>[] {
  const toks = smsTokens(body);
  const min = opts?.min ?? 0.2;
  const limit = opts?.limit ?? 8;
  const s = (sender ?? "").trim().toLowerCase();
  const scored: SimilarExample<T>[] = [];
  for (const ex of examples) {
    const base = jaccard(toks, smsTokens(ex.text));
    const exS = (ex.sender ?? "").trim().toLowerCase();
    const sameSender = Boolean(s && exS && s === exS);
    const score = Math.min(1, base + (sameSender ? 0.1 : 0));
    if (score >= min) scored.push({ example: ex, score, sameSender });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit);
}

/** Similarity high enough to decide without asking a model. */
export const ACCEPT_SURE = 0.6;
export const BLOCK_SURE = 0.7;
/** Below this nothing is even worth asking the model about. */
export const CANDIDATE_MIN = 0.2;
