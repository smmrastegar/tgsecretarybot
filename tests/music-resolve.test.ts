import { describe, expect, it, vi } from "vitest";

// the resolver only needs Spotify for the lookups; the whole-word name rules are what is checked here
vi.mock("@/lib/spotify", () => ({ searchSpotifyTracks: vi.fn(async () => [{ id: "1", title: "بخاطر تو", artist: "Khan" }]), SpotifyRateLimited: class extends Error {} }));
vi.mock("@/lib/music-artists", () => ({ searchArtists: vi.fn(async (q: string) => (/khane?|parham/i.test(q) ? [{ id: "a", name: /parham/i.test(q) ? "Parham" : "Khan", followers: 90000, imageUrl: null, genres: [] }] : [])) }));

import { pace, resolveSc } from "@/lib/music-resolve";

describe("resolveSc whole-word uploader rule", () => {
  pace.ms = 0;
  it("does not treat 'MusicKhane' as the artist 'Khan'", async () => {
    const r = await resolveSc("کیانا - بخاطر تو", "MusicKhane");
    expect(r.artist).not.toBe("Khan");
  });
  it("does not treat 'ParhamGh' as the artist 'Parham'", async () => {
    const r = await resolveSc("راكوب - ببين عاشقتم …", "ParhamGh");
    expect(r.artist).not.toBe("Parham");
  });
});
