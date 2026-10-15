// Finding out what a hand-sent audio file is: Spotify first, then public catalogues (iTunes, Deezer) for the covers and names
// of songs Spotify does not have, and — when a token is configured — AudD's audio recognition, which can name a song from a
// short fragment of it.
import { promises as fs } from "node:fs";
import { getAllSettings } from "./db";
import { searchSpotifyTracks } from "./spotify";

export type Candidate = {
  source: "spotify" | "itunes" | "deezer" | "audd" | "tags";
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  durationS: number | null;
  spotifyId: string | null;
  previewUrl: string | null;
  /** cover pictures to offer, best first: image URLs, or "embedded" for the picture inside the file */
  covers: string[];
  /** 0–1 similarity of the file's audio to this candidate's 30 s preview (null: not checked / no preview) */
  audio: number | null;
  /** 0–1 agreement of the names with what the file / its name says */
  name: number;
};

const UA = "Mozilla/5.0 (compatible; tgsecretarybot-music/1.0)";
const getJson = async <T>(url: string, ms = 15_000): Promise<T | null> => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
};

export async function lookupSpotify(query: string): Promise<Candidate[]> {
  const items = await searchSpotifyTracks(query);
  return items.map((m) => ({
    source: "spotify" as const, title: m.title, artist: m.artist, album: m.album, releaseDate: m.releaseDate, durationS: m.durationS,
    spotifyId: m.id, previewUrl: null, covers: m.coverUrl ? [m.coverUrl] : [], audio: null, name: 0,
  }));
}

export async function lookupItunes(query: string): Promise<Candidate[]> {
  const j = await getJson<{ results?: Array<{ trackName?: string; artistName?: string; collectionName?: string; releaseDate?: string; trackTimeMillis?: number; artworkUrl100?: string; previewUrl?: string }> }>(
    `https://itunes.apple.com/search?entity=song&limit=6&term=${encodeURIComponent(query)}`);
  return (j?.results ?? []).filter((r) => r.trackName && r.artistName).map((r) => ({
    source: "itunes" as const, title: r.trackName!, artist: r.artistName!, album: (r.collectionName ?? "").replace(/\s+-\s+(Single|EP)$/i, "") || null,
    releaseDate: r.releaseDate?.slice(0, 10) ?? null, durationS: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null, spotifyId: null,
    previewUrl: r.previewUrl ?? null, covers: r.artworkUrl100 ? [r.artworkUrl100.replace(/\/\d+x\d+bb\./, "/1000x1000bb.")] : [], audio: null, name: 0,
  }));
}

export async function lookupDeezer(query: string): Promise<Candidate[]> {
  const j = await getJson<{ data?: Array<{ title?: string; duration?: number; preview?: string; artist?: { name?: string }; album?: { title?: string; cover_xl?: string; cover_big?: string } }> }>(
    `https://api.deezer.com/search?limit=6&q=${encodeURIComponent(query)}`);
  return (j?.data ?? []).filter((r) => r.title && r.artist?.name).map((r) => ({
    source: "deezer" as const, title: r.title!, artist: r.artist!.name!, album: r.album?.title ?? null, releaseDate: null, durationS: r.duration ?? null,
    spotifyId: null, previewUrl: r.preview ?? null, covers: [r.album?.cover_xl ?? r.album?.cover_big].filter((x): x is string => !!x), audio: null, name: 0,
  }));
}

/** Audio recognition (works on short fragments). Only when settings.auddToken is set; returns [] otherwise or on any failure. */
export async function recognizeAudd(file: string): Promise<Candidate[]> {
  const token = ((await getAllSettings()).auddToken ?? "").trim();
  if (!token) return [];
  try {
    const buf = await fs.readFile(file);
    if (buf.length > 18 * 1024 * 1024) return [];
    const form = new FormData();
    form.append("api_token", token);
    form.append("return", "spotify,apple_music,deezer");
    form.append("file", new Blob([new Uint8Array(buf)]), "clip.mp3");
    const r = await fetch("https://api.audd.io/", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    const j = (await r.json()) as { status?: string; result?: null | { title?: string; artist?: string; album?: string; release_date?: string; spotify?: { id?: string; duration_ms?: number; album?: { images?: Array<{ url: string }> } }; apple_music?: { artwork?: { url?: string }; previews?: Array<{ url?: string }> }; deezer?: { preview?: string } } };
    const x = j.result;
    if (j.status !== "success" || !x?.title || !x.artist) return [];
    const covers = [x.spotify?.album?.images?.[0]?.url, x.apple_music?.artwork?.url?.replace("{w}", "1000").replace("{h}", "1000")].filter((c): c is string => !!c);
    return [{ source: "audd", title: x.title, artist: x.artist, album: x.album ?? null, releaseDate: x.release_date ?? null, durationS: x.spotify?.duration_ms ? Math.round(x.spotify.duration_ms / 1000) : null,
      spotifyId: x.spotify?.id ?? null, previewUrl: x.apple_music?.previews?.[0]?.url ?? x.deezer?.preview ?? null, covers, audio: null, name: 1 }];
  } catch { return []; }
}
