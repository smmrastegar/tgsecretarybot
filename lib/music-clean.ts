// SoundCloud uploads are named by whoever uploaded them: the artist may be in the title ("Artist - Song", "Song - Artist"), twice in two
// scripts ("Hermās | هرماس"), with numbering, "(feat. …)", file extensions … and the "artist" SoundCloud gives is only the uploader
// (a label, a fan page, a podcast). These helpers take such a title apart; deciding who the artist REALLY is is left to Spotify's catalogue
// (lib/music-resolve.ts).
import { nameWords } from "./music-names";

const NOISE = /\b(official\s*(video|audio|music\s*video)?|lyrics?\s*video|audio|hd|hq|320\s*kbps|128\s*kbps|mp3|free\s*download|new\s*2\d{3}|demo)\b/gi;
const hasLatin = (s: string) => /[A-Za-z]/.test(s);
const hasArabicScript = (s: string) => /[؀-ۿ]/.test(s);

export type Feat = { names: string[]; rest: string };
/** "Song (feat. A & B)" → names [A, B], rest "Song" */
export function stripFeat(s: string): Feat {
  const names: string[] = [];
  const take = (m: string) => { for (const n of m.split(/\s*(?:,|&|\+|\band\b|\bx\b|،)\s*/i)) if (n.trim()) names.push(n.trim()); };
  let rest = s.replace(/[(\[]\s*(?:feat\.?|ft\.?|featuring|with|فیت|به همراه)\s+([^)\]]+)[)\]]/gi, (_m, g) => { take(String(g)); return " "; });
  rest = rest.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.+?)(?=\s+[-–—]+\s+|\s*$)/i, (_m, g) => { take(String(g)); return ""; });
  return { names, rest: rest.replace(/\s{2,}/g, " ").trim() };
}

/** A song title with the file / website / numbering noise removed. */
export function tidyTitle(raw: string): string {
  let s = raw.replace(/\.(mp3|wav|m4a|flac)\s*$/i, "").replace(/[‎‏‪-‮⁦-⁩]/g, "");
  s = s.replace(/\b(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|ir|net|org|info|biz|me|co)\b/gi, " ").replace(/#\w+/g, " ").replace(NOISE, " ").replace(/\(\s*\)|\[\s*\]/g, " ");
  s = s.replace(/^\s*[\d۰-۹]{1,3}\s*[-.)_]\s*/, "").replace(/\s{2,}/g, " ").trim();
  return s.replace(/^[\s\-–—_|/]+|[\s\-–—_|/]+$/g, "").trim();
}

export type Parse = {
  /** the most likely (artist, title) readings, best first; artist may be null */
  readings: Array<{ artist: string | null; title: string; version: string | null }>;
  /** names mentioned as "feat." / "ft." */
  feat: string[];
  /** it is a cover / remix / bootleg / podcast…: the upload is not the original recording */
  derived: boolean;
  /** the Latin-script title (when the upload names the song in two scripts) */
  latinTitle: string | null;
};

const DERIVED = /\b(cover|remix|re-?rub|rework|bootleg|mashup|slowed|reverb|sped\s*up|nightcore|podcast|episode|ep\d)\b|کاور|ریمیکس|پادکست|اپیزود/i;

/** Split "A | B / C _ D" into script-twin segments; a Latin one wins over its Persian twin. */
function segments(s: string): string[] {
  return s.split(/\s+(?:\||\/|_)\s+|\s*\|\s*|\s{1,}\/\s{1,}/).map((x) => x.trim()).filter(Boolean);
}

export function parseTitle(raw: string): Parse {
  const clean = tidyTitle(raw);
  const derived = DERIVED.test(clean);
  const segs = segments(clean);
  // the Latin segment(s) first, Persian ones last
  const ordered = [...segs.filter(hasLatin), ...segs.filter((x) => !hasLatin(x))];
  const readings: Parse["readings"] = [];
  const feat: string[] = [];
  let latinTitle: string | null = null;
  for (const seg0 of ordered.slice(0, 3)) {
    const f = stripFeat(seg0);
    feat.push(...f.names);
    // a trailing "(Artist)" after a song name: "02 Ba To bad nistam (Martik)"
    const parts = f.rest.split(/\s+[-–—]+\s+|\s*[-–—]{2,}\s*/).map((p) => tidyTitle(p)).filter(Boolean);
    if (parts.length >= 3) {
      readings.push({ artist: parts[0]!, title: parts[1]!, version: parts.slice(2).join(" - ") });
      readings.push({ artist: parts[1]!, title: parts[0]!, version: parts.slice(2).join(" - ") });
    } else if (parts.length === 2) {
      readings.push({ artist: parts[0]!, title: parts[1]!, version: null });
      readings.push({ artist: parts[1]!, title: parts[0]!, version: null });
    } else if (parts.length === 1) readings.push({ artist: null, title: parts[0]!, version: null });
    if (hasLatin(seg0) && !latinTitle) latinTitle = parts.length === 1 ? parts[0]! : null;
  }
  // the whole cleaned title as a last resort
  if (!readings.length || readings.every((r) => r.title !== clean)) readings.push({ artist: null, title: clean, version: null });
  return { readings, feat: [...new Set(feat)], derived, latinTitle };
}

/** Does `name` (an artist) appear as whole words inside `haystack`? (all of the name's words, in any order) */
export function mentions(haystack: string, name: string): boolean {
  const w = nameWords(name);
  if (!w.length) return false;
  const h = new Set(nameWords(haystack));
  return w.every((x) => h.has(x));
}

export { hasLatin, hasArabicScript };
