import { ensureSchema, sql } from "./core";
import { num, str, strOrNull, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type MusicArtist = {
  id: number; spotifyArtistId: string; name: string; imageUrl: string | null; followedAt: string; lastCheckedAt: string | null;
  lastError: string | null; trackCount: number; seenAlbums: string[]; seenKeys: string[];
};

const list = (v: string): string[] => { try { const j = JSON.parse(v) as unknown; return Array.isArray(j) ? j.map(String) : []; } catch { return []; } };

const map = (r: Row): MusicArtist => ({
  id: num(r, "id"), spotifyArtistId: str(r, "spotify_artist_id"), name: str(r, "name"), imageUrl: strOrNull(r, "image_url"),
  followedAt: String(r.followed_at), lastCheckedAt: r.last_checked_at ? String(r.last_checked_at) : null, lastError: strOrNull(r, "last_error"),
  trackCount: num(r, "track_count"), seenAlbums: list(str(r, "seen_albums")), seenKeys: list(str(r, "seen_keys")),
});

export async function listMusicArtists(): Promise<MusicArtist[]> {
  await ensureSchema();
  return ((await q().query(`SELECT * FROM music_artists ORDER BY name`)) as Row[]).map(map);
}

export async function followMusicArtist(spotifyArtistId: string, name: string, imageUrl: string | null): Promise<MusicArtist> {
  await ensureSchema();
  const rows = (await q().query(
    `INSERT INTO music_artists (spotify_artist_id, name, image_url) VALUES ($1, $2, $3)
       ON CONFLICT (spotify_artist_id) DO UPDATE SET name = EXCLUDED.name, image_url = COALESCE(EXCLUDED.image_url, music_artists.image_url)
       RETURNING *`,
    [spotifyArtistId, name.slice(0, 200), imageUrl],
  )) as Row[];
  return map(rows[0]!);
}

export async function unfollowMusicArtist(id: number): Promise<void> {
  await ensureSchema();
  await q().query(`DELETE FROM music_artists WHERE id = $1`, [id]);
}

export async function saveArtistCheck(id: number, p: { seenAlbums: string[]; seenKeys: string[]; trackCount: number; error: string | null }): Promise<void> {
  await ensureSchema();
  await q().query(
    `UPDATE music_artists SET seen_albums = $2, seen_keys = $3, track_count = $4, last_error = $5, last_checked_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(p.seenAlbums), JSON.stringify(p.seenKeys), p.trackCount, p.error],
  );
}
