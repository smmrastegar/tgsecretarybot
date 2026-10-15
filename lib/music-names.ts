// Helpers for guessing which song a hand-sent file is: cleaning file names, comparing names, ranking candidates.

/** lower-case, no accents, Arabic yeh/kaf and Persian digits unified, brackets / "feat." / "remastered" noise removed → word list */
export function nameWords(v: string): string[] {
  return v.normalize("NFKD").replace(/[̀-ًͯ-ٟـ]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(feat|ft|featuring|remaster(ed)?|version|official|audio|video|lyrics?|live|mp3|320|kbps)\b\.?/g, " ")
    .split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2);
}

/** share (0–1) of the words in `want` that also appear (or are contained) in `have` */
export function wordOverlap(want: string[], have: string[]): number {
  if (!want.length) return 0;
  const set = new Set(have);
  const hit = want.filter((w) => set.has(w) || have.some((h) => h.length > 3 && w.length > 3 && (h.includes(w) || w.includes(h)))).length;
  return hit / want.length;
}

export type NameGuess = { title: string | null; artist: string | null; queries: string[] };

/** "01 - Artist_Name - Song Title (320kbps) www.site.com.mp3" → { title, artist, queries } */
export function guessFromFileName(fileName: string): NameGuess {
  let s = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  s = s.replace(/_/g, " ").replace(/\b(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|ir|net|org|info|biz|me|co)\b/gi, " ")
    .replace(/\(.*?(?:official|audio|video|lyrics?|kbps|mp3|remaster).*?\)|\[.*?\]/gi, " ")
    .replace(/\b\d{2,3}\s*kbps\b/gi, " ").replace(/^\s*\d{1,3}\s*[-.)]\s*/, "").replace(/\s{2,}/g, " ").trim();
  const parts = s.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
  let artist: string | null = null, title: string | null = null;
  if (parts.length >= 2) { artist = parts[0]!; title = parts.slice(1).join(" - "); }
  else if (parts.length === 1) title = parts[0]!;
  const queries: string[] = [];
  if (artist && title) { queries.push(`${artist} ${title}`, `${title} ${artist}`); }
  if (title) queries.push(title);
  if (s) queries.push(s);
  return { title, artist, queries: [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= 2))] };
}

/** How well a candidate's names agree with what we know about the file (0–1). */
export function nameScore(cand: { title: string; artist: string }, known: { title?: string | null; artist?: string | null; text?: string }): number {
  const ct = nameWords(cand.title), ca = nameWords(cand.artist);
  const parts: number[] = [];
  if (known.title) parts.push(wordOverlap(nameWords(known.title), ct));
  if (known.artist) parts.push(wordOverlap(nameWords(known.artist), ca));
  if (!parts.length && known.text) {
    const kw = nameWords(known.text);
    parts.push(Math.min(1, (wordOverlap(ct, kw) * 0.6 + wordOverlap(ca, kw) * 0.4) * 1.2));
  }
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

/** "Title - Artist" typed by the owner. */
export function parseTitleArtist(text: string): { title: string; artist: string | null } {
  const parts = text.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.length >= 2 ? { title: parts[0]!, artist: parts.slice(1).join(", ") } : { title: text.trim(), artist: null };
}
