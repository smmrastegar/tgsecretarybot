import { describe, expect, it } from "vitest";
import { toScTrack } from "@/lib/soundcloud";

describe("toScTrack", () => {
  it("maps a SoundCloud track to a library entry", () => {
    const t = toScTrack({ id: 417474360, title: "  Chill Study Beats ", duration: 235019, permalink_url: "https://soundcloud.com/a/b?utm_medium=api", artwork_url: "https://i1.sndcdn.com/artworks-000-large.jpg", created_at: "2016/01/15 19:17:20 +0000", user: { username: "Lofi Girl" } });
    expect(t).toMatchObject({ scId: "417474360", title: "Chill Study Beats", artist: "Lofi Girl", url: "https://soundcloud.com/a/b", durationS: 235, releaseDate: "2016-01-15" });
    expect(t?.coverUrl).toBe("https://i1.sndcdn.com/artworks-000-t500x500.jpg");
  });
  it("ignores entries without id or title", () => {
    expect(toScTrack({ id: 0, title: "x" })).toBeNull();
    expect(toScTrack({ id: 5 })).toBeNull();
  });
});
