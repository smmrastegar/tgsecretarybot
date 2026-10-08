import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getAllSettings, listFeatures, listGenres, nextTrackToAnalyze, nextTracksForGenres, saveFeatureError, saveFeatures, saveGenres, setSetting,
  type TrackFeatures,
} from "@/lib/db";
import { fetchTrackArtistGenres, SpotifyRateLimited } from "@/lib/spotify";
import { reportWarn } from "@/lib/report";

// Audio analysis → similarity, radio and vibe groups.
//   deploy/audio-analyze.py (numpy) extracts tempo, key, timbre … per track,
//   this module standardises the vectors across the library and answers
//   "what sounds like this" with cosine similarity (+ small genre bonus),
//   builds smooth "radio" queues and groups the library into vibes.

export const ANALYSIS_VERSION = 2; // 2: whole track + Discogs-EffNet embedding / genres / moods
const TOOLS = "/var/lib/tgsb-tools";
const PY = `${TOOLS}/analyzer/bin/python`;
const TIMEOUT_MS = 300_000;

export async function analyzerReady(): Promise<boolean> {
  try { await fs.access(PY); return true; } catch { return false; }
}

/** True once the ML models are installed (analyzer-setup.sh finished its ML stage). */
export async function mlAvailable(): Promise<boolean> {
  try { await fs.access(`${TOOLS}/models/genre_discogs400-discogs-effnet-1.pb`); return true; } catch { return false; }
}

async function ffmpegPath(): Promise<string> {
  for (const p of [`${TOOLS}/home/.config/spotdl/ffmpeg`, "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return "ffmpeg";
}

function runPython(file: string): Promise<{ ok: boolean; [k: string]: unknown }> {
  return new Promise(async (resolve) => {
    const script = path.join(process.cwd(), "deploy", "audio-analyze.py");
    const child = spawn(PY, [script, file, await ffmpegPath()], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TGSB_MODELS: `${TOOLS}/models`, TF_CPP_MIN_LOG_LEVEL: "3" } });
    let out = "", err = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { err = (err + b.toString()).slice(-500); });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out.trim().split("\n").pop() ?? "{}")); } catch { resolve({ ok: false, error: err || "no output" }); }
    });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e) }); });
  });
}

/** Cron step: analyse ONE track and fetch a few artists' genres. Guarded by locks; never throws. */
export async function analysisStep(): Promise<{ analyzed: number | null; genres: number }> {
  const out = { analyzed: null as number | null, genres: 0 };
  const s = await getAllSettings();
  if (await analyzerReady() && Date.now() - Number(s.musicAnalyzeLock || 0) > TIMEOUT_MS + 30_000) {
    await setSetting("musicAnalyzeLock", String(Date.now()));
    try {
      // As many tracks as fit in ~40 s of this tick (the cron fires every minute).
      // Tracks analysed before the ML models existed are saved as version 1 and
      // revisited once they do (version 2 = full analysis was attempted).
      const t0 = Date.now();
      while (Date.now() - t0 < 40_000) {
        const ml = await mlAvailable();
        const t = await nextTrackToAnalyze(ml ? ANALYSIS_VERSION : 1);
        if (!t) break;
        const r = await runPython(t.filePath);
        if (r.ok) { await saveFeatures(t.id, r as unknown as Parameters<typeof saveFeatures>[1], ml ? ANALYSIS_VERSION : 1); out.analyzed = t.id; }
        else { await saveFeatureError(t.id, String(r.error ?? "failed"), ml ? ANALYSIS_VERSION : 1); reportWarn("music", `analysis of track ${t.id} failed: ${String(r.error).slice(0, 120)}`); }
      }
    } catch (err) { reportWarn("music", "analysis step failed:", err); }
    finally { await setSetting("musicAnalyzeLock", "0"); }
  }
  if (Date.now() > Number(s.musicGenrePauseUntil || 0)) {
    try {
      for (const t of await nextTracksForGenres(3)) {
        const g = await fetchTrackArtistGenres(t.spotifyId);
        await saveGenres(t.id, g.genres, g.artists);
        out.genres++;
      }
    } catch (err) {
      if (err instanceof SpotifyRateLimited) await setSetting("musicGenrePauseUntil", String(Date.now() + (err.retryAfterSeconds + 5) * 1000));
      else reportWarn("music", "genre fetch failed:", err);
    }
  }
  return out;
}

// ---------------------------------------------------------------- model

type Model = {
  ids: number[]; idx: Map<number, number>; vecs: Float64Array[]; embs: Array<Float64Array | null>; feats: TrackFeatures[]; genres: Map<number, string[]>; at: number; count: number; allEmb: boolean;
};
let cache: Model | null = null;

// Feature groups of the 47-d hand-made vector and how much each counts.
const GROUPS: Array<[number, number, number]> = [[0, 13, 1.0], [13, 26, 0.5], [26, 30, 0.9], [30, 33, 0.7], [33, 35, 1.3], [35, 47, 0.5]];

async function model(): Promise<Model> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const [feats, genres] = await Promise.all([listFeatures(), listGenres()]);
  const f = feats.filter((x) => x.vec.length === 47);
  const dim = 47, n = f.length;
  const mean = new Float64Array(dim), sd = new Float64Array(dim);
  for (const x of f) for (let d = 0; d < dim; d++) mean[d]! += x.vec[d]! / Math.max(1, n);
  for (const x of f) for (let d = 0; d < dim; d++) sd[d]! += (x.vec[d]! - mean[d]!) ** 2 / Math.max(1, n);
  const w = new Float64Array(dim);
  for (const [a, b, g] of GROUPS) for (let d = a; d < b; d++) w[d] = g / Math.sqrt(b - a);
  const vecs = f.map((x) => {
    const v = new Float64Array(dim);
    let norm = 0;
    for (let d = 0; d < dim; d++) { v[d] = ((x.vec[d]! - mean[d]!) / Math.max(Math.sqrt(sd[d]!), 1e-6)) * w[d]!; norm += v[d]! * v[d]!; }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) v[d]! /= norm;
    return v;
  });
  // Learned embeddings (when the ML stage ran): centred on the library mean, then L2-normalised.
  const withEmb = f.filter((x) => x.emb);
  const em = new Float64Array(1280);
  for (const x of withEmb) for (let d = 0; d < 1280; d++) em[d]! += x.emb![d]! / withEmb.length;
  const embs = f.map((x) => {
    if (!x.emb) return null;
    const v = new Float64Array(1280); let norm = 0;
    for (let d = 0; d < 1280; d++) { v[d] = x.emb[d]! - em[d]!; norm += v[d]! * v[d]!; }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < 1280; d++) v[d]! /= norm;
    return v;
  });
  // Tags per track: Discogs styles ("Electronic---Downtempo" → "electronic / downtempo") + Spotify artist genres.
  const tagged = new Map<number, string[]>();
  for (const x of f) {
    const ml = x.genres.filter(([, p]) => p >= 0.1).slice(0, 4).map(([g]) => g.replace(/---/g, " / ").toLowerCase());
    tagged.set(x.trackId, [...new Set([...(genres.get(x.trackId) ?? []), ...ml])]);
  }
  cache = { ids: f.map((x) => x.trackId), idx: new Map(f.map((x, i) => [x.trackId, i])), vecs, embs, feats: f, genres: tagged, at: Date.now(), count: n, allEmb: n > 0 && embs.every(Boolean) };
  return cache;
}

const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };

/** Similarity of two tracks by index: learned embedding (70%) + hand-made features (30%) when both have an embedding. */
function sim(m: Model, i: number, j: number): number {
  const h = dot(m.vecs[i]!, m.vecs[j]!);
  const ea = m.embs[i], eb = m.embs[j];
  return ea && eb ? 0.7 * dot(ea, eb) + 0.3 * h : h;
}

function genreBonus(m: Model, a: number, b: number): number {
  const ga = m.genres.get(a), gb = m.genres.get(b);
  if (!ga || !gb) return 0;
  const shared = ga.filter((g) => gb.includes(g)).length;
  return Math.min(0.2, shared * 0.07);
}

export type Similar = { id: number; score: number };

export async function similarTo(trackId: number, n = 30, exclude: Set<number> = new Set(), allowed: Set<number> | null = null): Promise<Similar[]> {
  const m = await model();
  const i = m.idx.get(trackId);
  if (i == null) return [];
  const out: Similar[] = [];
  for (let j = 0; j < m.ids.length; j++) {
    if (j === i || exclude.has(m.ids[j]!) || (allowed && !allowed.has(m.ids[j]!))) continue;
    out.push({ id: m.ids[j]!, score: sim(m, i, j) + genreBonus(m, trackId, m.ids[j]!) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]; // C, C#, D …
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function camelot(key: string, mode: string): number {
  const k = Math.max(0, KEYS.indexOf(key));
  const major = CAMELOT_MAJOR[k]!;
  return mode === "minor" ? ((major + 2) % 12) + 1 : major; // relative minor shares the number
}
function keyPenalty(a: TrackFeatures, b: TrackFeatures): number {
  const d = Math.abs(camelot(a.key, a.mode) - camelot(b.key, b.mode)); const wrap = Math.min(d, 12 - d);
  return wrap <= 1 ? 0 : wrap === 2 ? 0.02 : 0.05;
}
function tempoPenalty(a: number, b: number): number {
  if (!a || !b) return 0;
  const r = Math.log2(a / b);
  return 0.12 * Math.min(Math.abs(r), Math.abs(r - 1), Math.abs(r + 1));
}

/**
 * A listening queue that stays "in the same lane": each next song is among the
 * closest unplayed ones to the CURRENT song (not just the first), with gentle
 * tempo / key / artist continuity, picked from the top 3 so it doesn't loop.
 */
export async function radioFrom(trackId: number, n = 40, artistOf: (id: number) => string = () => "", allowed: Set<number> | null = null): Promise<Similar[]> {
  const m = await model();
  const start = m.idx.get(trackId);
  if (start == null) return [];
  const used = new Set<number>([start]);
  const out: Similar[] = [{ id: trackId, score: 1 }];
  let cur = start, seed = trackId * 2654435761 % 2147483647;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  while (out.length < n && used.size < m.ids.length) {
    const cands: Array<{ j: number; s: number }> = [];
    for (let j = 0; j < m.ids.length; j++) {
      if (used.has(j) || (allowed && !allowed.has(m.ids[j]!))) continue;
      let s = sim(m, cur, j) + genreBonus(m, m.ids[cur]!, m.ids[j]!);
      s -= tempoPenalty(m.feats[cur]!.bpm, m.feats[j]!.bpm) + keyPenalty(m.feats[cur]!, m.feats[j]!);
      const art = artistOf(m.ids[cur]!);
      if (art && art === artistOf(m.ids[j]!)) s -= 0.05;
      cands.push({ j, s });
    }
    if (cands.length === 0) break;
    cands.sort((a, b) => b.s - a.s);
    const top = cands.slice(0, 3);
    const pick = top[Math.min(top.length - 1, Math.floor(rnd() * rnd() * top.length))]!;
    used.add(pick.j); out.push({ id: m.ids[pick.j]!, score: pick.s }); cur = pick.j;
  }
  return out;
}

// ---------------------------------------------------------------- vibes

export type Vibe = { key: string; name: string; trackIds: number[]; bpm: number; energy: number; brightness: number; minorShare: number; genres: string[]; moods: Record<string, number> };
let vibeCache: { at: number; count: number; vibes: Vibe[] } | null = null;

const subGenre = (g: string) => (g.split(" / ").pop() ?? g).replace(/\b\w/g, (c) => c.toUpperCase());

export async function vibes(): Promise<Vibe[]> {
  const m = await model();
  if (vibeCache && vibeCache.count === m.count && Date.now() - vibeCache.at < 10 * 60_000) return vibeCache.vibes;
  const n = m.ids.length;
  if (n < 6) return [];
  // Clustering space: learned embedding + hand-made features when every track has both, else hand-made only.
  const space: Float64Array[] = m.allEmb
    ? m.vecs.map((v, i) => { const e = m.embs[i]!, o = new Float64Array(v.length + e.length); for (let d = 0; d < v.length; d++) o[d] = v[d]! * 0.6; for (let d = 0; d < e.length; d++) o[v.length + d] = e[d]! * 0.8; const nm = Math.sqrt(o.reduce((a, b) => a + b * b, 0)) || 1; for (let d = 0; d < o.length; d++) o[d]! /= nm; return o; })
    : m.vecs;
  const dim = space[0]!.length;
  const k = Math.max(3, Math.min(10, Math.round(Math.sqrt(n / 2))));
  let seed = 12345; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const cent: Float64Array[] = [space[Math.floor(rnd() * n)]!.slice()];
  while (cent.length < k) {
    const d2 = space.map((v) => Math.min(...cent.map((c) => 1 - dot(v, c))) ** 2);
    let r = rnd() * d2.reduce((a, b) => a + b, 0), pick = 0;
    for (let i = 0; i < n; i++) { r -= d2[i]!; if (r <= 0) { pick = i; break; } }
    cent.push(space[pick]!.slice());
  }
  let assign = new Array<number>(n).fill(0);
  for (let it = 0; it < 40; it++) {
    const next = space.map((v) => { let b = 0, bs = -2; cent.forEach((c, ci) => { const s = dot(v, c); if (s > bs) { bs = s; b = ci; } }); return b; });
    const changed = next.some((x, i) => x !== assign[i]);
    assign = next;
    for (let ci = 0; ci < k; ci++) {
      const mem = assign.flatMap((a, i) => (a === ci ? [i] : []));
      if (!mem.length) continue;
      const c = new Float64Array(dim);
      for (const i of mem) for (let d = 0; d < dim; d++) c[d]! += space[i]![d]!;
      const norm = Math.sqrt(c.reduce((a, b) => a + b * b, 0)) || 1;
      for (let d = 0; d < dim; d++) c[d]! /= norm;
      cent[ci] = c;
    }
    if (!changed) break;
  }
  const raw: Vibe[] = [];
  for (let ci = 0; ci < k; ci++) {
    const mem = assign.flatMap((a, i) => (a === ci ? [i] : []));
    if (mem.length < 3) continue;
    // order members from the cluster core outwards so "play" starts on a typical song
    mem.sort((a, b) => dot(space[b]!, cent[ci]!) - dot(space[a]!, cent[ci]!));
    const fs_ = mem.map((i) => m.feats[i]!);
    const avg = (f: (x: TrackFeatures) => number) => fs_.reduce((a, x) => a + f(x), 0) / fs_.length;
    const gcount = new Map<string, number>();
    for (const i of mem) for (const g of m.genres.get(m.ids[i]!) ?? []) gcount.set(g, (gcount.get(g) ?? 0) + 1);
    const topG = [...gcount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c >= Math.max(2, mem.length * 0.25)).map(([g]) => g);
    const moods: Record<string, number> = {};
    for (const mk of ["happy", "sad", "aggressive", "relaxed", "danceable", "instrumental"]) {
      const have = fs_.filter((x) => x.moods[mk] != null);
      if (have.length) moods[mk] = +(have.reduce((a, x) => a + x.moods[mk]!, 0) / have.length).toFixed(2);
    }
    raw.push({ key: `v${ci}`, name: "", trackIds: mem.map((i) => m.ids[i]!), bpm: Math.round(avg((x) => x.bpm)), energy: +avg((x) => x.energy).toFixed(2), brightness: +avg((x) => x.brightness).toFixed(2), minorShare: +avg((x) => (x.mode === "minor" ? 1 : 0)).toFixed(2), genres: topG, moods });
  }
  // Name: mood (learned, else energy rank) + a tone word + the dominant sub-genre.
  const rank = (f: (v: Vibe) => number) => { const s = [...raw].sort((a, b) => f(a) - f(b)); return new Map(s.map((v, i) => [v.key, raw.length > 1 ? i / (raw.length - 1) : 0.5])); };
  const re = rank((v) => v.energy), rb = rank((v) => v.brightness);
  const used = new Map<string, number>();
  for (const v of raw) {
    const e = re.get(v.key)!, b = rb.get(v.key)!, mo = v.moods;
    const lead = mo.aggressive != null && mo.aggressive > 0.35 ? "Intense"
      : mo.sad != null && mo.sad > 0.5 && e < 0.7 ? "Melancholic"
      : mo.happy != null && mo.happy > 0.45 ? "Cheerful"
      : mo.relaxed != null && mo.relaxed > 0.55 && e < 0.5 ? "Relaxed"
      : e < 0.34 ? "Calm" : e > 0.66 ? "Energetic" : "Easy-going";
    const tone = mo.instrumental != null && mo.instrumental > 0.7 ? "instrumental" : v.minorShare > 0.6 ? "moody" : b > 0.66 ? "bright" : b < 0.34 ? "warm" : v.minorShare < 0.35 ? "sunny" : "balanced";
    let name = `${lead} · ${tone}`;
    if (v.genres[0]) name += ` · ${subGenre(v.genres[0])}`;
    const c = (used.get(name) ?? 0) + 1; used.set(name, c);
    v.name = c > 1 ? `${name} ${c}` : name;
  }
  const out = raw.sort((a, b) => b.trackIds.length - a.trackIds.length);
  vibeCache = { at: Date.now(), count: m.count, vibes: out };
  return out;
}

export type Descriptor = { bpm: number; key: string; mode: string; energy: number; brightness: number; vibe: string | null; genres: string[]; moods: Record<string, number>; vocal: number; bass: number; dynamics: number };

/** Descriptor per track for the list API (bpm / key / energy / vibe / genres / moods). */
export async function descriptors(): Promise<Map<number, Descriptor>> {
  const m = await model();
  const v = await vibes();
  const vibeOf = new Map<number, string>();
  for (const x of v) for (const id of x.trackIds) vibeOf.set(id, x.key);
  const out = new Map<number, Descriptor>();
  m.feats.forEach((f) => out.set(f.trackId, { bpm: Math.round(f.bpm), key: f.key, mode: f.mode, energy: f.energy, brightness: f.brightness, vibe: vibeOf.get(f.trackId) ?? null, genres: m.genres.get(f.trackId) ?? [], moods: f.moods, vocal: f.vocal, bass: f.bass, dynamics: f.dynamics }));
  return out;
}
