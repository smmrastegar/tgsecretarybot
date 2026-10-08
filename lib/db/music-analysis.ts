import { ensureSchema, sql } from "./core";
import { num, numOrNull, str, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type TrackFeatures = {
  trackId: number; vec: number[]; bpm: number; key: string; mode: string; energy: number; brightness: number; beat: number;
  rms: number; flux: number; centroid: number;
};

export async function saveFeatures(trackId: number, f: { vec: number[]; bpm: number; key: string; mode: string; energy: number; brightness: number; beat: number; rms: number; flux: number; centroid: number }, version: number): Promise<void> {
  await ensureSchema();
  await q().query(
    `INSERT INTO music_features (track_id, features, bpm, key_name, mode, energy, brightness, beat, error, version, analyzed_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, NULL, $9, NOW())
     ON CONFLICT (track_id) DO UPDATE SET features = EXCLUDED.features, bpm = EXCLUDED.bpm, key_name = EXCLUDED.key_name, mode = EXCLUDED.mode,
       energy = EXCLUDED.energy, brightness = EXCLUDED.brightness, beat = EXCLUDED.beat, error = NULL, version = EXCLUDED.version, analyzed_at = NOW()`,
    [trackId, JSON.stringify({ vec: f.vec, rms: f.rms, flux: f.flux, centroid: f.centroid }), f.bpm, f.key, f.mode, f.energy, f.brightness, f.beat, version],
  );
}

export async function saveFeatureError(trackId: number, error: string, version: number): Promise<void> {
  await ensureSchema();
  await q().query(
    `INSERT INTO music_features (track_id, error, version) VALUES ($1, $2, $3)
     ON CONFLICT (track_id) DO UPDATE SET error = EXCLUDED.error, version = EXCLUDED.version, analyzed_at = NOW()`,
    [trackId, error.slice(0, 300), version],
  );
}

/** Oldest ready track with no (current-version) analysis; failed ones are retried after a day. */
export async function nextTrackToAnalyze(version: number): Promise<{ id: number; filePath: string } | null> {
  await ensureSchema();
  const r = (await q().query(
    `SELECT t.id, t.file_path FROM music_tracks t
       LEFT JOIN music_features f ON f.track_id = t.id
      WHERE t.status = 'ready' AND t.file_path IS NOT NULL
        AND (f.track_id IS NULL OR (f.version < $1) OR (f.error IS NOT NULL AND f.analyzed_at < NOW() - interval '1 day'))
      ORDER BY (f.track_id IS NOT NULL), t.id LIMIT 1`,
    [version],
  )) as Row[];
  return r[0] ? { id: num(r[0], "id"), filePath: str(r[0], "file_path") } : null;
}

export async function listFeatures(): Promise<TrackFeatures[]> {
  await ensureSchema();
  const rows = (await q().query(`SELECT track_id, features, bpm, key_name, mode, energy, brightness, beat FROM music_features WHERE features IS NOT NULL AND error IS NULL`)) as Row[];
  return rows.map((r) => {
    const f = (typeof r.features === "string" ? JSON.parse(r.features) : r.features) as { vec: number[]; rms?: number; flux?: number; centroid?: number };
    return { trackId: num(r, "track_id"), vec: f.vec, bpm: num(r, "bpm"), key: str(r, "key_name"), mode: str(r, "mode"), energy: num(r, "energy"), brightness: num(r, "brightness"), beat: numOrNull(r, "beat") ?? 0, rms: f.rms ?? 0, flux: f.flux ?? 0, centroid: f.centroid ?? 0 };
  });
}

export async function analysisProgress(): Promise<{ ready: number; analyzed: number; failed: number; genres: number }> {
  await ensureSchema();
  const r = (await q().query(`SELECT
      (SELECT COUNT(*) FROM music_tracks WHERE status = 'ready')::int AS ready,
      (SELECT COUNT(*) FROM music_features WHERE error IS NULL AND features IS NOT NULL)::int AS analyzed,
      (SELECT COUNT(*) FROM music_features WHERE error IS NOT NULL)::int AS failed,
      (SELECT COUNT(*) FROM music_track_genres WHERE cardinality(genres) > 0)::int AS genres`)) as Row[];
  return { ready: num(r[0]!, "ready"), analyzed: num(r[0]!, "analyzed"), failed: num(r[0]!, "failed"), genres: num(r[0]!, "genres") };
}

// ---- genres ----

export async function nextTracksForGenres(limit: number): Promise<Array<{ id: number; spotifyId: string }>> {
  await ensureSchema();
  const rows = (await q().query(
    `SELECT t.id, t.spotify_id FROM music_tracks t LEFT JOIN music_track_genres g ON g.track_id = t.id
      WHERE t.status = 'ready' AND t.spotify_id IS NOT NULL AND g.track_id IS NULL ORDER BY t.id LIMIT $1`, [limit],
  )) as Row[];
  return rows.map((r) => ({ id: num(r, "id"), spotifyId: str(r, "spotify_id") }));
}

export async function saveGenres(trackId: number, genres: string[], artists: string[]): Promise<void> {
  await ensureSchema();
  await q().query(
    `INSERT INTO music_track_genres (track_id, genres, artists, fetched_at) VALUES ($1, $2::text[], $3::text[], NOW())
     ON CONFLICT (track_id) DO UPDATE SET genres = EXCLUDED.genres, artists = EXCLUDED.artists, fetched_at = NOW()`,
    [trackId, genres.slice(0, 12), artists.slice(0, 6)],
  );
}

export async function listGenres(): Promise<Map<number, string[]>> {
  await ensureSchema();
  const rows = (await q().query(`SELECT track_id, genres FROM music_track_genres WHERE cardinality(genres) > 0`)) as Row[];
  return new Map(rows.map((r) => [num(r, "track_id"), (Array.isArray(r.genres) ? r.genres : []) as string[]]));
}


