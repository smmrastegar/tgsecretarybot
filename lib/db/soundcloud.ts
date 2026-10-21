import { ensureSchema, sql } from "./core";
import { num, str, strOrNull, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type ScAccount = { id: number; urn: string; username: string | null };

export async function listScAccounts(): Promise<ScAccount[]> {
  await ensureSchema();
  return ((await q().query(`SELECT id, sc_user_urn, username FROM soundcloud_accounts ORDER BY id`)) as Row[]).map((r) => ({ id: num(r, "id"), urn: str(r, "sc_user_urn"), username: strOrNull(r, "username") }));
}

export async function upsertScAccount(urn: string, username: string | null, refreshToken: string, accessToken: string | null, expiresInS: number | null): Promise<number> {
  await ensureSchema();
  const r = (await q().query(
    `INSERT INTO soundcloud_accounts (sc_user_urn, username, refresh_token, access_token, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5::int || ' seconds')::interval)
       ON CONFLICT (sc_user_urn) DO UPDATE SET username = EXCLUDED.username, refresh_token = EXCLUDED.refresh_token, access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at
       RETURNING id`, [urn, username, refreshToken, accessToken, expiresInS ?? 3600])) as Row[];
  return num(r[0]!, "id");
}

export async function getScTokens(id: number): Promise<{ refresh: string; access: string | null; fresh: boolean } | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT refresh_token, access_token, (expires_at IS NOT NULL AND expires_at > NOW() + interval '2 minutes') AS fresh FROM soundcloud_accounts WHERE id = $1`, [id])) as Row[];
  return r[0] ? { refresh: str(r[0], "refresh_token"), access: strOrNull(r[0], "access_token"), fresh: r[0].fresh === true || r[0].fresh === "t" } : null;
}

export async function saveScTokens(id: number, refresh: string | null, access: string, expiresInS: number): Promise<void> {
  await q().query(`UPDATE soundcloud_accounts SET access_token = $2, expires_at = NOW() + ($3::int || ' seconds')::interval, refresh_token = COALESCE($4, refresh_token) WHERE id = $1`, [id, access, expiresInS, refresh]);
}

export async function deleteScAccount(id: number): Promise<void> {
  await ensureSchema();
  await q().query(`DELETE FROM soundcloud_accounts WHERE id = $1`, [id]);
}

export async function savePkce(nonce: string, verifier: string, host: string): Promise<void> {
  await ensureSchema();
  await q().query(`DELETE FROM soundcloud_pkce WHERE expires_at < NOW()`);
  await q().query(`INSERT INTO soundcloud_pkce (nonce, verifier, host, expires_at) VALUES ($1, $2, $3, NOW() + interval '15 minutes')`, [nonce, verifier, host]);
}

export async function takePkce(nonce: string): Promise<{ verifier: string; host: string } | null> {
  await ensureSchema();
  const r = (await q().query(`DELETE FROM soundcloud_pkce WHERE nonce = $1 AND expires_at > NOW() RETURNING verifier, host`, [nonce])) as Row[];
  return r[0] ? { verifier: str(r[0], "verifier"), host: str(r[0], "host") } : null;
}

export type ScTrackIn = { scId: string; title: string; artist: string; url: string; durationS: number | null; coverUrl: string | null; releaseDate: string | null };

/** Queue a SoundCloud song for download; remembers (and respects) songs the owner deleted. */
export async function addScTrack(t: ScTrackIn): Promise<{ id: number | null; created: boolean; removed?: boolean }> {
  await ensureSchema();
  const gone = (await q().query(`SELECT 1 FROM music_removed WHERE spotify_id = $1`, [`sc:${t.scId}`])) as Row[];
  if (gone.length) return { id: null, created: false, removed: true };
  const ins = (await q().query(
    `INSERT INTO music_tracks (spotify_id, spotify_url, title, artist, album, release_date, duration_s, status, source, soundcloud_id, source_cover_url)
     VALUES (NULL, $1, $2, $3, 'Single', $4, $5, 'queued', 'soundcloud', $6, $7) ON CONFLICT (soundcloud_id) WHERE soundcloud_id IS NOT NULL DO NOTHING RETURNING id`,
    [t.url, t.title, t.artist, t.releaseDate, t.durationS, t.scId, t.coverUrl],
  )) as Row[];
  if (ins[0]) return { id: num(ins[0], "id"), created: true };
  const ex = (await q().query(`SELECT id FROM music_tracks WHERE soundcloud_id = $1`, [t.scId])) as Row[];
  return { id: ex[0] ? num(ex[0], "id") : null, created: false };
}

export async function nextScTrack(): Promise<{ id: number; scId: string; coverUrl: string | null } | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT id, soundcloud_id, source_cover_url FROM music_tracks WHERE source = 'soundcloud' AND status = 'queued' ORDER BY id LIMIT 1`)) as Row[];
  return r[0] ? { id: num(r[0], "id"), scId: str(r[0], "soundcloud_id"), coverUrl: strOrNull(r[0], "source_cover_url") } : null;
}

/** Remember that these songs are in this SoundCloud account's likes / lists. */
export async function recordScSources(accountId: number, trackIds: number[]): Promise<void> {
  const ids = [...new Set(trackIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return;
  await ensureSchema();
  await q().query(`INSERT INTO music_track_sc_sources (track_id, account_id) SELECT unnest($1::bigint[]), $2 ON CONFLICT DO NOTHING`, [ids, accountId]);
}

/** SoundCloud accounts as entries of the shared account lists (ids offset by SC_ID_BASE, names marked). */
export async function listScAccountEntries(): Promise<Array<{ id: number; name: string }>> {
  return (await listScAccounts()).map((a) => ({ id: 1_000_000 + a.id, name: `${a.username ?? "SoundCloud"} (SoundCloud)` }));
}

// ---- cleaning the names of SoundCloud songs (see lib/music-resolve.ts)
export type MetaSuggestion = { title: string; artist: string; source: "spotify-track" | "spotify-artist" | "parse"; note?: string };
export type MetaItem = { id: number; title: string; artist: string; origTitle: string | null; origArtist: string | null; state: string; suggestions: MetaSuggestion[]; coverUrl: string | null };

export async function nextScMetaTracks(n: number): Promise<Array<{ id: number; title: string; artist: string }>> {
  await ensureSchema();
  return ((await q().query(`SELECT id, title, artist FROM music_tracks WHERE source = 'soundcloud' AND meta_state = '' ORDER BY id LIMIT $1`, [n])) as Row[])
    .map((r) => ({ id: num(r, "id"), title: str(r, "title"), artist: str(r, "artist") }));
}

/** Save cleaned names; the first time, the upload's own title / uploader are kept as orig_*. */
export async function setTrackMeta(id: number, m: { title?: string; artist?: string; state: string; suggestions?: MetaSuggestion[] | null }): Promise<void> {
  await ensureSchema();
  await q().query(
    `UPDATE music_tracks SET
       orig_title = CASE WHEN orig_title IS NULL AND ($2::text IS NOT NULL OR $3::text IS NOT NULL) THEN title ELSE orig_title END,
       orig_artist = CASE WHEN orig_artist IS NULL AND ($2::text IS NOT NULL OR $3::text IS NOT NULL) THEN artist ELSE orig_artist END,
       title = COALESCE($2, title), artist = COALESCE($3, artist), meta_state = $4, meta_suggestions = $5::jsonb
     WHERE id = $1`,
    [id, m.title ?? null, m.artist ?? null, m.state, m.suggestions ? JSON.stringify(m.suggestions) : null],
  );
}

export async function listScReview(limit = 200): Promise<MetaItem[]> {
  await ensureSchema();
  return ((await q().query(`SELECT id, title, artist, orig_title, orig_artist, meta_state, meta_suggestions FROM music_tracks WHERE source = 'soundcloud' AND meta_state = 'review' ORDER BY id LIMIT $1`, [limit])) as Row[])
    .map((r) => ({ id: num(r, "id"), title: str(r, "title"), artist: str(r, "artist"), origTitle: strOrNull(r, "orig_title"), origArtist: strOrNull(r, "orig_artist"), state: str(r, "meta_state"), suggestions: Array.isArray(r.meta_suggestions) ? (r.meta_suggestions as MetaSuggestion[]) : [], coverUrl: null }));
}

export async function scMetaCounts(): Promise<Record<string, number>> {
  await ensureSchema();
  const out: Record<string, number> = {};
  for (const r of (await q().query(`SELECT meta_state, count(*)::int AS n FROM music_tracks WHERE source = 'soundcloud' GROUP BY meta_state`)) as Row[]) out[str(r, "meta_state") || "new"] = num(r, "n");
  return out;
}

export async function getOrigMeta(id: number): Promise<{ title: string | null; artist: string | null } | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT orig_title, orig_artist FROM music_tracks WHERE id = $1`, [id])) as Row[];
  return r[0] ? { title: strOrNull(r[0], "orig_title"), artist: strOrNull(r[0], "orig_artist") } : null;
}
