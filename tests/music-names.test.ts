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

describe("parseTitleArtist", () => {
  it("reads 'Title - Artist'", () => {
    expect(parseTitleArtist("Kooche Tanhaei - Martik")).toEqual({ title: "Kooche Tanhaei", artist: "Martik" });
    expect(parseTitleArtist("Only a title")).toEqual({ title: "Only a title", artist: null });
  });
});
