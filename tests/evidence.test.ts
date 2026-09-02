import { describe, expect, it } from "vitest";
import { evidenceLine, normalizeEvidence } from "../lib/evidence";

// Analytics results are cached, so the normaliser must accept both the
// old bare-string shape and the new {speaker, text} shape.

describe("normalizeEvidence", () => {
  it("wraps legacy strings with a null speaker", () => {
    expect(normalizeEvidence(["سلام", "  ", "من مریض شدم"])).toEqual([
      { speaker: null, text: "سلام" },
      { speaker: null, text: "من مریض شدم" },
    ]);
  });

  it("passes through structured evidence and trims", () => {
    expect(normalizeEvidence([{ speaker: " Zahra ", text: " کمک می‌کنم " }])).toEqual([
      { speaker: "Zahra", text: "کمک می‌کنم" },
    ]);
  });

  it("treats an empty speaker as unknown", () => {
    expect(normalizeEvidence([{ speaker: "", text: "متن" }])).toEqual([
      { speaker: null, text: "متن" },
    ]);
  });

  it("drops junk and empty text", () => {
    expect(normalizeEvidence([null, 42, {}, { text: "" }, { speaker: "x" }])).toEqual([]);
  });

  it("returns [] for a non-array", () => {
    expect(normalizeEvidence("nope")).toEqual([]);
    expect(normalizeEvidence(undefined)).toEqual([]);
  });

  it("handles a mixed array", () => {
    expect(normalizeEvidence(["a", { speaker: "B", text: "b" }])).toEqual([
      { speaker: null, text: "a" },
      { speaker: "B", text: "b" },
    ]);
  });
});

describe("evidenceLine", () => {
  it("prefixes the speaker when known", () => {
    expect(evidenceLine({ speaker: "Alirezaw", text: "سلام" })).toBe("Alirezaw: «سلام»");
  });
  it("omits the prefix when unknown", () => {
    expect(evidenceLine({ speaker: null, text: "سلام" })).toBe("«سلام»");
  });
});
