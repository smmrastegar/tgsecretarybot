import { ensureSchema, sql } from "./core";
import { num, str, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type PlayerLink = { id: number; name: string; token: string; active: boolean; playlistIds: number[]; createdAt: string; lastUsedAt: string | null; canCreate: boolean; accountIds: number[]; accountsMode: "any" | "all"; canLikeSpotify: boolean; canEdit: boolean; allLibrary: boolean; tgUserId: number | null; tgLabel: string | null; approval: "pending" | "approved" | "denied" };

const COLS = `id, name, token, active, playlist_ids, created_at::text AS created_at, last_used_at::text AS last_used_at, can_create_playlists, account_ids, accounts_mode, can_like_spotify, can_edit, all_library, tg_user_id, tg_label, approval`;
const toLink = (r: Row): PlayerLink => ({
  id: num(r, "id"), name: str(r, "name"), token: str(r, "token"), active: r.active === true || r.active === "t",
  playlistIds: (Array.isArray(r.playlist_ids) ? r.playlist_ids : []).map(Number), createdAt: str(r, "created_at"),
  lastUsedAt: r.last_used_at ? str(r, "last_used_at") : null, canCreate: r.can_create_playlists !== false && r.can_create_playlists !== "f",
  accountIds: (Array.isArray(r.account_ids) ? r.account_ids : []).map(Number), accountsMode: r.accounts_mode === "all" ? "all" : "any", canLikeSpotify: r.can_like_spotify === true || r.can_like_spotify === "t", canEdit: r.can_edit === true || r.can_edit === "t",
  allLibrary: r.all_library === true || r.all_library === "t", tgUserId: r.tg_user_id == null ? null : Number(r.tg_user_id), tgLabel: r.tg_label ? str(r, "tg_label") : null,
  approval: r.approval === "pending" ? "pending" : r.approval === "denied" ? "denied" : "approved",
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
export async function updatePlayerLink(id: number, patch: { name?: string; active?: boolean; playlistIds?: number[]; canCreate?: boolean; accountIds?: number[]; accountsMode?: "any" | "all"; canLikeSpotify?: boolean; canEdit?: boolean; allLibrary?: boolean; approval?: "pending" | "approved" | "denied" }): Promise<void> {
  await ensureSchema();
  if (patch.name != null) await q().query(`UPDATE player_links SET name = $2 WHERE id = $1`, [id, patch.name.slice(0, 80)]);
  if (patch.active != null) await q().query(`UPDATE player_links SET active = $2 WHERE id = $1`, [id, patch.active]);
  if (patch.canCreate != null) await q().query(`UPDATE player_links SET can_create_playlists = $2 WHERE id = $1`, [id, patch.canCreate]);
  if (patch.canLikeSpotify != null) await q().query(`UPDATE player_links SET can_like_spotify = $2 WHERE id = $1`, [id, patch.canLikeSpotify]);
  if (patch.canEdit != null) await q().query(`UPDATE player_links SET can_edit = $2 WHERE id = $1`, [id, patch.canEdit]);
  if (patch.approval) await q().query(`UPDATE player_links SET approval = $2, active = $3 WHERE id = $1`, [id, patch.approval, patch.approval === "approved"]);
  if (patch.allLibrary != null) await q().query(`UPDATE player_links SET all_library = $2 WHERE id = $1`, [id, patch.allLibrary]);
  if (patch.accountIds) await q().query(`UPDATE player_links SET account_ids = $2::bigint[] WHERE id = $1`, [id, [...new Set(patch.accountIds.filter((n) => Number.isFinite(n) && n >= 0))]]);
  if (patch.accountsMode) await q().query(`UPDATE player_links SET accounts_mode = $2 WHERE id = $1`, [id, patch.accountsMode === "all" ? "all" : "any"]);
  if (patch.playlistIds) await q().query(`UPDATE player_links SET playlist_ids = $2::bigint[] WHERE id = $1`, [id, [...new Set(patch.playlistIds.filter(Number.isFinite))]]);
}

export async function getPlayerLink(id: number): Promise<PlayerLink | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT ${COLS} FROM player_links WHERE id = $1`, [id])) as Row[];
  return r[0] ? toLink(r[0]) : null;
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

/** The link a Telegram account got when it signed in (null the first time). */
export async function findLinkByTgUser(tgUserId: number): Promise<PlayerLink | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT ${COLS} FROM player_links WHERE tg_user_id = $1`, [tgUserId])) as Row[];
  return r[0] ? toLink(r[0]) : null;
}

/** A new link request for a Telegram account: switched off and empty until the owner approves it; account scope and the like right are copied from the Main link. Safe to call twice at once (the unique index decides). */
export async function createTgLink(tgUserId: number, label: string, token: string, copy: { canLike: boolean; accountIds: number[]; accountsMode: "any" | "all" }): Promise<{ link: PlayerLink; created: boolean }> {
  await ensureSchema();
  const ins = (await q().query(
    `INSERT INTO player_links (name, token, active, approval, playlist_ids, all_library, tg_user_id, tg_label, can_edit, can_like_spotify, account_ids, accounts_mode)
     VALUES ($1, $2, FALSE, 'pending', '{}', FALSE, $3, $4, FALSE, $5, $6::bigint[], $7) ON CONFLICT DO NOTHING RETURNING ${COLS}`,
    [label.slice(0, 80), token, tgUserId, label.slice(0, 120), copy.canLike, copy.accountIds, copy.accountsMode],
  )) as Row[];
  if (ins[0]) return { link: toLink(ins[0]), created: true };
  return { link: (await findLinkByTgUser(tgUserId))!, created: false };
}
