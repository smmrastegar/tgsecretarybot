// Who REALLY sang a SoundCloud upload? SoundCloud only knows the uploader (a label, a fan page, a podcast …) and a free-form title.
// Spotify's catalogue is the reference: a song found there gives the canonical title and artists; otherwise the artist named in the title
// (or the uploader) is looked up among Spotify's artist profiles and only taken when the name matches closely. Everything else is left
// for the owner to decide, with suggestions.
import { mentions, parseTitle, stripFeat, tidyTitle, type Parse } from "./music-clean";
import { nameWords, wordOverlap } from "./music-names";
import { searchSpotifyTracks, SpotifyRateLimited } from "./spotify";
import { searchArtists } from "./music-artists";
import type { MetaSuggestion } from "./db";

export type Fix =
  | { state: "auto-track" | "auto-artist"; title: string; artist: string; note: string }
  | { state: "review"; title: string; artist: string; note: string; suggestions: MetaSuggestion[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sim = (a: string, b: string) => { const x = nameWords(a), y = nameWords(b); return x.length && y.length ? Math.min(wordOverlap(x, y), wordOverlap(y, x)) : 0; };
const MARK = /\b(remix|live|acoustic|instrumental|piano version|cover|demo|rerub|rework|bootleg)\b/i;
const splitNames = (s: string) => s.split(/\s*(?:,|&|\+|\bx\b|\band\b|،)\s*/i).map((x) => x.trim()).filter((x) => x && !/^\d+$/.test(x));

type Hit = { id: string; name: string; followers: number };
const artistCache = new Map<string, Hit | null>();

/** An artist profile on Spotify for this name, only when the name is (almost) the same. */
async function artistHit(name: string): Promise<Hit | null> {
  const key = nameWords(name).join(" ");
  if (!key) return null;
  if (artistCache.has(key)) return artistCache.get(key)!;
  await sleep(200);
  const list = await searchArtists(name);
  let best: Hit | null = null, bestScore = 0;
  for (const a of list) {
    const s = sim(name, a.name);
    // a single known first name / surname ("Namjoo") may stand for a well-known full name, never for an obscure one
    const w = nameWords(name), full = nameWords(a.name);
    const subset = w.length >= 1 && (w.length >= 2 || w[0]!.length >= 5) && wordOverlap(w, full) >= 0.99 && a.followers >= 20000;
    const score = s >= 0.95 ? s + 0.05 : subset ? 0.9 : s >= 0.85 && a.followers >= 2000 ? s : 0;
    if (score > bestScore) { bestScore = score; best = { id: a.id, name: a.name, followers: a.followers }; }
  }
  artistCache.set(key, best);
  return best;
}

export async function resolveSc(rawTitle: string, uploader: string): Promise<Fix> {
  const p: Parse = parseTitle(rawTitle);
  const hay = `${tidyTitle(rawTitle)} ${uploader}`;
  const fallbackTitle = p.latinTitle ?? p.readings[0]!.title;
  const guess = (): { title: string; artist: string } => ({ title: fallbackTitle, artist: p.readings.find((r) => r.artist)?.artist ?? uploader });

  // 1) The song itself on Spotify (not for covers / remixes / podcasts: those are other recordings)
  const queries = [...new Set(p.readings.slice(0, 3).flatMap((r) => [`${r.title} ${r.artist ?? ""}`.trim(), r.title]).concat(p.latinTitle ? [`${p.latinTitle} ${uploader}`] : []))].slice(0, 5);
  const seen = new Map<string, { title: string; artists: string[]; score: number; strong: boolean }>();
  for (const q of queries) {
    await sleep(250);
    let list;
    try { list = await searchSpotifyTracks(q); } catch (e) { if (e instanceof SpotifyRateLimited) throw e; continue; }
    for (const t of list) {
      if (seen.has(t.id)) continue;
      const artists = t.artist.split(/,\s*/).filter(Boolean);
      const ts = Math.max(...p.readings.map((r) => sim(r.title, stripFeat(t.title).rest)), sim(fallbackTitle, stripFeat(t.title).rest));
      const hayWords = nameWords(hay);
      // the artist's name is in the upload's text — all of it, or (for a clearly matching title) its main word: "Namjoo" for "Mohsen Namjoo"
      const evidence = artists.some((a) => {
        const aw = nameWords(a), full = wordOverlap(aw, hayWords);
        if (full >= 0.85) return true;
        const longest = Math.max(0, ...aw.filter((w) => hayWords.some((h) => h === w || wordOverlap([w], [h]) >= 0.85)).map((w) => w.length));
        return ts >= 0.9 && full >= 0.5 && longest >= 5;
      });
      const marker = MARK.test(t.title) === MARK.test(rawTitle);
      seen.set(t.id, { title: t.title, artists, score: ts, strong: ts >= 0.85 && evidence && marker && (!p.derived || MARK.test(t.title)) });
    }
  }
  const ranked = [...seen.values()].sort((a, b) => Number(b.strong) - Number(a.strong) || b.score - a.score);
  const strong = ranked.find((r) => r.strong);
  if (strong) return { state: "auto-track", title: strong.title, artist: strong.artists.join(", "), note: "found on Spotify" };

  // 2) Not on Spotify (or not recognisable): the artist profile named in the title or the uploader
  const suggestions: MetaSuggestion[] = ranked.filter((r) => r.score >= 0.5).slice(0, 4).map((r) => ({ title: r.title, artist: r.artists.join(", "), source: "spotify-track" as const }));
  if (!p.derived) {
    const tried: Array<{ reading: Parse["readings"][number]; hits: Hit[]; all: boolean }> = [];
    for (const r of p.readings.slice(0, 4)) {
      if (!r.artist) continue;
      const names = [...splitNames(stripFeat(r.artist).rest || r.artist), ...p.feat];
      if (!names.length || names.length > 4) continue;
      const hits: Hit[] = [];
      for (const n of names) { const h = await artistHit(n); if (h) hits.push(h); }
      tried.push({ reading: r, hits, all: hits.length === names.length });
    }
    // the reading whose artist side is known to Spotify; if two readings both qualify (A - B and B - A), it is ambiguous → the owner decides
    const good = tried.filter((t) => t.hits.length > 0);
    if (good.length === 1 || (good.length > 1 && good[0]!.hits[0]!.followers > 3 * (good[1]!.hits[0]?.followers ?? 0))) {
      const t = good[0]!;
      const title = t.reading.version ? `${t.reading.title} (${t.reading.version})` : t.reading.title;
      const unresolved = p.feat.filter((n) => !t.hits.some((h) => sim(h.name, n) >= 0.8)).filter((n) => /^[A-Za-z' .-]{3,30}$/.test(n));
      return { state: "auto-artist", title: stripFeat(title).rest || title, artist: [...t.hits.map((h) => h.name), ...unresolved].join(", "), note: "artist profile on Spotify" };
    }
    for (const t of good.slice(0, 2)) suggestions.push({ title: t.reading.title, artist: t.hits.map((h) => h.name).join(", "), source: "spotify-artist" });
    // no artist in the title: the uploader may be the artist
    if (!tried.some((t) => t.hits.length)) {
      const h = await artistHit(uploader);
      if (h && sim(h.name, uploader) >= 0.9) return { state: "auto-artist", title: fallbackTitle, artist: h.name, note: "uploader is the artist" };
      if (h) suggestions.push({ title: fallbackTitle, artist: h.name, source: "spotify-artist", note: "uploader looks like this artist" });
    }
  }
  const g = guess();
  suggestions.push({ title: g.title, artist: g.artist, source: "parse", note: p.derived ? "cover / remix / podcast: check by hand" : undefined });
  return { state: "review", title: g.title, artist: g.artist, note: p.derived ? "cover / remix / podcast" : "not found on Spotify", suggestions: dedupe(suggestions) };
}

function dedupe(l: MetaSuggestion[]): MetaSuggestion[] {
  const seen = new Set<string>();
  return l.filter((s) => { const k = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export { mentions };
