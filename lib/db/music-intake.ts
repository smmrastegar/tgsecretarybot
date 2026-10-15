import { ensureSchema, sql } from "./core";
import { num, numOrNull, str, strOrNull, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type IntakeStatus = "new" | "analyzing" | "pending" | "confirmed" | "rejected" | "failed";
export type IntakeRow = {
  id: number; chatId: number; messageId: number; fileId: string; fileName: string | null; fileSize: number | null; durationS: number | null;
  tgTitle: string | null; tgPerformer: string | null; status: IntakeStatus; candidates: unknown[]; idx: number; coverIdx: number;
  localPath: string | null; coverPath: string | null; tags: { title?: string | null; artist?: string | null; album?: string | null; date?: string | null } | null;
  cardChat: number | null; cardMessageId: number | null; trackId: number | null; error: string | null;
};

const map = (r: Row): IntakeRow => ({
  id: num(r, "id"), chatId: num(r, "chat_id"), messageId: num(r, "message_id"), fileId: str(r, "file_id"), fileName: strOrNull(r, "file_name"),
  fileSize: numOrNull(r, "file_size"), durationS: numOrNull(r, "duration_s"), tgTitle: strOrNull(r, "tg_title"), tgPerformer: strOrNull(r, "tg_performer"),
  status: str(r, "status") as IntakeStatus, candidates: Array.isArray(r.candidates) ? (r.candidates as unknown[]) : [], idx: num(r, "idx"), coverIdx: num(r, "cover_idx"),
  localPath: strOrNull(r, "local_path"), coverPath: strOrNull(r, "cover_path"), tags: (r.tags as IntakeRow["tags"]) ?? null,
  cardChat: numOrNull(r, "card_chat"), cardMessageId: numOrNull(r, "card_message_id"), trackId: numOrNull(r, "track_id"), error: strOrNull(r, "error"),
});

export async function insertIntake(a: { chatId: number; messageId: number; fileId: string; fileName: string | null; fileSize: number | null; durationS: number | null; tgTitle: string | null; tgPerformer: string | null }): Promise<number | null> {
  await ensureSchema();
  const r = (await q().query(
    `INSERT INTO music_intake (chat_id, message_id, file_id, file_name, file_size, duration_s, tg_title, tg_performer)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (chat_id, message_id) DO NOTHING RETURNING id`,
    [a.chatId, a.messageId, a.fileId, a.fileName, a.fileSize, a.durationS, a.tgTitle, a.tgPerformer],
  )) as Row[];
  return r[0] ? num(r[0], "id") : null;
}

/** Take the oldest new item (and give back ones stuck "analyzing" for 10 minutes). */
export async function claimNextIntake(): Promise<IntakeRow | null> {
  await ensureSchema();
  await q().query(`UPDATE music_intake SET status = 'new' WHERE status = 'analyzing' AND updated_at < NOW() - interval '10 minutes'`);
  const r = (await q().query(
    `UPDATE music_intake SET status = 'analyzing', updated_at = NOW()
      WHERE id = (SELECT id FROM music_intake WHERE status = 'new' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
  )) as Row[];
  return r[0] ? map(r[0]) : null;
}

export async function getIntake(id: number): Promise<IntakeRow | null> {
  await ensureSchema();
  const r = (await q().query(`SELECT * FROM music_intake WHERE id = $1`, [id])) as Row[];
  return r[0] ? map(r[0]) : null;
}

export async function updateIntake(id: number, patch: Partial<{ status: IntakeStatus; candidates: unknown[]; idx: number; coverIdx: number; localPath: string | null; coverPath: string | null; tags: unknown; cardChat: number | null; cardMessageId: number | null; trackId: number | null; error: string | null }>): Promise<void> {
  const sets: string[] = ["updated_at = NOW()"]; const params: unknown[] = [id];
  const set = (c: string, v: unknown, cast = "") => { params.push(v); sets.push(`${c} = $${params.length}${cast}`); };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.candidates !== undefined) set("candidates", JSON.stringify(patch.candidates), "::jsonb");
  if (patch.idx !== undefined) set("idx", patch.idx);
  if (patch.coverIdx !== undefined) set("cover_idx", patch.coverIdx);
  if (patch.localPath !== undefined) set("local_path", patch.localPath);
  if (patch.coverPath !== undefined) set("cover_path", patch.coverPath);
  if (patch.tags !== undefined) set("tags", JSON.stringify(patch.tags), "::jsonb");
  if (patch.cardChat !== undefined) set("card_chat", patch.cardChat);
  if (patch.cardMessageId !== undefined) set("card_message_id", patch.cardMessageId);
  if (patch.trackId !== undefined) set("track_id", patch.trackId);
  if (patch.error !== undefined) set("error", patch.error);
  await ensureSchema();
  await q().query(`UPDATE music_intake SET ${sets.join(", ")} WHERE id = $1`, params);
}
