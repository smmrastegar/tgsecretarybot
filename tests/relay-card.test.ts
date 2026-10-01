import { describe, expect, it } from "vitest";
import { cardInfoHtml } from "../lib/bot/relay";

const CARD = `🎧 Title : Kooche Tanhaei
🎤 Artist : Martik
💿 Album : Kooche Tanhaei
📅 Release Date: 2026-09-17
❗ Is Local: False
🌐 ISRC: -

IMAGE
Open in Spotify`;

describe("cardInfoHtml", () => {
  it("keeps title, artist, date and the link; drops ISRC / Is Local / IMAGE", () => {
    const out = cardInfoHtml(CARD, "https://open.spotify.com/track/abc");
    expect(out).toContain("🎵 <b>Kooche Tanhaei</b>");
    expect(out).toContain("🎤 Martik");
    expect(out).toContain("📅 2026-09-17");
    expect(out).toContain('href="https://open.spotify.com/track/abc"');
    expect(out).not.toContain("ISRC");
    expect(out).not.toContain("Is Local");
    expect(out).not.toContain("IMAGE");
    // album equal to the title is not repeated
    expect(out).not.toContain("💿");
  });
  it("returns empty for a caption without title or artist", () => {
    expect(cardInfoHtml("@Spotify_downloaderrr_bot | info", "x")).toBe("");
  });
});
