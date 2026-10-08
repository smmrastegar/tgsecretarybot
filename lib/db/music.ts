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
  /** -1 dislike, 0 neutral, 1 like */
  rating: number;
  playCount: number;
  skipCount: number;
  lastPlayedAt: string | null;
  mime: string | null;
  readyAt: string | null;
  /** total seconds actually listened (music_events) */
  listenSeconds: number;
  /** Spotify's own length of the track, when known */
  spotifyDurationS: number | null;
};

const COLS = `id, spotify_id, spotify_url, title, artist, album, release_date, duration_s,
  (cover_path IS NOT NULL) AS has_cover, status, error, size_bytes, created_at::text AS created_at,
  rating, play_count, skip_count, last_played_at::text AS last_played_at, mime, ready_at::text AS ready_at, spotify_duration_s,
  (SELECT COALESCE(SUM(seconds), 0)::int FROM music_events e WHERE e.track_id = music_tracks.id) AS listen_s`;

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
    rating: num(r, "rating"),
    playCount: num(r, "play_count"),
    skipCount: num(r, "skip_count"),
    lastPlayedAt: strOrNull(r, "last_played_at"),
    mime: strOrNull(r, "mime"),
    readyAt: strOrNull(r, "ready_at"),
    listenSeconds: num(r, "listen_s"),
    spotifyDurationS: numOrNull(r, "spotify_duration_s"),
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
  sizeBytes?: number | null; status?: string; error?: string | null; spotifyDurationS?: number | null;
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
  if (patch.spotifyDurationS !== undefined) set("spotify_duration_s", patch.spotifyDurationS);
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

export async function activeMusicJob(): Promise<{ jobId: number; trackId: number; ageSeconds: number } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Age is computed in SQL: parsing the driver's "…+00" timestamp text in
  // JS gave NaN, which made every in-flight download look stale and was
  // killing the queue's jobs within a minute.
  const rows = (await q().query(
    `SELECT id, music_track_id, EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_s
       FROM link_download_jobs
      WHERE music_track_id IS NOT NULL AND status = 'pending' ORDER BY id ASC LIMIT 1`,
  )) as Row[];
  const r = rows[0];
  return r ? { jobId: num(r, "id"), trackId: num(r, "music_track_id"), ageSeconds: num(r, "age_s") } : null;
}

export async function attachMusicJob(jobId: number, trackId: number): Promise<void> {
  await q().query(`UPDATE link_download_jobs SET music_track_id = $1 WHERE id = $2`, [trackId, jobId]);
}

export type MusicPlaylist = { id: number; name: string; trackIds: number[]; rules: Record<string, unknown> | null };

export async function listMusicPlaylists(): Promise<MusicPlaylist[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const pls = (await q().query(`SELECT id, name, rules FROM music_playlists ORDER BY id`)) as Row[];
  const links = (await q().query(`SELECT playlist_id, track_id FROM music_playlist_tracks ORDER BY playlist_id, position, track_id`)) as Row[];
  return pls.map((p) => ({
    id: num(p, "id"),
    name: str(p, "name"),
    trackIds: links.filter((l) => num(l, "playlist_id") === num(p, "id")).map((l) => num(l, "track_id")),
    rules: (p.rules && typeof p.rules === "object" ? p.rules : typeof p.rules === "string" ? JSON.parse(p.rules) : null) as Record<string, unknown> | null,
  }));
}

export async function createMusicPlaylist(name: string, rules?: Record<string, unknown> | null): Promise<number> {
  await ensureSchema();
  const rows = (await q().query(`INSERT INTO music_playlists (name, rules) VALUES ($1, $2::jsonb) RETURNING id`, [name.slice(0, 100), rules ? JSON.stringify(rules) : null])) as Row[];
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

export type SpotifyAccount = { id: number; spotifyUserId: string; displayName: string | null };

export async function listSpotifyAccounts(): Promise<SpotifyAccount[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = (await q().query(`SELECT id, spotify_user_id, display_name FROM spotify_accounts ORDER BY id`)) as Row[];
  return rows.map((r) => ({ id: num(r, "id"), spotifyUserId: str(r, "spotify_user_id"), displayName: strOrNull(r, "display_name") }));
}

export async function upsertSpotifyAccount(spotifyUserId: string, name: string | null, refreshToken: string): Promise<number> {
  await ensureSchema();
  const rows = (await q().query(
    `INSERT INTO spotify_accounts (spotify_user_id, display_name, refresh_token) VALUES ($1, $2, $3)
       ON CONFLICT (spotify_user_id) DO UPDATE SET display_name = EXCLUDED.display_name, refresh_token = EXCLUDED.refresh_token
       RETURNING id`,
    [spotifyUserId, name, refreshToken],
  )) as Row[];
  return num(rows[0]!, "id");
}

export async function getSpotifyRefreshToken(id: number): Promise<string | null> {
  await ensureSchema();
  const rows = (await q().query(`SELECT refresh_token FROM spotify_accounts WHERE id = $1`, [id])) as Row[];
  return rows[0] ? str(rows[0], "refresh_token") : null;
}

export async function setSpotifyRefreshToken(id: number, token: string): Promise<void> {
  await q().query(`UPDATE spotify_accounts SET refresh_token = $1 WHERE id = $2`, [token, id]);
}

export async function deleteSpotifyAccount(id: number): Promise<void> {
  await q().query(`DELETE FROM spotify_accounts WHERE id = $1`, [id]);
}

/** Put every failed track back in the queue; returns how many. */
export async function requeueFailedTracks(): Promise<number> {
  await ensureSchema();
  const rows = (await q().query(
    `UPDATE music_tracks SET status = 'queued', error = NULL WHERE status = 'failed' RETURNING id`,
  )) as Row[];
  return rows.length;
}

export async function rateMusicTrack(id: number, rating: number): Promise<void> {
  const r = rating > 0 ? 1 : rating < 0 ? -1 : 0;
  await q().query(`UPDATE music_tracks SET rating = $1 WHERE id = $2`, [r, id]);
}


/**
 * One listening session of a track. A "play" is counted when at least
 * 30 s were heard or the track completed; a "skip" when it was left
 * before 30% without completing. Seconds are logged either way.
 */
export async function recordListen(id: number, seconds: number, durationS: number, completed: boolean): Promise<void> {
  const sec = Math.max(0, Math.min(Math.round(seconds), 6 * 3600));
  if (sec === 0 && !completed) return;
  const skipped = !completed && durationS > 0 && sec / durationS < 0.3;
  const counted = completed || sec >= 30;
  await q().query(`INSERT INTO music_events (track_id, seconds, completed, skipped) VALUES ($1, $2, $3, $4)`, [id, sec, completed, skipped]);
  if (counted) await q().query(`UPDATE music_tracks SET play_count = play_count + 1, last_played_at = NOW() WHERE id = $1`, [id]);
  if (skipped) await q().query(`UPDATE music_tracks SET skip_count = skip_count + 1 WHERE id = $1`, [id]);
}

export type MusicStats = {
  totals: { tracks: number; plays: number; listenSeconds: number; likes: number; dislikes: number; skips: number };
  topTracks: Array<{ id: number; title: string | null; artist: string | null; plays: number; skips: number; listenSeconds: number; hasCover: boolean }>;
  topArtists: Array<{ artist: string; plays: number; listenSeconds: number; tracks: number }>;
  days: Array<{ day: string; minutes: number; plays: number }>;
  recent: Array<{ id: number; title: string | null; artist: string | null; at: string; seconds: number; completed: boolean }>;
};

export async function getMusicStats(trackIds?: number[] | null): Promise<MusicStats> {
  await ensureSchema();
  // A player link only sees stats for its own songs.
  const P = trackIds ? [trackIds] : [];
  const W = (col: string, first = false) => (trackIds ? ` ${first ? "WHERE" : "AND"} ${col} = ANY($1::bigint[])` : "");
  const one = async (sqlText: string): Promise<Row> => ((await q().query(sqlText, P)) as Row[])[0] ?? {};
  const t = await one(`SELECT COUNT(*) FILTER (WHERE status='ready')::int AS tracks,
      COALESCE(SUM(play_count),0)::int AS plays, COALESCE(SUM(skip_count),0)::int AS skips,
      COUNT(*) FILTER (WHERE rating > 0)::int AS likes, COUNT(*) FILTER (WHERE rating < 0)::int AS dislikes
    FROM music_tracks${W("id", true)}`);
  const l = await one(`SELECT COALESCE(SUM(seconds),0)::int AS s FROM music_events${W("track_id", true)}`);
  const top = (await q().query(`
    SELECT t.id, t.title, t.artist, t.play_count, t.skip_count, (t.cover_path IS NOT NULL) AS has_cover,
           COALESCE((SELECT SUM(seconds) FROM music_events e WHERE e.track_id = t.id), 0)::int AS listen_s
      FROM music_tracks t WHERE (t.play_count > 0 OR t.skip_count > 0)${W("t.id")}
     ORDER BY t.play_count DESC, listen_s DESC LIMIT 15`, P)) as Row[];
  const artists = (await q().query(`
    SELECT t.artist, SUM(t.play_count)::int AS plays, COUNT(*)::int AS tracks,
           COALESCE(SUM((SELECT SUM(seconds) FROM music_events e WHERE e.track_id = t.id)), 0)::int AS listen_s
      FROM music_tracks t WHERE t.artist IS NOT NULL AND t.play_count > 0${W("t.id")}
     GROUP BY t.artist ORDER BY plays DESC, listen_s DESC LIMIT 10`, P)) as Row[];
  const days = (await q().query(`
    SELECT to_char(d::date, 'MM-DD') AS day,
           COALESCE(SUM(e.seconds), 0)::int AS sec, COUNT(e.id) FILTER (WHERE e.completed OR e.seconds >= 30)::int AS plays
      FROM generate_series((NOW() AT TIME ZONE 'Asia/Tehran')::date - 13, (NOW() AT TIME ZONE 'Asia/Tehran')::date, '1 day') d
      LEFT JOIN music_events e ON (e.at AT TIME ZONE 'Asia/Tehran')::date = d::date${W("e.track_id")}
     GROUP BY d ORDER BY d`, P)) as Row[];
  const recent = (await q().query(`
    SELECT t.id, t.title, t.artist, to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, e.seconds, e.completed
      FROM music_events e JOIN music_tracks t ON t.id = e.track_id${W("e.track_id", true)} ORDER BY e.id DESC LIMIT 15`, P)) as Row[];
  return {
    totals: { tracks: num(t, "tracks"), plays: num(t, "plays"), listenSeconds: num(l, "s"), likes: num(t, "likes"), dislikes: num(t, "dislikes"), skips: num(t, "skips") },
    topTracks: top.map((r) => ({ id: num(r, "id"), title: strOrNull(r, "title"), artist: strOrNull(r, "artist"), plays: num(r, "play_count"), skips: num(r, "skip_count"), listenSeconds: num(r, "listen_s"), hasCover: r.has_cover === true || r.has_cover === "t" })),
    topArtists: artists.map((r) => ({ artist: str(r, "artist"), plays: num(r, "plays"), listenSeconds: num(r, "listen_s"), tracks: num(r, "tracks") })),
    days: days.map((r) => ({ day: str(r, "day"), minutes: Math.round(num(r, "sec") / 60), plays: num(r, "plays") })),
    recent: recent.map((r) => ({ id: num(r, "id"), title: strOrNull(r, "title"), artist: strOrNull(r, "artist"), at: str(r, "at"), seconds: num(r, "seconds"), completed: r.completed === true || r.completed === "t" })),
  };
}

export type TrackHistory = {
  days: Array<{ day: string; minutes: number; plays: number }>;
  sessions: Array<{ at: string; seconds: number; completed: boolean; skipped: boolean }>;
  firstPlayedAt: string | null;
  completions: number;
};

export async function getTrackHistory(id: number): Promise<TrackHistory> {
  await ensureSchema();
  const days = (await q().query(
    `SELECT to_char(d::date, 'MM-DD') AS day, COALESCE(SUM(e.seconds), 0)::int AS sec,
            COUNT(e.id) FILTER (WHERE e.completed OR e.seconds >= 30)::int AS plays
       FROM generate_series((NOW() AT TIME ZONE 'Asia/Tehran')::date - 13, (NOW() AT TIME ZONE 'Asia/Tehran')::date, '1 day') d
       LEFT JOIN music_events e ON e.track_id = $1 AND (e.at AT TIME ZONE 'Asia/Tehran')::date = d::date
      GROUP BY d ORDER BY d`, [id])) as Row[];
  const sessions = (await q().query(
    `SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, seconds, completed, skipped
       FROM music_events WHERE track_id = $1 ORDER BY id DESC LIMIT 12`, [id])) as Row[];
  const agg = ((await q().query(
    `SELECT to_char(MIN(at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS first, COUNT(*) FILTER (WHERE completed)::int AS done
       FROM music_events WHERE track_id = $1`, [id])) as Row[])[0] ?? {};
  return {
    days: days.map((r) => ({ day: str(r, "day"), minutes: Math.round(num(r, "sec") / 60 * 10) / 10, plays: num(r, "plays") })),
    sessions: sessions.map((r) => ({ at: str(r, "at"), seconds: num(r, "seconds"), completed: r.completed === true || r.completed === "t", skipped: r.skipped === true || r.skipped === "t" })),
    firstPlayedAt: strOrNull(agg, "first"),
    completions: num(agg, "done"),
  };
}

export async function renameMusicPlaylist(id: number, name: string): Promise<void> {
  await q().query(`UPDATE music_playlists SET name = $1 WHERE id = $2`, [name.slice(0, 100), id]);
}

/** Add (or remove) many tracks at once, keeping the existing order. */
export async function setPlaylistTracks(playlistId: number, trackIds: number[], present: boolean): Promise<number> {
  const ids = [...new Set(trackIds.filter((n) => Number.isFinite(n)))].slice(0, 5000);
  if (ids.length === 0) return 0;
  if (!present) {
    await q().query(`DELETE FROM music_playlist_tracks WHERE playlist_id = $1 AND track_id = ANY($2::bigint[])`, [playlistId, ids]);
    return ids.length;
  }
  await q().query(
    `INSERT INTO music_playlist_tracks (playlist_id, track_id, position)
       SELECT $1, t.id, COALESCE((SELECT MAX(position) FROM music_playlist_tracks WHERE playlist_id = $1), -1) + row_number() OVER (ORDER BY ord)
         FROM unnest($2::bigint[]) WITH ORDINALITY AS u(id, ord)
         JOIN music_tracks t ON t.id = u.id
       ON CONFLICT DO NOTHING`,
    [playlistId, ids],
  );
  return ids.length;
}

/** Everything the verifier needs about a track. */
export type MetaRow = { id: number; spotifyId: string; status: string; durationS: number | null; spotifyDurationS: number | null; sizeBytes: number | null; filePath: string | null; coverPath: string | null };

export async function listTracksForMeta(): Promise<MetaRow[]> {
  await ensureSchema();
  const rows = (await q().query(`SELECT id, spotify_id, status, duration_s, spotify_duration_s, size_bytes, file_path, cover_path FROM music_tracks WHERE spotify_id IS NOT NULL ORDER BY id`)) as Row[];
  return rows.map((r) => ({ id: num(r, "id"), spotifyId: str(r, "spotify_id"), status: str(r, "status"), durationS: numOrNull(r, "duration_s"), spotifyDurationS: numOrNull(r, "spotify_duration_s"), sizeBytes: numOrNull(r, "size_bytes"), filePath: strOrNull(r, "file_path"), coverPath: strOrNull(r, "cover_path") }));
}

/** A failed "Track not found" track that spotDL has not been tried on yet. */
export async function nextSpotdlCandidate(): Promise<number | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT id FROM music_tracks WHERE status = 'failed' AND error LIKE 'Track not found%' AND error NOT LIKE '%spotDL%' ORDER BY id LIMIT 1`)) as Row[];
  return r[0] ? num(r[0], "id") : null;
}

// ---- problem reports ----

export const REPORT_REASONS: Record<string, string> = {
  wrong_song: "Wrong song / different audio",
  wrong_cover: "Wrong or missing cover",
  wrong_info: "Wrong title or artist",
  bad_quality: "Bad sound quality",
  cut_off: "Cuts off, too short or too long",
  wont_play: "Won't play / keeps stalling",
  glitches: "Skips, clicks or glitches",
  wrong_lyrics: "Wrong lyrics",
  other: "Something else",
};

export type MusicReport = {
  id: number; trackId: number; trackTitle: string | null; reasons: string[]; note: string | null;
  context: Record<string, unknown> | null; status: string; createdAt: string; resolvedAt: string | null;
};

export async function addMusicReport(trackId: number, reasons: string[], note: string, context: Record<string, unknown>): Promise<number> {
  await ensureSchema();
  const t = await getMusicTrack(trackId);
  const clean = [...new Set(reasons.filter((r) => r in REPORT_REASONS))].slice(0, 9);
  const rows = (await q().query(
    `INSERT INTO music_reports (track_id, track_title, reasons, note, context) VALUES ($1, $2, $3::text[], $4, $5::jsonb) RETURNING id`,
    [trackId, t ? `${t.title ?? "?"} — ${t.artist ?? ""}`.slice(0, 200) : null, clean, note.slice(0, 1000) || null, JSON.stringify(context).slice(0, 4000)],
  )) as Row[];
  return num(rows[0]!, "id");
}

export async function listMusicReports(status?: string): Promise<MusicReport[]> {
  await ensureSchema();
  const rows = (await q().query(
    `SELECT id, track_id, track_title, reasons, note, context, status, created_at::text AS created_at, resolved_at::text AS resolved_at
       FROM music_reports ${status ? "WHERE status = $1" : ""} ORDER BY id DESC LIMIT 200`,
    status ? [status] : [],
  )) as Row[];
  return rows.map((r) => ({
    id: num(r, "id"), trackId: num(r, "track_id"), trackTitle: strOrNull(r, "track_title"),
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [], note: strOrNull(r, "note"),
    context: (r.context && typeof r.context === "object" ? r.context : null) as Record<string, unknown> | null,
    status: str(r, "status"), createdAt: str(r, "created_at"), resolvedAt: strOrNull(r, "resolved_at"),
  }));
}

export async function setMusicReportStatus(id: number, status: "open" | "resolved"): Promise<void> {
  await ensureSchema();
  await q().query(`UPDATE music_reports SET status = $2, resolved_at = ${status === "resolved" ? "NOW()" : "NULL"} WHERE id = $1`, [id, status]);
}
