import { describe, expect, it } from "vitest";
import { transcriptNote } from "../lib/stt";

const base = { text: "x", provider: "openrouter:gemini-2.5-pro", model: "google/gemini-2.5-pro", costUsd: 0.00412, elapsedMs: 6100, fallbacks: 0, mode: "best" as const };

describe("transcriptNote", () => {
  it("says the model, the cost and the time", async () => {
    const n = await transcriptNote({ ...base, durationSeconds: 42 });
    expect(n).toContain("Gemini 2.5 Pro");
    expect(n).toContain("$0.0041");
    expect(n).toContain("6.1");
    expect(n).toContain("42");
  });
  it("flags a fallback and the fast mode", async () => {
    expect(await transcriptNote({ ...base, fallbacks: 1 })).toContain("مدل اصلی خطا داد");
    expect(await transcriptNote({ ...base, mode: "fast", model: "whisper-large-v3-turbo" })).toContain("حالت «سریع»");
  });
});
