import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "./config";

let cached: NeonQueryFunction<false, false> | null = null;
let schemaPromise: Promise<void> | null = null;

export function hasDb(): boolean {
  return Boolean(config.databaseUrl);
}

export function sql(): NeonQueryFunction<false, false> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!cached) cached = neon(config.databaseUrl);
  return cached;
}

export async function ensureSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const q = sql();
    await q`
      CREATE TABLE IF NOT EXISTS business_connections (
        id            TEXT PRIMARY KEY,
        user_id       BIGINT NOT NULL,
        user_chat_id  BIGINT NOT NULL,
        username      TEXT,
        first_name    TEXT,
        last_name     TEXT,
        can_reply     BOOLEAN NOT NULL DEFAULT FALSE,
        is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS messages_log (
        id                     BIGSERIAL PRIMARY KEY,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        business_connection_id TEXT NOT NULL,
        owner_user_id          BIGINT,
        chat_id                BIGINT NOT NULL,
        chat_type              TEXT NOT NULL,
        chat_title             TEXT,
        sender_id              BIGINT,
        sender_username        TEXT,
        sender_name            TEXT NOT NULL,
        message_id             BIGINT NOT NULL,
        message_text           TEXT NOT NULL,
        importance             INT NOT NULL DEFAULT 0,
        urgent                 BOOLEAN NOT NULL DEFAULT FALSE,
        concerns_owner         BOOLEAN NOT NULL DEFAULT FALSE,
        reason                 TEXT NOT NULL DEFAULT '',
        alerted                BOOLEAN NOT NULL DEFAULT FALSE,
        auto_replied           BOOLEAN NOT NULL DEFAULT FALSE,
        handled_at             TIMESTAMPTZ,
        handled_by             BIGINT,
        notes                  TEXT
      )`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_created_idx ON messages_log (created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_chat_idx ON messages_log (chat_id, created_at DESC)`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_urgent_idx ON messages_log (urgent, created_at DESC) WHERE urgent = TRUE`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS from_owner BOOLEAN NOT NULL DEFAULT FALSE`;
    await q`ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS skipped_reason TEXT`;
    await q`CREATE INDEX IF NOT EXISTS messages_log_owner_chat_idx ON messages_log (chat_id, created_at DESC) WHERE from_owner = TRUE`;
    await q`
      CREATE TABLE IF NOT EXISTS chat_rules (
        chat_id      BIGINT PRIMARY KEY,
        chat_type    TEXT NOT NULL,
        chat_title   TEXT,
        vip          BOOLEAN NOT NULL DEFAULT FALSE,
        muted        BOOLEAN NOT NULL DEFAULT FALSE,
        custom_reply TEXT,
        notes        TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT
      )`;
    await q`
      CREATE TABLE IF NOT EXISTS group_summaries (
        id                     BIGSERIAL PRIMARY KEY,
        chat_id                BIGINT NOT NULL,
        chat_title             TEXT,
        business_connection_id TEXT NOT NULL,
        period_start           TIMESTAMPTZ NOT NULL,
        period_end             TIMESTAMPTZ NOT NULL,
        message_count          INT NOT NULL,
        active_senders         INT NOT NULL,
        summary                TEXT NOT NULL,
        topics                 JSONB NOT NULL DEFAULT '[]',
        action_items           JSONB NOT NULL DEFAULT '[]',
        mentions_owner         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (chat_id, period_start)
      )`;
    await q`CREATE INDEX IF NOT EXISTS group_summaries_chat_idx ON group_summaries (chat_id, period_start DESC)`;
    await q`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          BIGSERIAL PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_id    BIGINT,
        actor_name  TEXT,
        action      TEXT NOT NULL,
        target      TEXT,
        details     JSONB
      )`;
    await q`CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC)`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_sessions (
        id                     BIGSERIAL PRIMARY KEY,
        business_connection_id TEXT    NOT NULL,
        sender_chat_id         BIGINT  NOT NULL,
        sender_name            TEXT,
        sender_username        TEXT,
        secretary_user_id      BIGINT  NOT NULL,
        secretary_chat_id      BIGINT  NOT NULL,
        header_message_id      BIGINT  NOT NULL,
        owner_user_id          BIGINT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_activity_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at               TIMESTAMPTZ,
        end_reason             TEXT
      )`;
    await q`CREATE INDEX IF NOT EXISTS secretary_sessions_active_idx
      ON secretary_sessions (business_connection_id, sender_chat_id)
      WHERE ended_at IS NULL`;
    await q`
      CREATE TABLE IF NOT EXISTS secretary_message_links (
        id                  BIGSERIAL PRIMARY KEY,
        session_id          BIGINT NOT NULL REFERENCES secretary_sessions(id) ON DELETE CASCADE,
        secretary_chat_id   BIGINT NOT NULL,
        secretary_message_id BIGINT NOT NULL,
        direction           TEXT   NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (secretary_chat_id, secretary_message_id)
      )`;
    await q`ALTER TABLE secretary_message_links ADD COLUMN IF NOT EXISTS sender_message_id BIGINT`;
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

// --- Business connections ---

export async function upsertBusinessConnection(args: {
  id: string;
  userId: number;
  userChatId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  canReply: boolean;
  isEnabled: boolean;
}): Promise<void> {
  await ensureSchema();
  const q = sql();
  await q`
    INSERT INTO business_connections (
      id, user_id, user_chat_id, username, first_name, last_name,
      can_reply, is_enabled, updated_at
    ) VALUES (
      ${args.id}, ${args.userId}, ${args.userChatId},
      ${args.username ?? null}, ${args.firstName ?? null}, ${args.lastName ?? null},
      ${args.canReply}, ${args.isEnabled}, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      user_chat_id = EXCLUDED.user_chat_id,
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      can_reply = EXCLUDED.can_reply,
      is_enabled = EXCLUDED.is_enabled,
      updated_at = NOW()`;
}

export async function getBusinessConnection(
  id: string,
): Promise<{ userId: number; userChatId: number; canReply: boolean } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT user_id, user_chat_id, can_reply
    FROM business_connections WHERE id = ${id} AND is_enabled = TRUE LIMIT 1`;
  const r = rows[0] as { user_id: string; user_chat_id: string; can_reply: boolean } | undefined;
  if (!r) return null;
  return {
    userId: Number(r.user_id),
    userChatId: Number(r.user_chat_id),
    canReply: r.can_reply,
  };
}

export async function listBusinessConnections(): Promise<BusinessConnectionRow[]> {
  await ensureSchema();
  const rows = await sql()`
    SELECT id, user_id, user_chat_id, username, first_name, last_name,
           can_reply, is_enabled, created_at, updated_at
    FROM business_connections ORDER BY updated_at DESC`;
  return rows.map((r) => ({
    id: r.id as string,
    userId: Number(r.user_id),
    userChatId: Number(r.user_chat_id),
    username: r.username as string | null,
    firstName: r.first_name as string | null,
    lastName: r.last_name as string | null,
    canReply: r.can_reply as boolean,
    isEnabled: r.is_enabled as boolean,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  }));
}

export type BusinessConnectionRow = {
  id: string;
  userId: number;
  userChatId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  canReply: boolean;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function isAllowedUser(userId: number): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM business_connections WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

// --- Messages log ---

export type LogMessage = {
  businessConnectionId: string;
  ownerUserId: number | null;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderId: number | null;
  senderUsername: string | null;
  senderName: string;
  messageId: number;
  messageText: string;
  importance: number;
  urgent: boolean;
  concernsOwner: boolean;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  fromOwner?: boolean;
  skippedReason?: string | null;
};

export async function logMessage(m: LogMessage): Promise<number> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO messages_log (
      business_connection_id, owner_user_id, chat_id, chat_type, chat_title,
      sender_id, sender_username, sender_name, message_id, message_text,
      importance, urgent, concerns_owner, reason, alerted, auto_replied,
      from_owner, skipped_reason
    ) VALUES (
      ${m.businessConnectionId}, ${m.ownerUserId}, ${m.chatId}, ${m.chatType}, ${m.chatTitle},
      ${m.senderId}, ${m.senderUsername}, ${m.senderName}, ${m.messageId}, ${m.messageText},
      ${m.importance}, ${m.urgent}, ${m.concernsOwner}, ${m.reason}, ${m.alerted}, ${m.autoReplied},
      ${m.fromOwner ?? false}, ${m.skippedReason ?? null}
    ) RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

export async function lastOwnerMessageAt(chatId: number): Promise<Date | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT MAX(created_at) AS at FROM messages_log
    WHERE chat_id = ${chatId} AND from_owner = TRUE`;
  const r = rows[0] as { at: Date | null } | undefined;
  return r?.at ?? null;
}

export type MessageRow = {
  id: number;
  createdAt: Date;
  businessConnectionId: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderId: number | null;
  senderName: string;
  senderUsername: string | null;
  messageId: number;
  messageText: string;
  importance: number;
  urgent: boolean;
  concernsOwner: boolean;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  handledAt: Date | null;
  handledBy: number | null;
  notes: string | null;
};

function rowToMessage(r: Record<string, unknown>): MessageRow {
  return {
    id: Number(r.id),
    createdAt: r.created_at as Date,
    businessConnectionId: r.business_connection_id as string,
    chatId: Number(r.chat_id),
    chatType: r.chat_type as string,
    chatTitle: (r.chat_title as string) ?? null,
    senderId: r.sender_id != null ? Number(r.sender_id) : null,
    senderName: r.sender_name as string,
    senderUsername: (r.sender_username as string) ?? null,
    messageId: Number(r.message_id),
    messageText: r.message_text as string,
    importance: Number(r.importance),
    urgent: r.urgent as boolean,
    concernsOwner: r.concerns_owner as boolean,
    reason: r.reason as string,
    alerted: r.alerted as boolean,
    autoReplied: r.auto_replied as boolean,
    handledAt: (r.handled_at as Date) ?? null,
    handledBy: r.handled_by != null ? Number(r.handled_by) : null,
    notes: (r.notes as string) ?? null,
  };
}

export async function listMessages(opts: {
  urgentOnly?: boolean;
  unhandledOnly?: boolean;
  chatId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<MessageRow[]> {
  await ensureSchema();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = sql();
  const search = opts.search ? `%${opts.search}%` : null;
  const rows = await q`
    SELECT * FROM messages_log
    WHERE (${opts.urgentOnly ?? false}::boolean = FALSE OR urgent = TRUE)
      AND (${opts.unhandledOnly ?? false}::boolean = FALSE OR handled_at IS NULL)
      AND (${opts.chatId ?? null}::bigint IS NULL OR chat_id = ${opts.chatId ?? null}::bigint)
      AND (${search}::text IS NULL OR message_text ILIKE ${search} OR sender_name ILIKE ${search})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(rowToMessage);
}

export async function markMessageHandled(
  id: number,
  actorId: number,
  notes?: string,
): Promise<void> {
  await ensureSchema();
  await sql()`
    UPDATE messages_log
    SET handled_at = NOW(), handled_by = ${actorId},
        notes = COALESCE(${notes ?? null}, notes)
    WHERE id = ${id}`;
}

export async function unhandleMessage(id: number): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE messages_log SET handled_at = NULL, handled_by = NULL WHERE id = ${id}`;
}

export async function overviewStats(): Promise<{
  totalMessages: number;
  urgentTotal: number;
  urgentUnhandled: number;
  alertsLast24h: number;
  autoRepliesLast24h: number;
  connections: number;
  groupSummariesLast7d: number;
}> {
  await ensureSchema();
  const q = sql();
  const [tot, urgTot, urgPend, alerts24, replies24, conns, summ7] = await Promise.all([
    q`SELECT COUNT(*)::bigint AS n FROM messages_log`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE urgent = TRUE`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE urgent = TRUE AND handled_at IS NULL`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE alerted = TRUE AND created_at > NOW() - INTERVAL '24 hours'`,
    q`SELECT COUNT(*)::bigint AS n FROM messages_log WHERE auto_replied = TRUE AND created_at > NOW() - INTERVAL '24 hours'`,
    q`SELECT COUNT(*)::bigint AS n FROM business_connections WHERE is_enabled = TRUE`,
    q`SELECT COUNT(*)::bigint AS n FROM group_summaries WHERE created_at > NOW() - INTERVAL '7 days'`,
  ]);
  const num = (rows: unknown): number =>
    Number((rows as Array<{ n: string }>)[0]?.n ?? 0);
  return {
    totalMessages: num(tot),
    urgentTotal: num(urgTot),
    urgentUnhandled: num(urgPend),
    alertsLast24h: num(alerts24),
    autoRepliesLast24h: num(replies24),
    connections: num(conns),
    groupSummariesLast7d: num(summ7),
  };
}

// --- Chat rules ---

export type ChatRule = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  updatedAt: Date;
};

export async function getChatRule(chatId: number): Promise<ChatRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, vip, muted, custom_reply, notes, updated_at
    FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    chatId: Number(r.chat_id),
    chatType: r.chat_type as string,
    chatTitle: (r.chat_title as string) ?? null,
    vip: r.vip as boolean,
    muted: r.muted as boolean,
    customReply: (r.custom_reply as string) ?? null,
    notes: (r.notes as string) ?? null,
    updatedAt: r.updated_at as Date,
  };
}

export async function upsertChatRule(rule: {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, vip, muted, custom_reply, notes, updated_at)
    VALUES (${rule.chatId}, ${rule.chatType}, ${rule.chatTitle}, ${rule.vip}, ${rule.muted}, ${rule.customReply}, ${rule.notes}, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      chat_type = EXCLUDED.chat_type,
      chat_title = COALESCE(EXCLUDED.chat_title, chat_rules.chat_title),
      vip = EXCLUDED.vip,
      muted = EXCLUDED.muted,
      custom_reply = EXCLUDED.custom_reply,
      notes = EXCLUDED.notes,
      updated_at = NOW()`;
}

export async function listChats(): Promise<
  Array<{
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    messages: number;
    urgent: number;
    lastSeen: Date | null;
    vip: boolean;
    muted: boolean;
    customReply: string | null;
  }>
> {
  await ensureSchema();
  const rows = await sql()`
    SELECT
      m.chat_id,
      MAX(m.chat_type) AS chat_type,
      MAX(m.chat_title) AS chat_title,
      COUNT(*)::int AS messages,
      COUNT(*) FILTER (WHERE m.urgent)::int AS urgent,
      MAX(m.created_at) AS last_seen,
      BOOL_OR(COALESCE(r.vip, FALSE)) AS vip,
      BOOL_OR(COALESCE(r.muted, FALSE)) AS muted,
      MAX(r.custom_reply) AS custom_reply
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    GROUP BY m.chat_id
    ORDER BY last_seen DESC NULLS LAST
    LIMIT 200`;
  return rows.map((r) => ({
    chatId: Number(r.chat_id),
    chatType: r.chat_type as string,
    chatTitle: (r.chat_title as string) ?? null,
    messages: Number(r.messages),
    urgent: Number(r.urgent),
    lastSeen: (r.last_seen as Date) ?? null,
    vip: r.vip as boolean,
    muted: r.muted as boolean,
    customReply: (r.custom_reply as string) ?? null,
  }));
}

// --- Settings ---

export async function getAllSettings(): Promise<Record<string, string>> {
  if (!hasDb()) return {};
  await ensureSchema();
  const rows = await sql()`SELECT key, value FROM settings`;
  const out: Record<string, string> = {};
  for (const r of rows) out[(r as { key: string }).key] = (r as { value: string }).value;
  return out;
}

export async function setSetting(
  key: string,
  value: string,
  actorId?: number,
): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${value}, ${actorId ?? null}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`;
}

// --- Group summaries ---

export type GroupSummaryRow = {
  id: number;
  chatId: number;
  chatTitle: string | null;
  periodStart: Date;
  periodEnd: Date;
  messageCount: number;
  activeSenders: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  mentionsOwner: boolean;
  createdAt: Date;
};

export async function listGroupSummaries(
  chatId?: number,
  limit = 30,
): Promise<GroupSummaryRow[]> {
  await ensureSchema();
  const q = sql();
  const rows = chatId
    ? await q`SELECT * FROM group_summaries WHERE chat_id = ${chatId} ORDER BY period_start DESC LIMIT ${limit}`
    : await q`SELECT * FROM group_summaries ORDER BY period_start DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    periodStart: r.period_start as Date,
    periodEnd: r.period_end as Date,
    messageCount: Number(r.message_count),
    activeSenders: Number(r.active_senders),
    summary: r.summary as string,
    topics: (r.topics as string[]) ?? [],
    actionItems: (r.action_items as string[]) ?? [],
    mentionsOwner: r.mentions_owner as boolean,
    createdAt: r.created_at as Date,
  }));
}

export async function upsertGroupSummary(s: {
  chatId: number;
  chatTitle: string | null;
  businessConnectionId: string;
  periodStart: Date;
  periodEnd: Date;
  messageCount: number;
  activeSenders: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  mentionsOwner: boolean;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO group_summaries (
      chat_id, chat_title, business_connection_id, period_start, period_end,
      message_count, active_senders, summary, topics, action_items, mentions_owner
    ) VALUES (
      ${s.chatId}, ${s.chatTitle}, ${s.businessConnectionId},
      ${s.periodStart.toISOString()}, ${s.periodEnd.toISOString()},
      ${s.messageCount}, ${s.activeSenders}, ${s.summary},
      ${JSON.stringify(s.topics)}::jsonb, ${JSON.stringify(s.actionItems)}::jsonb,
      ${s.mentionsOwner}
    )
    ON CONFLICT (chat_id, period_start) DO UPDATE SET
      message_count = EXCLUDED.message_count,
      active_senders = EXCLUDED.active_senders,
      summary = EXCLUDED.summary,
      topics = EXCLUDED.topics,
      action_items = EXCLUDED.action_items,
      mentions_owner = EXCLUDED.mentions_owner,
      created_at = NOW()`;
}

export async function groupActivityForPeriod(args: {
  start: Date;
  end: Date;
}): Promise<
  Array<{
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    businessConnectionId: string;
    messages: { sender: string; text: string; at: Date }[];
  }>
> {
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, business_connection_id,
           sender_name, message_text, created_at
    FROM messages_log
    WHERE chat_type IN ('group', 'supergroup')
      AND created_at >= ${args.start.toISOString()}
      AND created_at <  ${args.end.toISOString()}
    ORDER BY chat_id, created_at`;
  const byChat = new Map<
    number,
    {
      chatId: number;
      chatType: string;
      chatTitle: string | null;
      businessConnectionId: string;
      messages: { sender: string; text: string; at: Date }[];
    }
  >();
  for (const r of rows) {
    const chatId = Number(r.chat_id);
    let bucket = byChat.get(chatId);
    if (!bucket) {
      bucket = {
        chatId,
        chatType: r.chat_type as string,
        chatTitle: (r.chat_title as string) ?? null,
        businessConnectionId: r.business_connection_id as string,
        messages: [],
      };
      byChat.set(chatId, bucket);
    }
    bucket.messages.push({
      sender: r.sender_name as string,
      text: r.message_text as string,
      at: r.created_at as Date,
    });
  }
  return [...byChat.values()];
}

// --- Audit ---

export async function audit(args: {
  actorId: number | null;
  actorName?: string | null;
  action: string;
  target?: string | null;
  details?: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO audit_log (actor_id, actor_name, action, target, details)
    VALUES (${args.actorId ?? null}, ${args.actorName ?? null}, ${args.action},
            ${args.target ?? null}, ${JSON.stringify(args.details ?? null)}::jsonb)`;
}

// --- Secretary relay ---

export type SecretarySession = {
  id: number;
  businessConnectionId: string;
  senderChatId: number;
  senderName: string | null;
  senderUsername: string | null;
  secretaryUserId: number;
  secretaryChatId: number;
  headerMessageId: number;
  ownerUserId: number | null;
  createdAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  endReason: string | null;
};

function rowToSecretarySession(r: Record<string, unknown>): SecretarySession {
  return {
    id: Number(r.id),
    businessConnectionId: r.business_connection_id as string,
    senderChatId: Number(r.sender_chat_id),
    senderName: (r.sender_name as string) ?? null,
    senderUsername: (r.sender_username as string) ?? null,
    secretaryUserId: Number(r.secretary_user_id),
    secretaryChatId: Number(r.secretary_chat_id),
    headerMessageId: Number(r.header_message_id),
    ownerUserId: r.owner_user_id != null ? Number(r.owner_user_id) : null,
    createdAt: r.created_at as Date,
    lastActivityAt: r.last_activity_at as Date,
    endedAt: (r.ended_at as Date) ?? null,
    endReason: (r.end_reason as string) ?? null,
  };
}

export async function findActiveSecretarySessionForSender(args: {
  bcId: string;
  senderChatId: number;
  idleMinutes: number;
}): Promise<SecretarySession | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM secretary_sessions
    WHERE business_connection_id = ${args.bcId}
      AND sender_chat_id = ${args.senderChatId}
      AND ended_at IS NULL
      AND last_activity_at > NOW() - make_interval(mins => ${args.idleMinutes})
    ORDER BY last_activity_at DESC LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretarySession(r) : null;
}

export async function openSecretarySession(args: {
  businessConnectionId: string;
  senderChatId: number;
  senderName: string | null;
  senderUsername: string | null;
  secretaryUserId: number;
  secretaryChatId: number;
  headerMessageId: number;
  ownerUserId: number | null;
}): Promise<SecretarySession> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO secretary_sessions (
      business_connection_id, sender_chat_id, sender_name, sender_username,
      secretary_user_id, secretary_chat_id, header_message_id, owner_user_id
    ) VALUES (
      ${args.businessConnectionId}, ${args.senderChatId}, ${args.senderName}, ${args.senderUsername},
      ${args.secretaryUserId}, ${args.secretaryChatId}, ${args.headerMessageId}, ${args.ownerUserId}
    ) RETURNING *`;
  return rowToSecretarySession(rows[0] as Record<string, unknown>);
}

export async function touchSecretarySession(id: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`UPDATE secretary_sessions SET last_activity_at = NOW() WHERE id = ${id}`;
}

export async function endSecretarySession(id: number, reason: string): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE secretary_sessions
    SET ended_at = NOW(), end_reason = ${reason}
    WHERE id = ${id} AND ended_at IS NULL`;
}

export async function recordSecretaryLink(args: {
  sessionId: number;
  secretaryChatId: number;
  secretaryMessageId: number;
  direction: "inbound" | "outbound";
  senderMessageId?: number | null;
}): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_message_links (
      session_id, secretary_chat_id, secretary_message_id, direction, sender_message_id
    ) VALUES (
      ${args.sessionId}, ${args.secretaryChatId}, ${args.secretaryMessageId},
      ${args.direction}, ${args.senderMessageId ?? null}
    )
    ON CONFLICT (secretary_chat_id, secretary_message_id) DO UPDATE
      SET sender_message_id = COALESCE(EXCLUDED.sender_message_id,
                                       secretary_message_links.sender_message_id)`;
}

export async function findLinkWithSenderMessage(
  secretaryChatId: number,
  secretaryMessageId: number,
): Promise<
  | (SecretarySession & { senderMessageIdLinked: number | null })
  | null
> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT s.*, l.sender_message_id AS linked_sender_message_id
    FROM secretary_sessions s
    JOIN secretary_message_links l ON l.session_id = s.id
    WHERE l.secretary_chat_id = ${secretaryChatId}
      AND l.secretary_message_id = ${secretaryMessageId}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const session = rowToSecretarySession(r);
  const linked = r.linked_sender_message_id;
  return {
    ...session,
    senderMessageIdLinked:
      linked != null ? Number(linked as string | number) : null,
  };
}

export async function findSessionByLinkedMessage(
  secretaryChatId: number,
  secretaryMessageId: number,
): Promise<SecretarySession | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT s.* FROM secretary_sessions s
    JOIN secretary_message_links l ON l.session_id = s.id
    WHERE l.secretary_chat_id = ${secretaryChatId}
      AND l.secretary_message_id = ${secretaryMessageId}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretarySession(r) : null;
}

export async function findOnlyActiveSessionForSecretary(
  secretaryUserId: number,
  idleMinutes: number,
): Promise<SecretarySession | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM secretary_sessions
    WHERE secretary_user_id = ${secretaryUserId}
      AND ended_at IS NULL
      AND last_activity_at > NOW() - make_interval(mins => ${idleMinutes})
    ORDER BY last_activity_at DESC LIMIT 2`;
  if (rows.length !== 1) return null;
  return rowToSecretarySession(rows[0] as Record<string, unknown>);
}

export async function getSenderStats(chatId: number): Promise<{
  priorCount: number;
  urgentCount: number;
  lastSeen: Date | null;
  firstSeen: Date | null;
}> {
  if (!hasDb()) {
    return { priorCount: 0, urgentCount: 0, lastSeen: null, firstSeen: null };
  }
  await ensureSchema();
  const rows = await sql()`
    SELECT
      COUNT(*) FILTER (WHERE from_owner = FALSE)::int AS n,
      COUNT(*) FILTER (WHERE from_owner = FALSE AND urgent = TRUE)::int AS urgent_n,
      MAX(created_at) FILTER (WHERE from_owner = FALSE) AS last_seen,
      MIN(created_at) FILTER (WHERE from_owner = FALSE) AS first_seen
    FROM messages_log
    WHERE chat_id = ${chatId}`;
  const r = (rows[0] as {
    n: number;
    urgent_n: number;
    last_seen: Date | null;
    first_seen: Date | null;
  }) ?? { n: 0, urgent_n: 0, last_seen: null, first_seen: null };
  return {
    priorCount: Number(r.n) || 0,
    urgentCount: Number(r.urgent_n) || 0,
    lastSeen: r.last_seen ?? null,
    firstSeen: r.first_seen ?? null,
  };
}
