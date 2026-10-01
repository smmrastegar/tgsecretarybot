import { describe, expect, it } from "vitest";
import { isFinalDownloadMedia } from "../lib/link-relay-kinds";

describe("isFinalDownloadMedia", () => {
  it("spotify: the cover card is not the result, the audio is", () => {
    expect(isFinalDownloadMedia("spotify", "photo")).toBe(false);
    expect(isFinalDownloadMedia("spotify", "audio")).toBe(true);
    expect(isFinalDownloadMedia("spotify", "document")).toBe(true);
  });
  it("instagram: photos and videos are results", () => {
    expect(isFinalDownloadMedia("instagram", "photo")).toBe(true);
    expect(isFinalDownloadMedia("instagram", "video")).toBe(true);
    expect(isFinalDownloadMedia("instagram", "audio")).toBe(false);
  });
  it("unknown downloader keeps accepting anything", () => {
    expect(isFinalDownloadMedia("tiktok", "photo")).toBe(true);
  });
});
