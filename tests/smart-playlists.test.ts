import { describe, expect, it, vi } from "vitest";

const T = (id: number, artist: string, rating = 0) => ({ id, title: `T${id}`, artist, status: "ready", rating }) as never;
const tracks = [T(1, "Ali", 1), T(2, "Ali"), T(3, "Sara", 1), T(4, "Sara", -1), T(5, "Omid")];
const desc = new Map([
  [1, { bpm: 80, key: "A", mode: "minor", energy: 0.2, brightness: 0.2, vibe: null, genres: ["pop / ballad"], moods: { sad: 0.8, instrumental: 0.1 } }],
  [2, { bpm: 130, key: "C", mode: "major", energy: 0.8, brightness: 0.5, vibe: null, genres: ["electronic / house"], moods: { sad: 0.1, danceable: 0.9, instrumental: 0.9 } }],
  [3, { bpm: 90, key: "D", mode: "minor", energy: 0.3, brightness: 0.2, vibe: null, genres: ["pop / ballad"], moods: { sad: 0.7, instrumental: 0.2 } }],
  [4, { bpm: 85, key: "E", mode: "minor", energy: 0.2, brightness: 0.2, vibe: null, genres: ["pop / ballad"], moods: { sad: 0.9, instrumental: 0.1 } }],
]);
vi.mock("@/lib/db", () => ({ listMusicPlaylists: async () => [], listMusicTracks: async () => tracks }));
vi.mock("@/lib/music-analysis", () => ({ descriptors: async () => desc, similarTo: async () => [{ id: 3, score: 0.9 }, { id: 2, score: 0.5 }] }));

describe("smart playlists", () => {
  it("sanitises untrusted rules", async () => {
    const { sanitizeRules } = await import("@/lib/music-playlists");
    expect(sanitizeRules({ liked: "yes", genres: [" Pop ", ""], energy: [0.9, 0.1], bpm: ["a", 3], moods: { sad: 5, bogus: 1 }, limit: -3 }))
      .toEqual({ genres: ["pop"], energy: [0.1, 0.9], moods: { sad: 1 } });
  });
  it("liked songs only, never disliked ones", async () => {
    const { resolveRules } = await import("@/lib/music-playlists");
    expect(await resolveRules({ liked: true })).toEqual([1, 3]);
    expect(await resolveRules({})).toEqual([1, 2, 3, 5]); // 4 is disliked
  });
  it("genre + mood + vocal rules use the analysis; unanalysed songs are left out", async () => {
    const { resolveRules } = await import("@/lib/music-playlists");
    expect(await resolveRules({ genres: ["ballad"], moods: { sad: 0.5 }, vocal: "vocal" })).toEqual([1, 3]);
    expect(await resolveRules({ energy: [0.7, 1], mode: "major" })).toEqual([2]);
    expect(await resolveRules({ bpm: [75, 95] })).toEqual([1, 3]);
  });
  it("'sounds like' seeds, with the rules still applied", async () => {
    const { resolveRules } = await import("@/lib/music-playlists");
    expect(await resolveRules({ seed: { trackId: 1, n: 10 } })).toEqual([1, 3, 2]);
    expect(await resolveRules({ seed: { trackId: 1 }, liked: true })).toEqual([1, 3]);
    expect(await resolveRules({ artists: ["sara"], limit: 1 })).toEqual([3]);
  });
});
