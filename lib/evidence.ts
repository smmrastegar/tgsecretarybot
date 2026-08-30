// Quoted messages shown as evidence under a task.
//
// These used to be bare strings, so a task detail showed three quotes in
// a row with no way to tell who said what — the reader saw a conversation
// with the speakers stripped out. The speaker was available all along on
// the source message and was simply being dropped when the quote was cut.
//
// Analytics results are cached, so anything reading evidence has to cope
// with rows written before this existed. normalizeEvidence accepts both
// shapes and always returns the new one.

export type TaskEvidence = { speaker: string | null; text: string };

export function normalizeEvidence(value: unknown): TaskEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: TaskEvidence[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      const t = raw.trim();
      if (t) out.push({ speaker: null, text: t });
      continue;
    }
    if (raw && typeof raw === "object") {
      const o = raw as { speaker?: unknown; text?: unknown };
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text) continue;
      const speaker =
        typeof o.speaker === "string" && o.speaker.trim()
          ? o.speaker.trim()
          : null;
      out.push({ speaker, text });
    }
  }
  return out;
}

/** Plain-text rendering for places that can't show structure (Telegram). */
export function evidenceLine(e: TaskEvidence): string {
  return e.speaker ? `${e.speaker}: «${e.text}»` : `«${e.text}»`;
}
