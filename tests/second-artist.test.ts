import { describe, expect, it } from "vitest";
import { secondArtist } from "@/lib/db/music";

describe("secondArtist", () => {
  it("hides the uploader when it is one of the song's artists", () => {
    expect(secondArtist("Heydoo", "Heydoo Hedayati")).toBeNull();
    expect(secondArtist("Dariush Azar", "Dariush Azar, Mahya Hamedi")).toBeNull();
    expect(secondArtist("Kiosk", "Kiosk")).toBeNull();
  });
  it("keeps an uploader that is not a credit", () => {
    expect(secondArtist("Chaart Music", "Alireza Ghorbani, Hesam Naseri")).toBe("Chaart Music");
    expect(secondArtist("MusicKhane", "Kiana")).toBe("MusicKhane");
  });
  it("is empty without an uploader", () => { expect(secondArtist(null, "X")).toBeNull(); expect(secondArtist("  ", "X")).toBeNull(); });
});
