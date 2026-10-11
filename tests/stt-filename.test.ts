import { describe, expect, it } from "vitest";
import { groqFileName } from "@/lib/stt";

describe("groqFileName", () => {
  it("renames Telegram's .oga voice notes to something Groq accepts", () => {
    expect(groqFileName("file_12.oga", "audio/ogg")).toBe("audio.ogg");
    expect(groqFileName("file_12.oga", "application/octet-stream")).toBe("audio.ogg");
  });
  it("keeps accepted extensions", () => {
    expect(groqFileName("file_3.mp4", "video/mp4")).toBe("file_3.mp4");
    expect(groqFileName("voice.ogg", "audio/ogg")).toBe("voice.ogg");
  });
  it("maps other types by mime", () => {
    expect(groqFileName("file_9.aac", "audio/aac")).toBe("audio.m4a");
    expect(groqFileName("x.bin", "audio/aac")).toBe("audio.m4a");
    expect(groqFileName("x.bin", "audio/mpeg")).toBe("audio.mp3");
  });
});
