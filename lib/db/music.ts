// Personal music library: tracks, playlists. See lib/music.ts for the
// download / storage side.
import { ensureSchema, hasDb, sql } from "./core";
import { num, numOrNull, str, strOrNull, type Row } from "./row";

export type MusicTrack = {
  id: number;
  spotifyId: string | null;
  spotifyUrl: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  releaseDate: string | null;
  durationS: number | null;
  hasCover: boolean;
  status: "queued" | "downloading" | "ready" | "failed";
  error: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

const COLS = `id, spotify_id, spotify_url, title, artist, album, release_date, duration_s,
  (cover_path IS NOT NULL) AS has_cover, status, error, size_bytes, created_at::text AS created_at`;

function map(r: Row): MusicTrack {
  const status = str(r, "status");
  return {
    id: num(r, "id"),
    spotifyId: strOrNull(r, "spotify_id"),
    spotifyUrl: str(r, "spotify_url"),
    title: strOrNull(r, "title"),
    artist: strOrNull(r, "artist"),
    album: strOrNull(r, "album"),
    releaseDate: strOrNull(r, "release_date"),
    durationS: numOrNull(r, "duration_s"),
    hasCover: r.has_cover === true || r.has_cover === "t",
    status: (["queued", "downloading", "ready", "failed"].includes(status) ? status : "queued") as MusicTrack["status"],
    error: strOrNull(r, "error"),
    sizeBytes: numOrNull(r, "size_bytes"),
    createdAt: str(r, "created_at"),
  };
}

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export function parseSpotifyTrackUrl(raw: string): { id: string; url: string } | null {
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{10,30})/.exec(raw);
  return m ? { id: m[1]!, url: `https://open.spotify.com/track/${m[1]}` } : null;
}

export async function listMusicTracks(): Promise<MusicTrack[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = (await q().query(`SELECT ${COLS} FROM music_tracks ORDER BY created_at DESC LIMIT 2000`)) as Row[];
  return rows.map(map);
}

export async function getMusicTrack(id: number): Promise<(MusicTrack & { filePath: string | null; coverPath: string | null; mime: string | null }) | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = (await q().query(`SELECT ${COLS}, file_path, cover_path, mime FROM music_tracks WHERE id = $1`, [id])) as Row[];
  const r = rows[0];
  if (!r) return null;
  return { ...map(r), filePath: strOrNull(r, "file_path"), coverPath: strOrNull(r, "cover_path"), mime: strOrNull(r, "mime") };
}

/** Insert a queued track unless the spotify id is already known. */
export async function addMusicTrack(spotifyId: string, url: string): Promise<{ track: MusicTrack; created: boolean }> {
  await ensureSchema();
  const ins = (await q().query(
    `INSERT INTO music_tracks (spotify_id, spotify_url) VALUES ($1, $2)
       ON CONFLICT (spotify_id) DO NOTHING RETURNING ${COLS}`,
    [spotifyId, url],
  )) as Row[];
  if (ins[0]) return { track: map(ins[0]), created: true };
  const ex = (await q().query(`SELECT ${COLS} FROM music_tracks WHERE spotify_id = $1`, [spotifyId])) as Row[];
  return { track: map(ex[0]!), created: false };
}

export async function updateMusicTrack(id: number, patch: {
  title?: string | null; artist?: string | null; album?: string | null; releaseDate?: string | null;
  durationS?: number | null; filePath?: string | null; coverPath?: string | null; mime?: string | null;
  sizeBytes?: number | null; status?: string; error?: string | null;
}): Promise<void> {
  const sets: string[] = []; const params: unknown[] = [];
  const set = (c: string, v: unknown) => { params.push(v); sets.push(`${c} = $${params.length}`); };
  if (patch.title !== undefined) set("title", patch.title);
  if (patch.artist !== undefined) set("artist", patch.artist);
  if (patch.album !== undefined) set("album", patch.album);
  if (patch.releaseDate !== undefined) set("release_date", patch.releaseDate);
  if (patch.durationS !== undefined) set("duration_s", patch.durationS);
  if (patch.filePath !== undefined) set("file_path", patch.filePath);
  if (patch.coverPath !== undefined) set("cover_path", patch.coverPath);
  if (patch.mime !== undefined) set("mime", patch.mime);
  if (patch.sizeBytes !== undefined) set("size_bytes", patch.sizeBytes);
  if (patch.error !== undefined) set("error", patch.error);
  if (patch.status !== undefined) {
    set("status", patch.status);
    if (patch.status === "ready") sets.push("ready_at = NOW()");
  }
  if (sets.length === 0) return;
  params.push(id);
  await q().query(`UPDATE music_tracks SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function deleteMusicTrack(id: number): Promise<{ filePath: string | null; coverPath: string | null } | null> {
  const t = await getMusicTrack(id);
  if (!t) return null;
  await q().query(`DELETE FROM music_tracks WHERE id = $1`, [id]);
  return { filePath: t.filePath, coverPath: t.coverPath };
}

export async function nextQueuedTrack(): Promise<MusicTrack | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = (await q().query(`SELECT ${COLS} FROM music_tracks WHERE status = 'queued' ORDER BY id ASC LIMIT 1`)) as Row[];
  return rows[0] ? map(rows[0]) : null;
}

export async function activeMusicJob(): Promise<{ jobId: number; trackId: number; createdAt: string } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = (await q().query(
    `SELECT id, music_track_id, created_at::text AS created_at FROM link_download_jobs
      WHERE music_track_id IS NOT NULL AND status = 'pending' ORDER BY id ASC LIMIT 1`,
  )) as Row[];
  const r = rows[0];
  return r ? { jobId: num(r, "id"), trackId: num(r, "music_track_id"), createdAt: str(r, "created_at") } : null;
}

export async function attachMusicJob(jobId: number, trackId: number): Promise<void> {
  await q().query(`UPDATE link_download_jobs SET music_track_id = $1 WHERE id = $2`, [trackId, jobId]);
}

export type MusicPlaylist = { id: number; name: string; trackIds: number[] };

export async function listMusicPlaylists(): Promise<MusicPlaylist[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const pls = (await q().query(`SELECT id, name FROM music_playlists ORDER BY id`)) as Row[];
  const links = (await q().query(`SELECT playlist_id, track_id FROM music_playlist_tracks ORDER BY playlist_id, position, track_id`)) as Row[];
  return pls.map((p) => ({
    id: num(p, "id"),
    name: str(p, "name"),
    trackIds: links.filter((l) => num(l, "playlist_id") === num(p, "id")).map((l) => num(l, "track_id")),
  }));
}

export async function createMusicPlaylist(name: string): Promise<number> {
  await ensureSchema();
  const rows = (await q().query(`INSERT INTO music_playlists (name) VALUES ($1) RETURNING id`, [name.slice(0, 100)])) as Row[];
  return num(rows[0]!, "id");
}

export async function deleteMusicPlaylist(id: number): Promise<void> {
  await q().query(`DELETE FROM music_playlists WHERE id = $1`, [id]);
}

export async function setPlaylistTrack(playlistId: number, trackId: number, present: boolean): Promise<void> {
  if (present) {
    await q().query(
      `INSERT INTO music_playlist_tracks (playlist_id, track_id, position)
         VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM music_playlist_tracks WHERE playlist_id = $1), 0))
         ON CONFLICT DO NOTHING`,
      [playlistId, trackId],
    );
  } else {
    await q().query(`DELETE FROM music_playlist_tracks WHERE playlist_id = $1 AND track_id = $2`, [playlistId, trackId]);
  }
}
