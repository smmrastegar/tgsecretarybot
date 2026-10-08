import { ensureSchema, sql } from "./core";
import { num, numOrNull, str, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type VerifyRow = { trackId: number; status: string; score: number | null; fixes: number; title: string | null; artist: string | null };

/** Ready tracks never checked, or whose file changed since the last check. */
export async function nextTrackToVerify(): Promise<{ id: number; filePath: string; spotifyUrl: string; sizeBytes: number; fixes: number } | null> {
  await ensureSchema();
  const r = (await q().query(
    `SELECT t.id, t.file_path, t.spotify_url, COALESCE(t.size_bytes, 0) AS size_bytes, COALESCE(v.fixes, 0) AS fixes
       FROM music_tracks t LEFT JOIN music_verify v ON v.track_id = t.id
      WHERE t.status = 'ready' AND t.file_path IS NOT NULL
        AND (v.track_id IS NULL OR v.size_bytes IS DISTINCT FROM t.size_bytes OR (v.status = 'error' AND v.checked_at < NOW() - interval '6 hours'))
      ORDER BY (v.track_id IS NOT NULL), t.id LIMIT 1`,
  )) as Row[];
  const x = r[0];
  return x ? { id: num(x, "id"), filePath: str(x, "file_path"), spotifyUrl: str(x, "spotify_url"), sizeBytes: num(x, "size_bytes"), fixes: num(x, "fixes") } : null;
}

export async function saveVerify(trackId: number, status: string, score: number | null, sizeBytes: number, fixes: number): Promise<void> {
  await ensureSchema();
  await q().query(
    `INSERT INTO music_verify (track_id, status, score, size_bytes, fixes, checked_at) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (track_id) DO UPDATE SET status = EXCLUDED.status, score = EXCLUDED.score, size_bytes = EXCLUDED.size_bytes, fixes = EXCLUDED.fixes, checked_at = NOW()`,
    [trackId, status, score, sizeBytes, fixes],
  );
}

export async function listVerify(statuses: string[]): Promise<VerifyRow[]> {
  await ensureSchema();
  const rows = (await q().query(
    `SELECT v.track_id, v.status, v.score, v.fixes, t.title, t.artist FROM music_verify v JOIN music_tracks t ON t.id = v.track_id WHERE v.status = ANY($1::text[]) ORDER BY v.score NULLS FIRST, v.track_id`,
    [statuses],
  )) as Row[];
  return rows.map((r) => ({ trackId: num(r, "track_id"), status: str(r, "status"), score: numOrNull(r, "score"), fixes: num(r, "fixes"), title: str(r, "title") || null, artist: str(r, "artist") || null }));
}

export async function verifyCounts(): Promise<Record<string, number>> {
  await ensureSchema();
  const rows = (await q().query(`SELECT status, COUNT(*)::int AS n FROM music_verify GROUP BY status`)) as Row[];
  return Object.fromEntries(rows.map((r) => [str(r, "status"), num(r, "n")]));
}
