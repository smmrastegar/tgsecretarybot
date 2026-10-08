import { listMusicPlaylists, listMusicTracks, type MusicPlaylist, type MusicTrack } from "@/lib/db";
import { descriptors, similarTo, type Descriptor } from "@/lib/music-analysis";

// Smart playlists: membership is computed from rules every time it is asked
// for, so "liked only", genre / mood / energy / tempo and "sounds like X"
// lists stay current as the library, likes and analysis change.
export type SmartRules = {
  liked?: boolean;                 // only songs rated up
  includeDisliked?: boolean;       // default false: disliked songs are skipped
  genres?: string[];               // any tag contains one of these (case-insensitive)
  artists?: string[];              // artist contains one of these
  moods?: Partial<Record<"happy" | "sad" | "relaxed" | "aggressive" | "danceable", number>>; // minimum probability (0–1)
  vocal?: "vocal" | "instrumental";
  energy?: [number, number];       // 0–1
  bpm?: [number, number];
  mode?: "major" | "minor";
  seed?: { trackId: number; n?: number }; // the n songs that sound most like this one
  limit?: number;
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pair = (v: unknown): [number, number] | undefined => {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [a, b] = [Number(v[0]), Number(v[1])];
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : undefined;
};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20) : []);

/** Clean untrusted rules from the dashboard. */
export function sanitizeRules(raw: unknown): SmartRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SmartRules = {};
  if (r.liked === true) out.liked = true;
  if (r.includeDisliked === true) out.includeDisliked = true;
  if (strs(r.genres).length) out.genres = strs(r.genres);
  if (strs(r.artists).length) out.artists = strs(r.artists);
  if (r.moods && typeof r.moods === "object") {
    const m: NonNullable<SmartRules["moods"]> = {};
    for (const k of ["happy", "sad", "relaxed", "aggressive", "danceable"] as const) {
      const v = (r.moods as Record<string, unknown>)[k];
      if (typeof v === "number" && v > 0) m[k] = Math.min(1, v);
    }
    if (Object.keys(m).length) out.moods = m;
  }
  if (r.vocal === "vocal" || r.vocal === "instrumental") out.vocal = r.vocal;
  const e = pair(r.energy); if (e) out.energy = e;
  const b = pair(r.bpm); if (b) out.bpm = b;
  if (r.mode === "major" || r.mode === "minor") out.mode = r.mode;
  const seed = r.seed as { trackId?: unknown; n?: unknown } | undefined;
  if (seed && Number.isFinite(Number(seed.trackId))) out.seed = { trackId: Number(seed.trackId), n: Math.min(200, Math.max(5, num(Number(seed.n), 40))) };
  if (Number.isFinite(Number(r.limit)) && Number(r.limit) > 0) out.limit = Math.min(1000, Number(r.limit));
  return out;
}

function matches(t: MusicTrack, d: Descriptor | undefined, r: SmartRules): boolean {
  if (t.rating < 0 && !r.includeDisliked) return false;
  if (r.liked && t.rating <= 0) return false;
  if (r.artists && !r.artists.some((a) => (t.artist ?? "").toLowerCase().includes(a))) return false;
  const needsAnalysis = r.genres || r.moods || r.vocal || r.energy || r.bpm || r.mode;
  if (needsAnalysis && !d) return false;
  if (!d) return true;
  if (r.genres && !r.genres.some((g) => d.genres.some((tag) => tag.includes(g)))) return false;
  for (const [k, min] of Object.entries(r.moods ?? {})) if ((d.moods[k] ?? 0) < min) return false;
  if (r.vocal) { const ins = d.moods.instrumental; if (ins == null) return false; if ((r.vocal === "instrumental") !== ins > 0.5) return false; }
  if (r.energy && (d.energy < r.energy[0] || d.energy > r.energy[1])) return false;
  if (r.bpm && (d.bpm < r.bpm[0] || d.bpm > r.bpm[1])) return false;
  if (r.mode && d.mode !== r.mode) return false;
  return true;
}

/** Track ids a rule set selects right now (ready songs only), in a sensible order. */
export async function resolveRules(rawRules: unknown, tracks?: MusicTrack[]): Promise<number[]> {
  const r = sanitizeRules(rawRules);
  const all = (tracks ?? (await listMusicTracks())).filter((t) => t.status === "ready");
  const desc = await descriptors().catch(() => new Map<number, Descriptor>());
  let ids: number[];
  if (r.seed) {
    const near = (await similarTo(r.seed.trackId, r.seed.n ?? 40)).map((s) => s.id);
    const byId = new Map(all.map((t) => [t.id, t]));
    ids = [r.seed.trackId, ...near].filter((id) => { const t = byId.get(id); return !!t && matches(t, desc.get(id), { ...r, seed: undefined }); });
  } else {
    ids = all.filter((t) => matches(t, desc.get(t.id), r)).map((t) => t.id);
  }
  return r.limit ? ids.slice(0, r.limit) : ids;
}

export type ResolvedPlaylist = MusicPlaylist & { smart: boolean };

/** All playlists with smart ones' membership computed. */
export async function resolvedPlaylists(tracks?: MusicTrack[]): Promise<ResolvedPlaylist[]> {
  const pls = await listMusicPlaylists();
  const ts = tracks ?? (await listMusicTracks());
  const out: ResolvedPlaylist[] = [];
  for (const p of pls) {
    if (p.rules) out.push({ ...p, trackIds: await resolveRules(p.rules, ts), smart: true });
    else out.push({ ...p, smart: false });
  }
  return out;
}
