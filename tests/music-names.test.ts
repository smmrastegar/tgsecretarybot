import { describe, expect, it } from "vitest";
import { guessFromFileName, nameScore, parseTitleArtist, wordOverlap, nameWords } from "@/lib/music-names";

describe("guessFromFileName", () => {
  it("splits artist and title and drops noise", () => {
    const g = guessFromFileName("01 - Martik_-_Kooche Tanhaei (320kbps) www.ahang.com.mp3");
    expect(g.artist).toBe("Martik");
    expect(g.title).toBe("Kooche Tanhaei");
    expect(g.queries[0]).toContain("Martik Kooche Tanhaei");
  });
  it("a bare title still gives a query", () => {
    expect(guessFromFileName("Hermas.mp3")).toMatchObject({ title: "Hermas", artist: null, queries: ["Hermas"] });
  });
});

describe("nameScore", () => {
  it("rewards matching title and artist, ignores brackets", () => {
    const hit = nameScore({ title: "Kooche Tanhaei (Remastered)", artist: "Martik" }, { title: "kooche tanhaei", artist: "martik" });
    const miss = nameScore({ title: "Russian Roulette", artist: "Jack Savoretti" }, { title: "kooche tanhaei", artist: "martik" });
    expect(hit).toBeGreaterThan(0.9);
    expect(miss).toBeLessThan(0.2);
  });
  it("falls back to free text", () => {
    expect(nameScore({ title: "Hermas", artist: "Taraamoon" }, { text: "taraamoon hermas live" })).toBeGreaterThan(0.5);
  });
  it("unifies Persian letter variants", () => {
    expect(wordOverlap(nameWords("كوچه تنهايي"), nameWords("کوچه تنهایی"))).toBe(1);
  });
});

describe("fuzzy spelling", () => {
  it("accepts transliteration variants but not unrelated words", () => {
    expect(nameScore({ title: "Mibinamet", artist: "Balzan" }, { title: "Mibinamat", artist: "Balzan" })).toBeGreaterThan(0.85);
    expect(nameScore({ title: "Minimale", artist: "Roshan Sani" }, { title: "Mibinamat", artist: "Balzan" })).toBeLessThan(0.3);
  });
});

describe("parseTitleArtist", () => {
  it("reads 'Title - Artist'", () => {
    expect(parseTitleArtist("Kooche Tanhaei - Martik")).toEqual({ title: "Kooche Tanhaei", artist: "Martik" });
    expect(parseTitleArtist("Only a title")).toEqual({ title: "Only a title", artist: null });
  });
});

describe("cleanTagText", () => {
  it("drops track numbers and download-site names", async () => {
    const { cleanTagText } = await import("@/lib/music-names");
    expect(cleanTagText("01 - Nemikaham")).toBe("Nemikaham");
    expect(cleanTagText("Shadmehr Aghili - GahMusic.com")).toBe("Shadmehr Aghili");
    expect(cleanTagText("Tars www.ahang.ir")).toBe("Tars");
    expect(cleanTagText("Makhoola")).toBe("Makhoola");
    expect(cleanTagText("  ")).toBeNull();
    expect(cleanTagText(null)).toBeNull();
  });
});
