import { addMusicTrack, ensureSpotifyPlaylist, followMusicArtist, getAllSettings, listMusicArtists, saveArtistCheck, setPlaylistTrack, setSetting, type MusicArtist } from "@/lib/db";
import { getBot } from "@/lib/bot";
import { kickMusicQueue } from "@/lib/music";
import { reportInfo, reportWarn } from "@/lib/report";
import { catalogGet, SpotifyRateLimited } from "@/lib/spotify";
import { getSettings } from "@/lib/settings";

// Follow an artist: their albums and singles are read from Spotify's catalogue, every song is queued
// for download and put into a "🎤 <artist>" library playlist, and the list is re-read periodically so a
// new release is brought in (and announced on Telegram) on its own. Songs the owner deleted stay
// deleted (addMusicTrack refuses them).
export const ARTIST_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type Img = { url: string; width?: number };
export type ArtistHit = { id: string; name: string; followers: number; imageUrl: string | null; genres: string[] };

const smallImage = (imgs?: Img[]): string | null => [...(imgs ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((i) => (i.width ?? 0) >= 64)?.url ?? imgs?.[0]?.url ?? null;

export async function searchArtists(query: string): Promise<ArtistHit[]> {
  const j = await catalogGet<{ artists?: { items?: Array<{ id: string; name: string; followers?: { total?: number }; images?: Img[]; genres?: string[] }> } }>(
    `/search?q=${encodeURIComponent(query.slice(0, 100))}&type=artist&limit=8`);
  return (j.artists?.items ?? []).map((a) => ({ id: a.id, name: a.name, followers: a.followers?.total ?? 0, imageUrl: smallImage(a.images), genres: a.genres ?? [] }));
}

/** Same song released twice (single, then album) → same key: the title without bracketed "feat." notes and punctuation. Versions (Remix, Live…) keep their own key. */
export function trackKey(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\((feat|ft|with)[^)]*\)|\[(feat|ft|with)[^\]]*\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

type Album = { id: string; name: string; release_date?: string; album_group?: string };
type AlbumTrack = { id: string | null; name: string; duration_ms: number; is_local?: boolean };

async function pages<T>(first: string, max: number): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = first;
  while (next && out.length < max) {
    const j: { items: T[]; next: string | null } = await catalogGet(next);
    out.push(...j.items);
    next = j.next;
  }
  return out;
}

export type CheckResult = { albums: number; added: number; known: number; titles: string[]; error?: string };

/**
 * Read the artist's albums + singles; import the songs of releases not seen before.
 * `importExisting: false` (follow "from now on") only records what already exists and imports nothing.
 */
export async function checkArtist(a: MusicArtist, importExisting = true): Promise<CheckResult> {
  const res: CheckResult = { albums: 0, added: 0, known: 0, titles: [] };
  const seenAlbums = new Set(a.seenAlbums), seenKeys = new Set(a.seenKeys);
  try {
    const albums = await pages<Album>(`/artists/${a.spotifyArtistId}/albums?include_groups=album,single&limit=50`, 300);
    const fresh = albums.filter((al) => !seenAlbums.has(al.id)).sort((x, y) => (x.release_date ?? "").localeCompare(y.release_date ?? ""));
    const plId = await ensureSpotifyPlaylist(0, `artist:${a.spotifyArtistId}`, `🎤 ${a.name}`, a.name);
    for (const al of fresh) {
      res.albums++;
      if (importExisting) {
        const tracks = await pages<AlbumTrack>(`/albums/${al.id}/tracks?limit=50`, 200);
        for (const t of tracks) {
          if (!t.id || t.is_local) continue;
          const key = trackKey(t.name);
          if (seenKeys.has(key)) { res.known++; continue; }
          seenKeys.add(key);
          const r = await addMusicTrack(t.id, `https://open.spotify.com/track/${t.id}`);
          if (r.removed) continue;
          if (r.track) await setPlaylistTrack(plId, r.track.id, true);
          if (r.created) { res.added++; res.titles.push(t.name); }
        }
      }
      seenAlbums.add(al.id);
    }
    await saveArtistCheck(a.id, { seenAlbums: [...seenAlbums], seenKeys: [...seenKeys], trackCount: seenKeys.size, error: null });
    if (res.added > 0) await kickMusicQueue().catch(() => {});
  } catch (e) {
    const msg = e instanceof SpotifyRateLimited ? `rate limited (${e.retryAfterSeconds}s)` : e instanceof Error ? e.message : String(e);
    res.error = msg.slice(0, 200);
    // keep what was learned so far; just record the error
    await saveArtistCheck(a.id, { seenAlbums: [...seenAlbums], seenKeys: [...seenKeys], trackCount: seenKeys.size, error: res.error });
  }
  return res;
}

export async function followAndCheck(artist: { id: string; name: string; imageUrl: string | null }, importExisting: boolean): Promise<CheckResult> {
  const row = await followMusicArtist(artist.id, artist.name, artist.imageUrl);
  return checkArtist(row, importExisting);
}

async function announce(a: MusicArtist, r: CheckResult): Promise<void> {
  const chat = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  if (!chat) return;
  const shown = r.titles.slice(0, 12).map((t) => `• ${t}`).join("\n") + (r.titles.length > 12 ? `\n… و ${r.titles.length - 12} آهنگ دیگر` : "");
  await getBot().api.sendMessage(chat, `🎤 ${a.name}: ${r.titles.length} آهنگ جدید پیدا شد و در صف دانلود است\n${shown}`).catch(() => {});
}

/** Cron step: re-read every followed artist that is due; announce anything new. */
export async function artistWatchStep(force = false): Promise<{ artists: number; added: number; errors: string[] }> {
  const out = { artists: 0, added: 0, errors: [] as string[] };
  const lock = Number((await getAllSettings()).musicArtistsLock || 0);
  if (Date.now() - lock < 10 * 60_000) return out; // another run is still going
  const all = await listMusicArtists();
  const dueList = all.filter((a) => force || !a.lastCheckedAt || Date.now() - new Date(a.lastCheckedAt.replace(" ", "T")).getTime() > ARTIST_CHECK_EVERY_MS);
  if (dueList.length === 0) return out;
  await setSetting("musicArtistsLock", String(Date.now()));
  try {
    for (const a of dueList) {
      out.artists++;
      const r = await checkArtist(a, true);
      out.added += r.added;
      if (r.error) { out.errors.push(`${a.name}: ${r.error}`); reportWarn("music", `artist watch ${a.name}: ${r.error}`); if (/rate limited/.test(r.error)) break; }
      else if (r.added > 0) { reportInfo("music", `artist watch: ${r.added} new song(s) by ${a.name}`); await announce(a, r); }
    }
  } finally { await setSetting("musicArtistsLock", "0"); }
  return out;
}
