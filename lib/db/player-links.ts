import { ensureSchema, sql } from "./core";
import { num, str, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type PlayerLink = { id: number; name: string; token: string; active: boolean; playlistIds: number[]; createdAt: string; lastUsedAt: string | null; canCreate: boolean };

const COLS = `id, name, token, active, playlist_ids, created_at::text AS created_at, last_used_at::text AS last_used_at, can_create_playlists`;
const toLink = (r: Row): PlayerLink => ({
  id: num(r, "id"), name: str(r, "name"), token: str(r, "token"), active: r.active === true || r.active === "t",
  playlistIds: (Array.isArray(r.playlist_ids) ? r.playlist_ids : []).map(Number), createdAt: str(r, "created_at"),
  lastUsedAt: r.last_used_at ? str(r, "last_used_at") : null, canCreate: r.can_create_playlists !== false && r.can_create_playlists !== "f",
});

export async function listPlayerLinks(): Promise<PlayerLink[]> {
  await ensureSchema();
  return ((await q().query(`SELECT ${COLS} FROM player_links ORDER BY id`)) as Row[]).map(toLink);
}

export async function createPlayerLink(name: string, token: string, playlistIds: number[]): Promise<PlayerLink> {
  await ensureSchema();
  const r = (await q().query(
    `INSERT INTO player_links (name, token, playlist_ids) VALUES ($1, $2, $3::bigint[]) RETURNING ${COLS}`,
    [name.slice(0, 80), token, [...new Set(playlistIds.filter(Number.isFinite))]],
  )) as Row[];
  return toLink(r[0]!);
}

/** Rename / (de)activate / reassign playlists. Links are never deleted, only switched off. */
export async function updatePlayerLink(id: number, patch: { name?: string; active?: boolean; playlistIds?: number[]; canCreate?: boolean }): Promise<void> {
  await ensureSchema();
  if (patch.name != null) await q().query(`UPDATE player_links SET name = $2 WHERE id = $1`, [id, patch.name.slice(0, 80)]);
  if (patch.active != null) await q().query(`UPDATE player_links SET active = $2 WHERE id = $1`, [id, patch.active]);
  if (patch.canCreate != null) await q().query(`UPDATE player_links SET can_create_playlists = $2 WHERE id = $1`, [id, patch.canCreate]);
  if (patch.playlistIds) await q().query(`UPDATE player_links SET playlist_ids = $2::bigint[] WHERE id = $1`, [id, [...new Set(patch.playlistIds.filter(Number.isFinite))]]);
}

export async function findActiveLinkByToken(token: string): Promise<PlayerLink | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT ${COLS} FROM player_links WHERE token = $1 AND active = TRUE`, [token])) as Row[];
  return r[0] ? toLink(r[0]) : null;
}

/** Throttled: at most one write per link per minute. */
export async function touchPlayerLink(id: number): Promise<void> {
  await q().query(`UPDATE player_links SET last_used_at = NOW() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - interval '1 minute')`, [id]);
}

/** Add one playlist to a link's set (used when a link builds its own smart playlist). */
export async function addPlaylistToLink(linkId: number, playlistId: number): Promise<void> {
  await q().query(`UPDATE player_links SET playlist_ids = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(playlist_ids || $2::bigint) x)) WHERE id = $1`, [linkId, playlistId]);
}
