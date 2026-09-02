// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";
import { SecretarySession, rowToSecretarySession } from "./secretary";

// --- Messages log ---

export type LogMessage = {
  businessConnectionId: string | null;
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
  mediaFileId?: string | null;
  mediaKind?: string | null;
  source?: string | null;
  messageThreadId?: number | null;
  inlineButtons?: Array<{ label: string; url: string }> | null;
};

export async function logMessage(m: LogMessage): Promise<number> {
  await ensureSchema();
  // Dedupe: the same outgoing message can reach us via both the send-call
  // (we log it) and a sender_business_bot echo (the bot's own outgoing
  // arrives as a business_message). Return the existing id if so. For
  // groups (no bcId), message_id is unique within chat_id so that pair
  // is enough.
  const existing =
    m.businessConnectionId === null
      ? await sql()`
          SELECT id FROM messages_log
          WHERE business_connection_id IS NULL
            AND chat_id = ${m.chatId}
            AND message_id = ${m.messageId}
          LIMIT 1`
      : await sql()`
          SELECT id FROM messages_log
          WHERE business_connection_id = ${m.businessConnectionId}
            AND chat_id = ${m.chatId}
            AND message_id = ${m.messageId}
          LIMIT 1`;
  if (existing.length > 0) {
    return Number((existing[0] as { id: string }).id);
  }
  const buttonsJson =
    m.inlineButtons && m.inlineButtons.length > 0
      ? JSON.stringify(m.inlineButtons)
      : null;
  // Resolve tenant_id at INSERT so multi-tenant queries (like the
  // follow-up cron) see new rows. Until this was added, new rows
  // landed with tenant_id=NULL and the WHERE tenant_id = $X filter
  // silently dropped them — making /follow-up show "18 days ago"
  // even after fresh messages arrived.
  let tenantId: number | null = null;
  try {
    const { getCurrentTenantId } = await import("../tenant-context");
    tenantId = getCurrentTenantId() ?? null;
  } catch {
    // tenant-context isn't established in some background paths
  }
  if (tenantId == null && m.businessConnectionId) {
    const bcRows = await sql()`
      SELECT tenant_id FROM business_connections
      WHERE id = ${m.businessConnectionId} LIMIT 1`;
    const r = bcRows[0] as { tenant_id: string | null } | undefined;
    if (r?.tenant_id != null) tenantId = Number(r.tenant_id);
  }
  if (tenantId == null) {
    const dRows = await sql()`
      SELECT id FROM tenants WHERE name = 'Default' LIMIT 1`;
    const r = dRows[0] as { id: string | number } | undefined;
    if (r?.id != null) tenantId = Number(r.id);
  }
  const rows = await sql()`
    INSERT INTO messages_log (
      business_connection_id, owner_user_id, chat_id, chat_type, chat_title,
      sender_id, sender_username, sender_name, message_id, message_text,
      importance, urgent, concerns_owner, reason, alerted, auto_replied,
      from_owner, skipped_reason, media_file_id, media_kind, source,
      message_thread_id, inline_buttons, tenant_id
    ) VALUES (
      ${m.businessConnectionId}, ${m.ownerUserId}, ${m.chatId}, ${m.chatType}, ${m.chatTitle},
      ${m.senderId}, ${m.senderUsername}, ${m.senderName}, ${m.messageId}, ${m.messageText},
      ${m.importance}, ${m.urgent}, ${m.concernsOwner}, ${m.reason}, ${m.alerted}, ${m.autoReplied},
      ${m.fromOwner ?? false}, ${m.skippedReason ?? null},
      ${m.mediaFileId ?? null}, ${m.mediaKind ?? null}, ${m.source ?? null},
      ${m.messageThreadId ?? null}, ${buttonsJson}::jsonb, ${tenantId}
    ) RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

// --- Telegram debug log (every incoming update) ---
//
// Lives in Redis (1-hour TTL, capped at 2000 entries) — the webhook
// hot path can't afford a DB round-trip per update, and the operator
// only ever wants the last hour of activity to debug "did this event
// fire?" questions. No prune step, no schema cost.

export type DebugLogRow = {
  id: number;
  receivedAt: Date;
  updateId: number | null;
  updateType: string;
  chatId: number | null;
  chatType: string | null;
  userId: number | null;
  businessConnectionId: string | null;
  preview: string | null;
  payload: unknown;
  tenantId: number | null;
};

const DEBUG_LOG_KEY = "tgsb:debug-log";
const DEBUG_LOG_MAX_ITEMS = 2000;
const DEBUG_LOG_TTL_SECONDS = 60 * 60; // 1 hour

// One-in-N opportunistic cleanup of the DB fallback table — keeps
// the row count bounded without scheduling a separate job.
let dbDebugLogWriteCounter = 0;

export async function logTelegramUpdate(args: {
  updateId: number | null;
  updateType: string;
  chatId: number | null;
  chatType: string | null;
  userId: number | null;
  businessConnectionId: string | null;
  preview: string | null;
  payload: unknown;
}): Promise<void> {
  const { redisEnabled, redisListPush } = await import("../redis");
  if (redisEnabled()) {
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      receivedAt: new Date().toISOString(),
      updateId: args.updateId,
      updateType: args.updateType,
      chatId: args.chatId,
      chatType: args.chatType,
      userId: args.userId,
      businessConnectionId: args.businessConnectionId,
      preview: args.preview ? args.preview.slice(0, 500) : null,
      payload: args.payload,
    };
    await redisListPush({
      key: DEBUG_LOG_KEY,
      value: entry,
      maxLength: DEBUG_LOG_MAX_ITEMS,
      ttlSeconds: DEBUG_LOG_TTL_SECONDS,
    });
    return;
  }
  // DB fallback.
  if (!hasDb()) return;
  await ensureSchema();
  try {
    await sql()`
      INSERT INTO telegram_debug_log (
        update_type, chat_id, chat_type, user_id, bc_id, preview, payload
      ) VALUES (
        ${args.updateType}, ${args.chatId}, ${args.chatType}, ${args.userId},
        ${args.businessConnectionId},
        ${args.preview ? args.preview.slice(0, 500) : null},
        ${JSON.stringify(args.payload)}::jsonb
      )`;
    dbDebugLogWriteCounter++;
    if (dbDebugLogWriteCounter % 50 === 0) {
      await sql()`DELETE FROM telegram_debug_log
        WHERE received_at < NOW() - INTERVAL '1 hour'`;
    }
  } catch (err) {
    console.warn("[debug-log] DB fallback insert failed:", err);
  }
}

export async function listDebugLog(args?: {
  updateType?: string | null;
  chatId?: number | null;
  q?: string | null;
  limit?: number;
}): Promise<DebugLogRow[]> {
  const { redisEnabled, redisListRange } = await import("../redis");
  if (redisEnabled()) {
    type Stored = Omit<DebugLogRow, "receivedAt"> & { receivedAt: string };
    const raw = await redisListRange<Stored>(DEBUG_LOG_KEY, 0, -1);
    const ql = args?.q?.trim().toLowerCase() || null;
    const filtered = raw.filter((r) => {
      if (args?.updateType && r.updateType !== args.updateType) return false;
      if (args?.chatId != null && r.chatId !== args.chatId) return false;
      if (ql) {
        const hay =
          (r.preview ?? "").toLowerCase() +
          " " +
          String(r.chatId ?? "") +
          " " +
          (r.businessConnectionId ?? "").toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    const out = filtered.slice(0, Math.min(args?.limit ?? 500, 2000));
    return out.map((r) => ({
      ...r,
      receivedAt: new Date(r.receivedAt),
      tenantId: null,
    }));
  }
  // DB fallback.
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(args?.limit ?? 500, 2000);
  const updateType = args?.updateType?.trim() || null;
  const chatId = args?.chatId ?? null;
  const q = args?.q?.trim() || null;
  const rows = await sql()`
    SELECT id, received_at, update_type, chat_id, chat_type, user_id,
           bc_id, preview, payload
    FROM telegram_debug_log
    WHERE received_at > NOW() - INTERVAL '1 hour'
      AND (${updateType}::text IS NULL OR update_type = ${updateType})
      AND (${chatId}::bigint IS NULL OR chat_id = ${chatId})
      AND (${q}::text IS NULL OR preview ILIKE '%' || ${q} || '%')
    ORDER BY received_at DESC
    LIMIT ${limit}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    receivedAt: r.received_at as Date,
    updateId: null,
    updateType: r.update_type as string,
    chatId: r.chat_id == null ? null : Number(r.chat_id),
    chatType: (r.chat_type as string) ?? null,
    userId: r.user_id == null ? null : Number(r.user_id),
    businessConnectionId: (r.bc_id as string) ?? null,
    preview: (r.preview as string) ?? null,
    payload: r.payload,
    tenantId: null,
  }));
}

export async function debugLogTypeBuckets(): Promise<
  Array<{ updateType: string; count: number }>
> {
  const { redisEnabled, redisListRange } = await import("../redis");
  if (redisEnabled()) {
    type Stored = { updateType: string };
    const raw = await redisListRange<Stored>(DEBUG_LOG_KEY, 0, -1);
    const counts: Record<string, number> = {};
    for (const r of raw) counts[r.updateType] = (counts[r.updateType] ?? 0) + 1;
    return Object.entries(counts)
      .map(([updateType, count]) => ({ updateType, count }))
      .sort((a, b) => b.count - a.count);
  }
  // DB fallback.
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT update_type, COUNT(*)::int AS cnt
    FROM telegram_debug_log
    WHERE received_at > NOW() - INTERVAL '1 hour'
    GROUP BY update_type
    ORDER BY cnt DESC`;
  return (rows as Array<{ update_type: string; cnt: number }>).map((r) => ({
    updateType: r.update_type,
    count: Number(r.cnt),
  }));
}

// Record that the owner reacted to a customer message — counted as
// a reply by listFollowUpCandidates. Upsert so re-reactions on the
// same message just refresh the timestamp instead of duplicating.
export async function recordOwnerReaction(args: {
  chatId: number;
  businessConnectionId: string | null;
  messageId: number;
  emojis: string | null;
  tenantId: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO owner_reactions (
      chat_id, business_connection_id, message_id, emojis, tenant_id
    ) VALUES (
      ${args.chatId}, ${args.businessConnectionId}, ${args.messageId},
      ${args.emojis},
      COALESCE(
        ${args.tenantId}::bigint,
        (SELECT tenant_id FROM business_connections
          WHERE id = ${args.businessConnectionId} LIMIT 1)
      )
    )
    ON CONFLICT (chat_id, COALESCE(business_connection_id, ''), message_id)
    DO UPDATE SET emojis = EXCLUDED.emojis, reacted_at = NOW()`;
}

// --- Per-chat history cleanup ---
//
// "Delete every messages_log row for this chat older than X days +
//  every owner_reaction tied to it." Returns the number of rows
// actually removed so the operator sees the impact.

export async function countChatHistoryOlderThan(args: {
  chatId: number;
  olderThanDays: number;
}): Promise<{
  messages: number;
  reactions: number;
  oldestAt: Date | null;
  newestAt: Date | null;
}> {
  if (!hasDb()) return { messages: 0, reactions: 0, oldestAt: null, newestAt: null };
  await ensureSchema();
  const days = Math.max(1, Math.round(args.olderThanDays));
  const mRows = await sql()`
    SELECT COUNT(*)::int AS cnt,
           MIN(created_at) AS oldest,
           MAX(created_at) AS newest
    FROM messages_log
    WHERE chat_id = ${args.chatId}
      AND created_at < NOW() - make_interval(days => ${days})`;
  const m = mRows[0] as {
    cnt: number;
    oldest: Date | null;
    newest: Date | null;
  };
  const rRows = await sql()`
    SELECT COUNT(*)::int AS cnt
    FROM owner_reactions
    WHERE chat_id = ${args.chatId}
      AND reacted_at < NOW() - make_interval(days => ${days})`;
  const r = rRows[0] as { cnt: number };
  return {
    messages: Number(m.cnt),
    reactions: Number(r.cnt),
    oldestAt: m.oldest,
    newestAt: m.newest,
  };
}

export async function deleteChatHistoryOlderThan(args: {
  chatId: number;
  olderThanDays: number;
}): Promise<{ messages: number; reactions: number }> {
  if (!hasDb()) return { messages: 0, reactions: 0 };
  await ensureSchema();
  const days = Math.max(1, Math.round(args.olderThanDays));
  const m = await sql()`
    DELETE FROM messages_log
    WHERE chat_id = ${args.chatId}
      AND created_at < NOW() - make_interval(days => ${days})
    RETURNING id`;
  const r = await sql()`
    DELETE FROM owner_reactions
    WHERE chat_id = ${args.chatId}
      AND reacted_at < NOW() - make_interval(days => ${days})
    RETURNING id`;
  return {
    messages: (m as Array<unknown>).length,
    reactions: (r as Array<unknown>).length,
  };
}

export async function getEffectiveProfileId(
  chatId: number,
): Promise<number | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT
      COALESCE(
        cr.profile_id,
        (SELECT id FROM chat_profiles
          WHERE is_default = TRUE
            AND (tenant_id IS NULL OR tenant_id = cr.tenant_id)
          ORDER BY tenant_id NULLS LAST
          LIMIT 1)
      ) AS pid
    FROM chat_rules cr
    WHERE cr.chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as { pid: string | number | null } | undefined;
  if (!r) {
    // No chat_rules row at all: just return the global default.
    const def = await sql()`SELECT id FROM chat_profiles WHERE is_default = TRUE LIMIT 1`;
    const d = def[0] as { id: string | number } | undefined;
    return d ? Number(d.id) : null;
  }
  return r.pid == null ? null : Number(r.pid);
}

export async function assignChatToProfile(
  chatId: number,
  profileId: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, profile_id)
    VALUES (${chatId}, 'private', ${profileId})
    ON CONFLICT (chat_id) DO UPDATE SET
      profile_id = ${profileId},
      updated_at = NOW()`;
}

export async function bulkAssignProfile(
  chatIds: number[],
  profileId: number | null,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  let n = 0;
  for (const id of chatIds) {
    await assignChatToProfile(id, profileId);
    n++;
  }
  return n;
}

export async function listChatsInProfile(
  profileId: number,
): Promise<Array<{ chatId: number; name: string | null; chatType: string }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  // Find out if this is the default profile so we can include
  // chats with NULL profile_id (which implicitly belong to default).
  const defRows = await sql()`
    SELECT is_default FROM chat_profiles WHERE id = ${profileId} LIMIT 1`;
  const isDefault = Boolean(
    (defRows[0] as { is_default?: boolean } | undefined)?.is_default,
  );
  const rows = await sql()`
    SELECT chat_id, chat_type, first_name, last_name, nickname, chat_title
    FROM chat_rules
    WHERE profile_id = ${profileId}
       OR (${isDefault}::boolean AND profile_id IS NULL)
    ORDER BY updated_at DESC
    LIMIT 1000`;
  return (rows as Array<Record<string, unknown>>).map((r) => {
    const name =
      [r.first_name as string, r.last_name as string]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      (r.nickname as string) ||
      (r.chat_title as string) ||
      null;
    return {
      chatId: Number(r.chat_id),
      chatType: (r.chat_type as string) ?? "private",
      name,
    };
  });
}

// Search for chats that aren't already in the given profile. Used by
// the profile-membership picker.
export async function searchChatsNotInProfile(args: {
  profileId: number;
  q?: string;
  limit?: number;
}): Promise<Array<{ chatId: number; name: string | null; chatType: string }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const q = (args.q ?? "").trim();
  const like = q ? `%${q}%` : null;
  const limit = Math.min(args.limit ?? 50, 200);
  const rows = await sql()`
    SELECT chat_id, chat_type, first_name, last_name, nickname, chat_title
    FROM chat_rules
    WHERE (profile_id IS NULL OR profile_id <> ${args.profileId})
      AND COALESCE(ignored, FALSE) = FALSE
      AND (
        ${like}::text IS NULL
        OR COALESCE(first_name, '') ILIKE ${like}
        OR COALESCE(last_name, '') ILIKE ${like}
        OR COALESCE(nickname, '') ILIKE ${like}
        OR COALESCE(chat_title, '') ILIKE ${like}
        OR CAST(chat_id AS TEXT) ILIKE ${like}
      )
    ORDER BY updated_at DESC
    LIMIT ${limit}`;
  return (rows as Array<Record<string, unknown>>).map((r) => {
    const name =
      [r.first_name as string, r.last_name as string]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      (r.nickname as string) ||
      (r.chat_title as string) ||
      null;
    return {
      chatId: Number(r.chat_id),
      chatType: (r.chat_type as string) ?? "private",
      name,
    };
  });
}

// --- Sender-side reaction lookup (inverse direction) ---

export async function findSecretaryLinkForSenderMessage(
  businessConnectionId: string,
  senderChatId: number,
  senderMessageId: number,
): Promise<{
  session: SecretarySession;
  secretaryMessageId: number;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT s.*, l.secretary_message_id AS link_msg
    FROM secretary_sessions s
    JOIN secretary_message_links l ON l.session_id = s.id
    WHERE s.business_connection_id = ${businessConnectionId}
      AND s.sender_chat_id = ${senderChatId}
      AND l.sender_message_id = ${senderMessageId}
    ORDER BY l.created_at DESC LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    session: rowToSecretarySession(r),
    secretaryMessageId: Number(r.link_msg),
  };
}

// --- Recent conversation snapshot (for AI auto-reply) ---

export async function recentConversation(
  chatId: number,
  limit = 30,
): Promise<Array<{ from: "owner" | "other"; senderName: string; text: string; at: Date }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  // For voice / sticker / GIF messages the message_text column is the
  // raw `[voice]` placeholder. If we have a transcript or a media
  // description for that row we surface THAT to the AI so future
  // replies are based on the real content. This is what makes the
  // transcript "stick" — once transcribed, every subsequent AI call
  // sees the words, not the placeholder.
  const rows = await sql()`
    SELECT created_at, from_owner, sender_name, message_text,
           transcript, media_description, media_kind
    FROM messages_log
    WHERE chat_id = ${chatId}
      AND (skipped_reason IS NULL OR skipped_reason <> 'muted')
    ORDER BY created_at DESC LIMIT ${limit}`;
  const r = rows as Array<{
    created_at: Date;
    from_owner: boolean;
    sender_name: string;
    message_text: string;
    transcript: string | null;
    media_description: string | null;
    media_kind: string | null;
  }>;
  return r
    .map((row) => {
      let text = row.message_text;
      if (row.transcript) text = row.transcript;
      else if (row.media_description) {
        text = `[${row.media_kind ?? "media"}] ${row.media_description}`;
      }
      return {
        from: row.from_owner ? ("owner" as const) : ("other" as const),
        senderName: row.sender_name,
        text,
        at: row.created_at,
      };
    })
    .reverse();
}

// Owner-typed messages only — strictly things the owner physically
// typed into Telegram, with NO bot-generated rows included. Used by
// the per-chat fine-tune button: feeding AI-generated replies back
// into the tone extractor would slowly poison the profile and the
// owner's "voice" would drift into whatever the model made up. The
// guard is `source IS NULL`: every bot send-path
// (ai_chat / friendly_reply / auto_reply / bot_echo / ai_dashboard /
// owner_dashboard) writes a non-null source, while messages actually
// typed by the owner from the Telegram client come in via the
// business_message echo with source IS NULL.
export async function ownerTypedMessages(
  chatId: number,
  limit = 300,
): Promise<string[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const cap = Math.min(Math.max(limit, 1), 1000);
  const rows = await sql()`
    SELECT message_text FROM messages_log
    WHERE chat_id = ${chatId}
      AND from_owner = TRUE
      AND source IS NULL
      AND message_text IS NOT NULL
      AND message_text <> ''
    ORDER BY created_at DESC
    LIMIT ${cap}`;
  return (rows as Array<{ message_text: string }>)
    .map((r) => r.message_text)
    .reverse();
}
