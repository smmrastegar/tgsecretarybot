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

export const ANALYSIS_VERSION = 1;
const TOOLS = "/var/lib/tgsb-tools";
const PY = `${TOOLS}/analyzer/bin/python`;
const TIMEOUT_MS = 150_000;

export async function analyzerReady(): Promise<boolean> {
  try { await fs.access(PY); return true; } catch { return false; }
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
    const child = spawn(PY, [script, file, await ffmpegPath()], { stdio: ["ignore", "pipe", "pipe"] });
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
      const t = await nextTrackToAnalyze(ANALYSIS_VERSION);
      if (t) {
        const r = await runPython(t.filePath);
        if (r.ok) { await saveFeatures(t.id, r as unknown as Parameters<typeof saveFeatures>[1], ANALYSIS_VERSION); out.analyzed = t.id; }
        else { await saveFeatureError(t.id, String(r.error ?? "failed"), ANALYSIS_VERSION); reportWarn("music", `analysis of track ${t.id} failed: ${String(r.error).slice(0, 120)}`); }
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
  ids: number[]; idx: Map<number, number>; vecs: Float64Array[]; feats: TrackFeatures[]; genres: Map<number, string[]>; at: number; count: number;
};
let cache: Model | null = null;

// Feature groups of the 47-d vector and how much each counts.
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
  cache = { ids: f.map((x) => x.trackId), idx: new Map(f.map((x, i) => [x.trackId, i])), vecs, feats: f, genres, at: Date.now(), count: n };
  return cache;
}

const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };

function genreBonus(m: Model, a: number, b: number): number {
  const ga = m.genres.get(a), gb = m.genres.get(b);
  if (!ga || !gb) return 0;
  const shared = ga.filter((g) => gb.includes(g)).length;
  return Math.min(0.2, shared * 0.07);
}

export type Similar = { id: number; score: number };

export async function similarTo(trackId: number, n = 30, exclude: Set<number> = new Set()): Promise<Similar[]> {
  const m = await model();
  const i = m.idx.get(trackId);
  if (i == null) return [];
  const out: Similar[] = [];
  for (let j = 0; j < m.ids.length; j++) {
    if (j === i || exclude.has(m.ids[j]!)) continue;
    out.push({ id: m.ids[j]!, score: dot(m.vecs[i]!, m.vecs[j]!) + genreBonus(m, trackId, m.ids[j]!) });
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
export async function radioFrom(trackId: number, n = 40, artistOf: (id: number) => string = () => ""): Promise<Similar[]> {
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
      if (used.has(j)) continue;
      let s = dot(m.vecs[cur]!, m.vecs[j]!) + genreBonus(m, m.ids[cur]!, m.ids[j]!);
      s -= tempoPenalty(m.feats[cur]!.bpm, m.feats[j]!.bpm) + keyPenalty(m.feats[cur]!, m.feats[j]!);
      const art = artistOf(m.ids[cur]!);
      if (art && art === artistOf(m.ids[j]!)) s -= 0.05;
      cands.push({ j, s });
    }
    cands.sort((a, b) => b.s - a.s);
    const top = cands.slice(0, 3);
    const pick = top[Math.min(top.length - 1, Math.floor(rnd() * rnd() * top.length))]!;
    used.add(pick.j); out.push({ id: m.ids[pick.j]!, score: pick.s }); cur = pick.j;
  }
  return out;
}

// ---------------------------------------------------------------- vibes

export type Vibe = { key: string; name: string; trackIds: number[]; bpm: number; energy: number; brightness: number; minorShare: number; genres: string[] };
let vibeCache: { at: number; count: number; vibes: Vibe[] } | null = null;

export async function vibes(): Promise<Vibe[]> {
  const m = await model();
  if (vibeCache && vibeCache.count === m.count && Date.now() - vibeCache.at < 10 * 60_000) return vibeCache.vibes;
  const n = m.ids.length;
  if (n < 6) return [];
  const k = Math.max(3, Math.min(8, Math.round(Math.sqrt(n / 2))));
  // deterministic k-means++ on the weighted vectors
  let seed = 12345; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const cent: Float64Array[] = [m.vecs[Math.floor(rnd() * n)]!.slice()];
  while (cent.length < k) {
    const d2 = m.vecs.map((v) => Math.min(...cent.map((c) => 1 - dot(v, c))) ** 2);
    let r = rnd() * d2.reduce((a, b) => a + b, 0), pick = 0;
    for (let i = 0; i < n; i++) { r -= d2[i]!; if (r <= 0) { pick = i; break; } }
    cent.push(m.vecs[pick]!.slice());
  }
  let assign = new Array<number>(n).fill(0);
  for (let it = 0; it < 30; it++) {
    const next = m.vecs.map((v) => { let b = 0, bs = -2; cent.forEach((c, ci) => { const s = dot(v, c); if (s > bs) { bs = s; b = ci; } }); return b; });
    const changed = next.some((x, i) => x !== assign[i]);
    assign = next;
    for (let ci = 0; ci < k; ci++) {
      const mem = assign.flatMap((a, i) => (a === ci ? [i] : []));
      if (!mem.length) continue;
      const c = new Float64Array(47);
      for (const i of mem) for (let d = 0; d < 47; d++) c[d]! += m.vecs[i]![d]!;
      const norm = Math.sqrt(c.reduce((a, b) => a + b * b, 0)) || 1;
      for (let d = 0; d < 47; d++) c[d]! /= norm;
      cent[ci] = c;
    }
    if (!changed) break;
  }
  const raw: Vibe[] = [];
  for (let ci = 0; ci < k; ci++) {
    const mem = assign.flatMap((a, i) => (a === ci ? [i] : []));
    if (mem.length < 3) continue;
    // order members from the cluster core outwards so "play" starts on a typical song
    mem.sort((a, b) => dot(m.vecs[b]!, cent[ci]!) - dot(m.vecs[a]!, cent[ci]!));
    const fs_ = mem.map((i) => m.feats[i]!);
    const avg = (f: (x: TrackFeatures) => number) => fs_.reduce((a, x) => a + f(x), 0) / fs_.length;
    const gcount = new Map<string, number>();
    for (const i of mem) for (const g of m.genres.get(m.ids[i]!) ?? []) gcount.set(g, (gcount.get(g) ?? 0) + 1);
    const topG = [...gcount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, c]) => c >= Math.max(2, mem.length * 0.25)).map(([g]) => g);
    raw.push({ key: `v${ci}`, name: "", trackIds: mem.map((i) => m.ids[i]!), bpm: Math.round(avg((x) => x.bpm)), energy: +avg((x) => x.energy).toFixed(2), brightness: +avg((x) => x.brightness).toFixed(2), minorShare: +avg((x) => (x.mode === "minor" ? 1 : 0)).toFixed(2), genres: topG });
  }
  // name relative to the other vibes (energy / brightness ranks), then genre
  const rank = (f: (v: Vibe) => number) => { const s = [...raw].sort((a, b) => f(a) - f(b)); return new Map(s.map((v, i) => [v.key, raw.length > 1 ? i / (raw.length - 1) : 0.5])); };
  const re = rank((v) => v.energy), rb = rank((v) => v.brightness);
  const used = new Map<string, number>();
  for (const v of raw) {
    const e = re.get(v.key)!, b = rb.get(v.key)!;
    const lead = e < 0.34 ? "Calm" : e > 0.66 ? "Energetic" : "Easy-going";
    const tone = v.minorShare > 0.6 ? "moody" : b > 0.66 ? "bright" : b < 0.34 ? "warm" : v.minorShare < 0.35 ? "sunny" : "balanced";
    let name = `${lead} · ${tone}`;
    if (v.genres[0]) name += ` · ${v.genres[0]}`;
    const c = (used.get(name) ?? 0) + 1; used.set(name, c);
    v.name = c > 1 ? `${name} ${c}` : name;
  }
  const vibes = raw.sort((a, b) => b.trackIds.length - a.trackIds.length);
  vibeCache = { at: Date.now(), count: m.count, vibes };
  return vibes;
}

/** Descriptor per track for the list API (bpm / key / energy / vibe / genres). */
export async function descriptors(): Promise<Map<number, { bpm: number; key: string; mode: string; energy: number; brightness: number; vibe: string | null; genres: string[] }>> {
  const m = await model();
  const v = await vibes();
  const vibeOf = new Map<number, string>();
  for (const x of v) for (const id of x.trackIds) vibeOf.set(id, x.key);
  const out = new Map<number, { bpm: number; key: string; mode: string; energy: number; brightness: number; vibe: string | null; genres: string[] }>();
  m.feats.forEach((f) => out.set(f.trackId, { bpm: Math.round(f.bpm), key: f.key, mode: f.mode, energy: f.energy, brightness: f.brightness, vibe: vibeOf.get(f.trackId) ?? null, genres: m.genres.get(f.trackId) ?? [] }));
  return out;
}


