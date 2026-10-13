import { ensureSchema, sql } from "./core";
import { num, str, strOrNull, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type MusicPin = { id: number; label: string; pin: string; active: boolean; userId: number; username: string | null; firstName: string | null; createdAt: string; lastUsedAt: string | null; accountIds: number[]; accountsMode: "any" | "all" };

const COLS = `id, label, pin, active, user_id, username, first_name, created_at::text AS created_at, last_used_at::text AS last_used_at, account_ids, accounts_mode`;
const map = (r: Row): MusicPin => ({
  id: num(r, "id"), label: str(r, "label"), pin: str(r, "pin"), active: r.active === true || r.active === "t", userId: num(r, "user_id"),
  username: strOrNull(r, "username"), firstName: strOrNull(r, "first_name"), createdAt: str(r, "created_at"), lastUsedAt: strOrNull(r, "last_used_at"),
  accountIds: (Array.isArray(r.account_ids) ? r.account_ids : []).map(Number), accountsMode: r.accounts_mode === "all" ? "all" : "any",
});

export async function listMusicPins(): Promise<MusicPin[]> {
  await ensureSchema();
  return ((await q().query(`SELECT ${COLS} FROM music_pins ORDER BY id`)) as Row[]).map(map);
}

export async function createMusicPin(pin: string, label: string, owner: { userId: number; username: string | null; firstName: string | null }): Promise<MusicPin | null> {
  await ensureSchema();
  const r = (await q().query(
    `INSERT INTO music_pins (pin, label, user_id, username, first_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (pin) DO NOTHING RETURNING ${COLS}`,
    [pin, label.slice(0, 60), owner.userId, owner.username, owner.firstName],
  )) as Row[];
  return r[0] ? map(r[0]) : null; // null: that number is already one of the passwords
}

export async function updateMusicPin(id: number, patch: { active?: boolean; label?: string; pin?: string; accountIds?: number[]; accountsMode?: "any" | "all" }): Promise<boolean> {
  await ensureSchema();
  try {
    if (patch.active != null) await q().query(`UPDATE music_pins SET active = $2 WHERE id = $1`, [id, patch.active]);
    if (patch.label != null) await q().query(`UPDATE music_pins SET label = $2 WHERE id = $1`, [id, patch.label.slice(0, 60)]);
    if (patch.accountIds) await q().query(`UPDATE music_pins SET account_ids = $2::bigint[] WHERE id = $1`, [id, [...new Set(patch.accountIds.filter((n) => Number.isFinite(n) && n >= 0))]]);
    if (patch.accountsMode) await q().query(`UPDATE music_pins SET accounts_mode = $2 WHERE id = $1`, [id, patch.accountsMode === "all" ? "all" : "any"]);
    if (patch.pin != null) await q().query(`UPDATE music_pins SET pin = $2 WHERE id = $1`, [id, patch.pin]);
    return true;
  } catch { return false; } // unique violation: the number is taken
}

export async function deleteMusicPin(id: number): Promise<void> {
  await ensureSchema();
  await q().query(`DELETE FROM music_pins WHERE id = $1`, [id]);
}

export async function touchMusicPin(id: number): Promise<void> {
  await q().query(`UPDATE music_pins SET last_used_at = NOW() WHERE id = $1`, [id]);
}
