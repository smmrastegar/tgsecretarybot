import { describe, expect, it, vi } from "vitest";

// Three synthetic "styles" of 8 tracks each, with distinct timbre/rhythm and a
// little noise: nearest neighbours, radio and vibes must respect them.
function make(style: number, i: number) {
  const base = [style === 0 ? -1.5 : style === 1 ? 0 : 1.5];
  const rnd = (k: number) => Math.sin(i * 7.3 + k * 1.7 + style * 3.1) * 0.15;
  const vec = Array.from({ length: 47 }, (_, d) => (d < 26 ? base[0]! * (d % 3 === 0 ? 1 : 0.6) : style === 1 ? 0.8 : style === 2 ? -0.8 : 0.1) + rnd(d));
  vec[33] = [0.7, 1.2, 1.7][style]!; // tempo / 100
  return { trackId: style * 100 + i, vec, bpm: [70, 120, 170][style]!, key: "A", mode: style === 0 ? "minor" : "major", energy: [0.2, 0.5, 0.9][style]!, brightness: [0.1, 0.3, 0.6][style]!, beat: 0.5, rms: 0.1, flux: 10, centroid: 1000, bass: 0.2, vocal: 0.5, onsetRate: 3, dynamics: 8, emb: null as number[] | null, genres: [] as Array<[string, number]>, moods: {} as Record<string, number> };
}
const feats = [0, 1, 2].flatMap((s) => Array.from({ length: 8 }, (_, i) => make(s, i)));

vi.mock("@/lib/db", () => ({
  listFeatures: async () => feats, listGenres: async () => new Map(), getAllSettings: async () => ({}), setSetting: async () => {},
  nextTrackToAnalyze: async () => null, nextTracksForGenres: async () => [], saveFeatureError: async () => {}, saveFeatures: async () => {}, saveGenres: async () => {},
}));
vi.mock("@/lib/spotify", () => ({ fetchTrackArtistGenres: async () => ({ genres: [], artists: [] }), SpotifyRateLimited: class extends Error { retryAfterSeconds = 1; } }));
vi.mock("@/lib/report", () => ({ reportWarn: () => {}, reportInfo: () => {} }));

const style = (id: number) => Math.floor(id / 100);

describe("music analysis", () => {
  it("similarTo ranks same-style tracks first", async () => {
    const { similarTo } = await import("@/lib/music-analysis");
    const top = await similarTo(101, 7);
    expect(top).toHaveLength(7);
    expect(top.every((s) => style(s.id) === 1)).toBe(true);
  });
  it("radio starts with the seed and stays in its lane", async () => {
    const { radioFrom } = await import("@/lib/music-analysis");
    const q = await radioFrom(203, 8);
    expect(q[0]!.id).toBe(203);
    expect(new Set(q.map((x) => x.id)).size).toBe(q.length);
    expect(q.filter((x) => style(x.id) === 2).length).toBeGreaterThanOrEqual(7);
  });
  it("vibes separate the styles and name them by energy", async () => {
    const { vibes } = await import("@/lib/music-analysis");
    const v = await vibes();
    expect(v.length).toBeGreaterThanOrEqual(3);
    for (const g of v) {
      const counts = [0, 0, 0]; g.trackIds.forEach((id) => counts[style(id)]!++);
      expect(Math.max(...counts) / g.trackIds.length).toBeGreaterThan(0.85);
    }
    expect(new Set(v.map((g) => g.name)).size).toBe(v.length);
    expect(v.some((g) => g.name.startsWith("Calm"))).toBe(true);
    expect(v.some((g) => g.name.startsWith("Energetic"))).toBe(true);
  });
});

describe("music analysis with embeddings", () => {
  it("prefers the learned embedding when every track has one", async () => {
    // Swap the hand-made fingerprint for a deliberately misleading one: only the embedding separates the styles.
    for (const f of feats) {
      const st = Math.floor(f.trackId / 100);
      f.emb = Array.from({ length: 1280 }, (_, d) => (d % 3 === st ? 1 : 0) + Math.sin(f.trackId * 3.7 + d) * 0.05);
      f.vec = f.vec.map((_, d) => Math.sin(f.trackId * 1.3 + d * 0.9)); // noise
      f.genres = [[st === 0 ? "Classical---Baroque" : st === 1 ? "Rock---Indie Rock" : "Electronic---Techno", 0.8]];
    }
    vi.resetModules();
    const { similarTo, vibes } = await import("@/lib/music-analysis");
    const top = await similarTo(201, 7);
    expect(top.every((s) => style(s.id) === 2)).toBe(true);
    const v = await vibes();
    expect(v.some((g) => g.name.endsWith("Techno"))).toBe(true);
  });
});
