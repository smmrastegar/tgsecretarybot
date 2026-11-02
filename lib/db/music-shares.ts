import { ensureSchema, sql } from "./core";
import { num, str, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type MusicShare = { id: number; token: string; kind: "track" | "album" | "list"; title: string; trackIds: number[]; visibility: "public" | "private"; linkId: number; createdAt: string; revoked: boolean; views: number; lastViewedAt: string | null };
const COLS = `id, token, kind, title, track_ids, visibility, link_id, created_at::text AS created_at, revoked, views, last_viewed_at::text AS last_viewed_at`;
const map = (r: Row): MusicShare => ({
  id: num(r, "id"), token: str(r, "token"), kind: r.kind === "album" ? "album" : r.kind === "list" ? "list" : "track", title: str(r, "title"),
  trackIds: (Array.isArray(r.track_ids) ? r.track_ids : []).map(Number), visibility: r.visibility === "private" ? "private" : "public", linkId: num(r, "link_id"),
  createdAt: str(r, "created_at"), revoked: r.revoked === true || r.revoked === "t", views: num(r, "views"), lastViewedAt: r.last_viewed_at ? str(r, "last_viewed_at") : null,
});

export async function createShare(s: { token: string; kind: MusicShare["kind"]; title: string; trackIds: number[]; visibility: MusicShare["visibility"]; linkId: number }): Promise<MusicShare> {
  await ensureSchema();
  const r = (await q().query(
    `INSERT INTO music_shares (token, kind, title, track_ids, visibility, link_id) VALUES ($1, $2, $3, $4::bigint[], $5, $6) RETURNING ${COLS}`,
    [s.token, s.kind, s.title.slice(0, 200), [...new Set(s.trackIds)], s.visibility, s.linkId],
  )) as Row[];
  return map(r[0]!);
}

/** A live (not revoked) share by its token. */
export async function getShare(token: string): Promise<MusicShare | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT ${COLS} FROM music_shares WHERE token = $1 AND revoked = FALSE`, [token])) as Row[];
  return r[0] ? map(r[0]) : null;
}

export async function bumpShareView(id: number): Promise<void> {
  await q().query(`UPDATE music_shares SET views = views + 1, last_viewed_at = NOW() WHERE id = $1`, [id]).catch(() => {});
}

export async function listShares(limit = 200): Promise<MusicShare[]> {
  await ensureSchema();
  return ((await q().query(`SELECT ${COLS} FROM music_shares ORDER BY id DESC LIMIT $1`, [limit])) as Row[]).map(map);
}

export async function revokeShare(id: number): Promise<boolean> {
  await ensureSchema();
  return ((await q().query(`UPDATE music_shares SET revoked = TRUE WHERE id = $1 RETURNING 1`, [id])) as Row[]).length > 0;
}
