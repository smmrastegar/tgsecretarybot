import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "./config.js";

export type UrgentRecord = {
  businessConnectionId: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderId: number | null;
  senderName: string;
  messageId: number;
  messageText: string;
  importance: number;
  reason: string;
};

let sqlClient: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql(): NeonQueryFunction<false, false> | null {
  if (!config.databaseUrl) return null;
  if (!sqlClient) sqlClient = neon(config.databaseUrl);
  return sqlClient;
}

async function ensureSchema(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS urgent_messages (
        id                     BIGSERIAL PRIMARY KEY,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        business_connection_id TEXT        NOT NULL,
        chat_id                BIGINT      NOT NULL,
        chat_type              TEXT        NOT NULL,
        chat_title             TEXT,
        sender_id              BIGINT,
        sender_name            TEXT        NOT NULL,
        message_id             BIGINT      NOT NULL,
        message_text           TEXT        NOT NULL,
        importance             INT         NOT NULL,
        reason                 TEXT        NOT NULL DEFAULT ''
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS urgent_messages_created_at_idx
        ON urgent_messages (created_at DESC)
    `;
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

export async function recordUrgentMessage(r: UrgentRecord): Promise<void> {
  const sql = getSql();
  if (!sql) {
    console.log("[db] DATABASE_URL not set; skipping insert.");
    return;
  }
  await ensureSchema(sql);
  await sql`
    INSERT INTO urgent_messages (
      business_connection_id, chat_id, chat_type, chat_title,
      sender_id, sender_name, message_id, message_text,
      importance, reason
    ) VALUES (
      ${r.businessConnectionId}, ${r.chatId}, ${r.chatType}, ${r.chatTitle},
      ${r.senderId}, ${r.senderName}, ${r.messageId}, ${r.messageText},
      ${r.importance}, ${r.reason}
    )
  `;
}
