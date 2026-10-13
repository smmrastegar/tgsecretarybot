import type { Desc } from "./Views";
import type { Track } from "./shared";

// Simple, short-named groups of songs for the Search browse screen: moods, tempo and decades.
// (Computed on the phone from the song analysis and release dates; nothing is stored.)
export type SongSet = { key: string; label: string; test: (t: Track, d: Desc | undefined) => boolean };

const year = (t: Track) => { const y = Number((t.releaseDate ?? "").slice(0, 4)); return Number.isFinite(y) && y > 1900 ? y : null; };
const decade = (label: string, from: number, to: number): SongSet => ({ key: `decade-${from}`, label, test: (t) => { const y = year(t); return y != null && y >= from && y <= to; } });

export const SONG_SETS: SongSet[] = [
  { key: "mood-happy", label: "Happy", test: (_t, d) => (d?.moods?.happy ?? 0) >= 0.6 },
  { key: "mood-sad", label: "Sad", test: (_t, d) => (d?.moods?.sad ?? 0) >= 0.6 },
  { key: "mood-chill", label: "Chill", test: (_t, d) => (d?.moods?.relaxed ?? 0) >= 0.6 },
  { key: "mood-intense", label: "Intense", test: (_t, d) => (d?.moods?.aggressive ?? 0) >= 0.5 },
  { key: "mood-dance", label: "Dance", test: (_t, d) => (d?.moods?.danceable ?? 0) >= 0.65 },
  { key: "mood-instrumental", label: "Instrumental", test: (_t, d) => (d?.moods?.instrumental ?? 0) > 0.5 },
  { key: "tempo-slow", label: "Slow", test: (_t, d) => !!d && d.bpm > 0 && d.bpm < 90 },
  { key: "tempo-upbeat", label: "Upbeat", test: (_t, d) => !!d && d.bpm >= 120 },
  decade("2020s", 2020, 2029), decade("2010s", 2010, 2019), decade("2000s", 2000, 2009), decade("90s", 1990, 1999), decade("80s", 1980, 1989), decade("Classics", 1900, 1979),
];

export const setByKey = (key: string) => SONG_SETS.find((s) => s.key === key);
