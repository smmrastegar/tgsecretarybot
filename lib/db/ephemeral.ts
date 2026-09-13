// Ephemeral (self-deleting) messages.
//
// Telegram has no server-side TTL for bot messages, so we remember what
// we sent and delete it ourselves when the time comes. Two layers:
//   * an in-process timer fires the delete on time (lib/ephemeral.ts);
//   * the per-minute cron sweep (/api/cron/ephemeral) catches anything a
//     restart dropped, so a message never outlives its TTL by more than a
//     minute even if the service bounced.
//
// Rows stay after deletion (deleted_at set) as the audit trail of what
// disappeared and when; the retention cron may prune them later.
import { ensureSchema, hasDb, sql } from "./core";
import { num, numOrNull, str, strOrNull, type Row } from "./row";

export type EphemeralMessage = {
  id: number;
  chatId: number;
  messageId: number;
  deleteAt: string;
  createdAt: string;
  deletedAt: string | null;
  attempts: number;
  lastError: string | null;
  label: string | null;
};

function mapRow(r: Row): EphemeralMessage {
  return {
    id: num(r, "id"),
    chatId: num(r, "chat_id"),
    messageId: num(r, "message_id"),
    deleteAt: str(r, "delete_at"),
    createdAt: str(r, "created_at"),
    deletedAt: strOrNull(r, "deleted_at"),
    attempts: num(r, "attempts"),
    lastError: strOrNull(r, "last_error"),
    label: strOrNull(r, "label"),
  };
}

export async function scheduleEphemeralDelete(input: {
  chatId: number;
  messageId: number;
  ttlSeconds: number;
  label?: string | null;
}): Promise<number> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO ephemeral_messages (chat_id, message_id, delete_at, label)
    VALUES (${input.chatId}, ${input.messageId},
            NOW() + (${input.ttlSeconds} || ' seconds')::INTERVAL,
            ${input.label ?? null})
    RETURNING id`;
  return num(rows[0] as Row, "id");
}

/** Rows whose TTL has elapsed and that are not deleted yet. */
export async function dueEphemeralMessages(limit = 200): Promise<EphemeralMessage[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, chat_id, message_id, delete_at::text, created_at::text,
           deleted_at::text, attempts, last_error, label
      FROM ephemeral_messages
     WHERE deleted_at IS NULL AND delete_at <= NOW() AND attempts < 10
     ORDER BY delete_at ASC
     LIMIT ${limit}`;
  return (rows as Row[]).map(mapRow);
}

export async function getEphemeralMessage(id: number): Promise<EphemeralMessage | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, chat_id, message_id, delete_at::text, created_at::text,
           deleted_at::text, attempts, last_error, label
      FROM ephemeral_messages WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Row | undefined;
  return r ? mapRow(r) : null;
}

export async function markEphemeralDeleted(id: number): Promise<void> {
  await sql()`
    UPDATE ephemeral_messages
       SET deleted_at = NOW(), last_error = NULL
     WHERE id = ${id} AND deleted_at IS NULL`;
}

export async function markEphemeralFailed(id: number, error: string): Promise<void> {
  await sql()`
    UPDATE ephemeral_messages
       SET attempts = attempts + 1, last_error = ${error.slice(0, 500)}
     WHERE id = ${id}`;
}

/** Still-live ephemeral messages, soonest first — for the MCP list tool. */
export async function pendingEphemeralMessages(
  chatId?: number | null,
  limit = 100,
): Promise<Array<EphemeralMessage & { secondsLeft: number | null }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows =
    chatId != null
      ? await sql()`
          SELECT id, chat_id, message_id, delete_at::text, created_at::text,
                 deleted_at::text, attempts, last_error, label,
                 EXTRACT(EPOCH FROM (delete_at - NOW()))::int AS seconds_left
            FROM ephemeral_messages
           WHERE deleted_at IS NULL AND chat_id = ${chatId}
           ORDER BY delete_at ASC LIMIT ${limit}`
      : await sql()`
          SELECT id, chat_id, message_id, delete_at::text, created_at::text,
                 deleted_at::text, attempts, last_error, label,
                 EXTRACT(EPOCH FROM (delete_at - NOW()))::int AS seconds_left
            FROM ephemeral_messages
           WHERE deleted_at IS NULL
           ORDER BY delete_at ASC LIMIT ${limit}`;
  return (rows as Row[]).map((r) => ({
    ...mapRow(r),
    secondsLeft: numOrNull(r, "seconds_left"),
  }));
}
