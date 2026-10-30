import { ensureSchema, sql } from "./core";
import { num, numOrNull, str, strOrNull, type Row } from "./row";

function q() {
  return sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown[]> };
}

export type IntakeStatus = "new" | "analyzing" | "pending" | "confirmed" | "rejected" | "failed" | "upload" | "bigwait";
export type IntakeRow = {
  id: number; chatId: number; messageId: number; fileId: string; fileName: string | null; fileSize: number | null; durationS: number | null;
  tgTitle: string | null; tgPerformer: string | null; status: IntakeStatus; candidates: unknown[]; idx: number; coverIdx: number;
  localPath: string | null; coverPath: string | null; tags: { title?: string | null; artist?: string | null; album?: string | null; date?: string | null } | null;
  cardChat: number | null; cardMessageId: number | null; trackId: number | null; error: string | null;
  /** "audio" (a song file) or "voice" (a short clip to identify) */
  kind: "audio" | "voice";
  /** the same file as seen by the large-file bot (local Bot API server) */
  bigFileId: string | null;
};

const map = (r: Row): IntakeRow => ({
  id: num(r, "id"), chatId: num(r, "chat_id"), messageId: num(r, "message_id"), fileId: str(r, "file_id"), fileName: strOrNull(r, "file_name"),
  fileSize: numOrNull(r, "file_size"), durationS: numOrNull(r, "duration_s"), tgTitle: strOrNull(r, "tg_title"), tgPerformer: strOrNull(r, "tg_performer"),
  status: str(r, "status") as IntakeStatus, candidates: Array.isArray(r.candidates) ? (r.candidates as unknown[]) : [], idx: num(r, "idx"), coverIdx: num(r, "cover_idx"),
  localPath: strOrNull(r, "local_path"), coverPath: strOrNull(r, "cover_path"), tags: (r.tags as IntakeRow["tags"]) ?? null,
  cardChat: numOrNull(r, "card_chat"), cardMessageId: numOrNull(r, "card_message_id"), trackId: numOrNull(r, "track_id"), error: strOrNull(r, "error"), kind: str(r, "kind") === "voice" ? "voice" : "audio", bigFileId: strOrNull(r, "big_file_id"),
});

export async function insertIntake(a: { chatId: number; messageId: number; fileId: string; fileName: string | null; fileSize: number | null; durationS: number | null; tgTitle: string | null; tgPerformer: string | null; kind?: "audio" | "voice" }): Promise<number | null> {
  await ensureSchema();
  const r = (await q().query(
    `INSERT INTO music_intake (chat_id, message_id, file_id, file_name, file_size, duration_s, tg_title, tg_performer, kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (chat_id, message_id) DO NOTHING RETURNING id`,
    [a.chatId, a.messageId, a.fileId, a.fileName, a.fileSize, a.durationS, a.tgTitle, a.tgPerformer, a.kind ?? "audio"],
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

/** Songs the bot could not download (over Telegram's 20 MB limit): they wait here until the file is uploaded by hand. */
export async function listUploadWaiting(): Promise<IntakeRow[]> {
  await ensureSchema();
  return ((await q().query(`SELECT * FROM music_intake WHERE status = 'upload' ORDER BY id`)) as Row[]).map(map);
}

/** Titles / artists of waiting items can be corrected before the file arrives. */
export async function setWaitingNames(id: number, title: string, artist: string): Promise<void> {
  await ensureSchema();
  await q().query(`UPDATE music_intake SET tags = $2::jsonb, updated_at = NOW() WHERE id = $1 AND status = 'upload'`, [id, JSON.stringify({ title, artist, upload: true })]);
}

export async function saveIntakePhoto(chatId: number, messageId: number, fileId: string): Promise<void> {
  await ensureSchema();
  await q().query(`INSERT INTO music_intake_photos (chat_id, message_id, file_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [chatId, messageId, fileId]);
}

/** The photo posted in the channel shortly BEFORE this intake message (an album cover sent ahead of its songs). */
export async function photoBeforeIntake(intakeId: number, withinMinutes = 30): Promise<{ messageId: number; fileId: string } | null> {
  await ensureSchema();
  const r = (await q().query(
    `SELECT p.message_id, p.file_id FROM music_intake_photos p JOIN music_intake i ON i.id = $1 AND p.chat_id = i.chat_id AND p.message_id < i.message_id
      WHERE p.created_at > i.created_at - make_interval(mins => $2) ORDER BY p.message_id DESC LIMIT 1`, [intakeId, withinMinutes])) as Row[];
  return r[0] ? { messageId: num(r[0], "message_id"), fileId: str(r[0], "file_id") } : null;
}

/** The large-file bot saw a channel post: the row of the main bot (waiting) gets its file id and is analysed; a post the main bot missed becomes a new row. */
export async function attachBigFile(a: { chatId: number; messageId: number; fileId: string; fileName: string | null; fileSize: number | null; durationS: number | null; tgTitle: string | null; tgPerformer: string | null }): Promise<number | null> {
  await ensureSchema();
  const up = (await q().query(
    `UPDATE music_intake SET big_file_id = $3, status = 'new', error = NULL, updated_at = NOW()
      WHERE chat_id = $1 AND message_id = $2 AND status IN ('upload', 'bigwait', 'failed') AND big_file_id IS NULL RETURNING id`, [a.chatId, a.messageId, a.fileId])) as Row[];
  if (up[0]) return num(up[0], "id");
  const ins = (await q().query(
    `INSERT INTO music_intake (chat_id, message_id, file_id, big_file_id, file_name, file_size, duration_s, tg_title, tg_performer, kind)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, 'audio') ON CONFLICT (chat_id, message_id) DO NOTHING RETURNING id`,
    [a.chatId, a.messageId, a.fileId, a.fileName, a.fileSize, a.durationS, a.tgTitle, a.tgPerformer])) as Row[];
  return ins[0] ? num(ins[0], "id") : null;
}

/** Rows the main bot parked for the large-file bot that it never delivered (not an admin of the channel yet…): after 10 minutes they wait for a hand upload. */
export async function expireBigWait(): Promise<number[]> {
  await ensureSchema();
  return ((await q().query(`UPDATE music_intake SET status = 'upload', updated_at = NOW() WHERE status = 'bigwait' AND updated_at < NOW() - interval '10 minutes' RETURNING id`)) as Row[]).map((r) => num(r, "id"));
}
