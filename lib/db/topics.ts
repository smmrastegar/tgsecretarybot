// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { CHAT_MODES, ChatMode } from "./chats";
import { ensureSchema, hasDb, sql } from "./core";
import { NoteWatchMatch, rowToNoteWatchMatch } from "./notes";

// --- Forum topics ---

export type ForumTopic = {
  chatId: number;
  messageThreadId: number;
  name: string | null;
  iconColor: number | null;
  iconEmoji: string | null;
  isClosed: boolean;
  isHidden: boolean;
  archivedAt: Date | null;
  notes: string | null;
  observedAt: Date;
};

export async function upsertForumTopic(args: {
  chatId: number;
  messageThreadId: number;
  name?: string | null;
  iconColor?: number | null;
  iconEmoji?: string | null;
  isClosed?: boolean;
  isHidden?: boolean;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO forum_topics (
      chat_id, message_thread_id, name, icon_color, icon_emoji, is_closed, is_hidden
    ) VALUES (
      ${args.chatId}, ${args.messageThreadId}, ${args.name ?? null},
      ${args.iconColor ?? null}, ${args.iconEmoji ?? null},
      ${args.isClosed ?? false}, ${args.isHidden ?? false}
    )
    ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, forum_topics.name),
      icon_color = COALESCE(EXCLUDED.icon_color, forum_topics.icon_color),
      icon_emoji = COALESCE(EXCLUDED.icon_emoji, forum_topics.icon_emoji),
      is_closed = EXCLUDED.is_closed,
      is_hidden = EXCLUDED.is_hidden,
      observed_at = NOW()`;
}

// Upsert one member from a chat_member / my_chat_member update.
// Sets last_seen + bumps last_status_change_at when status actually
// flipped (so the dashboard can highlight recent leavers).
export async function upsertChatMember(args: {
  chatId: number;
  userId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  isBot: boolean;
  isPremium: boolean;
  languageCode: string | null;
  status: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_members (
      chat_id, user_id, first_name, last_name, username, is_bot,
      is_premium, language_code, status
    ) VALUES (
      ${args.chatId}, ${args.userId}, ${args.firstName}, ${args.lastName},
      ${args.username}, ${args.isBot}, ${args.isPremium},
      ${args.languageCode}, ${args.status}
    )
    ON CONFLICT (chat_id, user_id) DO UPDATE SET
      first_name = COALESCE(EXCLUDED.first_name, chat_members.first_name),
      last_name  = COALESCE(EXCLUDED.last_name,  chat_members.last_name),
      username   = COALESCE(EXCLUDED.username,   chat_members.username),
      is_bot     = EXCLUDED.is_bot,
      is_premium = EXCLUDED.is_premium,
      language_code = COALESCE(EXCLUDED.language_code, chat_members.language_code),
      status     = EXCLUDED.status,
      last_seen_at = NOW(),
      last_status_change_at = CASE
        WHEN chat_members.status <> EXCLUDED.status THEN NOW()
        ELSE chat_members.last_status_change_at
      END`;
}

// Aggregate distinct senders ever observed in this chat. Used by the
// group page «📋 خروجی اعضا» button — pulls every (sender_id,
// sender_name, sender_username) the bot has ever logged for this chat
// and counts how many messages each one sent + first/last seen.
export async function listGroupMembersFromMessages(
  chatId: number,
): Promise<
  Array<{
    senderId: number;
    senderName: string;
    senderUsername: string | null;
    messageCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    status: string | null; // from chat_members; null = sent messages but no chat_member event seen
    isBot: boolean;
    isPremium: boolean;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  // FULL OUTER JOIN messages_log senders ⨝ chat_members so the result
  // covers BOTH paths: people we've seen via chat_member events (even
  // if they never sent a message) and people who sent messages (even
  // if we missed their join event because chat_member wasn't enabled
  // at the time). Pick the freshest name/username from either side.
  const rows = await sql()`
    WITH senders AS (
      SELECT
        sender_id::bigint AS user_id,
        (
          ARRAY_AGG(sender_name      ORDER BY created_at DESC) FILTER (WHERE sender_name IS NOT NULL)
        )[1] AS sender_name,
        (
          ARRAY_AGG(sender_username  ORDER BY created_at DESC) FILTER (WHERE sender_username IS NOT NULL)
        )[1] AS sender_username,
        COUNT(*)::int   AS msg_count,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM messages_log
      WHERE chat_id = ${chatId}
        AND sender_id IS NOT NULL
        AND COALESCE(from_owner, FALSE) = FALSE
      GROUP BY sender_id
    ),
    members AS (
      SELECT
        user_id, first_name, last_name, username, is_bot, is_premium,
        status, first_seen_at, last_seen_at
      FROM chat_members
      WHERE chat_id = ${chatId}
    )
    SELECT
      COALESCE(s.user_id, m.user_id)                          AS user_id,
      COALESCE(
        s.sender_name,
        NULLIF(TRIM(CONCAT(COALESCE(m.first_name, ''), ' ', COALESCE(m.last_name, ''))), '')
      )                                                       AS display_name,
      COALESCE(s.sender_username, m.username)                 AS username,
      COALESCE(s.msg_count, 0)                                AS msg_count,
      LEAST(COALESCE(s.first_seen, m.first_seen_at), COALESCE(m.first_seen_at, s.first_seen)) AS first_seen,
      GREATEST(COALESCE(s.last_seen,  m.last_seen_at),  COALESCE(m.last_seen_at,  s.last_seen))  AS last_seen,
      m.status                                                AS status,
      COALESCE(m.is_bot, FALSE)                               AS is_bot,
      COALESCE(m.is_premium, FALSE)                           AS is_premium
    FROM senders s
    FULL OUTER JOIN members m ON m.user_id = s.user_id
    ORDER BY msg_count DESC, display_name ASC NULLS LAST`;
  return rows.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      senderId: Number(o.user_id),
      senderName: (o.display_name as string) ?? "",
      senderUsername: (o.username as string) ?? null,
      messageCount: Number(o.msg_count ?? 0),
      firstSeenAt: o.first_seen as Date,
      lastSeenAt: o.last_seen as Date,
      status: (o.status as string) ?? null,
      isBot: Boolean(o.is_bot),
      isPremium: Boolean(o.is_premium),
    };
  });
}

export async function listForumTopics(
  chatId: number,
  opts?: { includeArchived?: boolean },
): Promise<ForumTopic[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const includeArchived = opts?.includeArchived ?? false;
  const rows = await sql()`
    SELECT chat_id, message_thread_id, name, icon_color, icon_emoji,
           is_closed, is_hidden, archived_at, notes, observed_at
    FROM forum_topics
    WHERE chat_id = ${chatId}
      AND (${includeArchived}::boolean = TRUE OR archived_at IS NULL)
    ORDER BY message_thread_id ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    chatId: Number(r.chat_id),
    messageThreadId: Number(r.message_thread_id),
    name: (r.name as string) ?? null,
    iconColor: r.icon_color != null ? Number(r.icon_color) : null,
    iconEmoji: (r.icon_emoji as string) ?? null,
    isClosed: Boolean(r.is_closed),
    isHidden: Boolean(r.is_hidden),
    archivedAt: (r.archived_at as Date) ?? null,
    notes: (r.notes as string) ?? null,
    observedAt: r.observed_at as Date,
  }));
}

// Operator writes a short description of what the topic is for. This
// gets piped into the v2 analyzer's batch prompts so the LLM has the
// per-topic context (e.g. "این تاپیک فقط برای bug-report ها"). Pass
// notes=null or empty to clear.
export async function setForumTopicNotes(opts: {
  chatId: number;
  messageThreadId: number;
  notes: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const trimmed = opts.notes?.trim() || null;
  await sql()`
    INSERT INTO forum_topics (chat_id, message_thread_id, notes)
    VALUES (${opts.chatId}, ${opts.messageThreadId}, ${trimmed})
    ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
      notes = ${trimmed},
      observed_at = NOW()`;
}

// Operator marks a topic as archived («دیگه مهم نیست / پاک شده»). When
// archived, the analyzer + per-topic viewer skip it by default. Pass
// archived=false to restore.
export async function setForumTopicArchived(opts: {
  chatId: number;
  messageThreadId: number;
  archived: boolean;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  if (opts.archived) {
    await sql()`
      INSERT INTO forum_topics (chat_id, message_thread_id, archived_at)
      VALUES (${opts.chatId}, ${opts.messageThreadId}, NOW())
      ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
        archived_at = NOW(),
        observed_at = NOW()`;
  } else {
    await sql()`
      UPDATE forum_topics
         SET archived_at = NULL,
             observed_at = NOW()
       WHERE chat_id = ${opts.chatId}
         AND message_thread_id = ${opts.messageThreadId}`;
  }
}

// Pull just the inline_buttons column for a single message — used by
// the email-html viewer so it can verify the requested URL is one of
// the buttons the message originally carried (not an arbitrary fetch).
export async function getMessageInlineButtons(
  id: number,
): Promise<Array<{ label: string; url: string }> | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT inline_buttons FROM messages_log WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as { inline_buttons: unknown } | undefined;
  if (!r) return null;
  return parseInlineButtons(r.inline_buttons);
}

// Watchlist match reporting: the "🚩 گزارش خطا" button under the
// notes_inbox notice records a wrong-match flag. The next time the
// scanner runs on a SIMILAR-looking message the bot can be more
// conservative (or the operator can re-tune the concept).
export async function getNoteWatchMatch(
  id: number,
): Promise<NoteWatchMatch | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, item_id, chat_id, chat_title, message_log_id, source_message_id,
           sender_name, quote, reason, forwarded_to, created_at
    FROM note_watch_matches WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchMatch(r) : null;
}

export async function markNoteWatchMatchWrong(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE note_watch_matches SET reported_wrong_at = NOW() WHERE id = ${id}`;
}

export async function markNoteWatchMatchConfirmed(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE note_watch_matches SET confirmed_at = NOW() WHERE id = ${id}`;
}

// Look up the full original message text by messages_log.id —
// powers the "📄 متن کامل" button under a watchlist notice.
export async function getMessageFullText(id: number): Promise<{
  text: string;
  chatTitle: string | null;
  senderName: string;
  createdAt: Date;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT message_text, transcript, media_description, media_kind,
           chat_title, sender_name, created_at
    FROM messages_log WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const body = (r.message_text as string) ?? "";
  const transcript = (r.transcript as string) ?? null;
  const desc = (r.media_description as string) ?? null;
  const kind = (r.media_kind as string) ?? null;
  let text = body;
  if (!text && transcript) text = `[voice] ${transcript}`;
  else if (!text && desc) text = `[${kind ?? "media"}] ${desc}`;
  else if (!text && kind) text = `[${kind}]`;
  return {
    text,
    chatTitle: (r.chat_title as string) ?? null,
    senderName: (r.sender_name as string) ?? "?",
    createdAt: r.created_at as Date,
  };
}

export async function getMessageForTranscript(id: number): Promise<{
  id: number;
  mediaFileId: string | null;
  mediaKind: string | null;
  transcript: string | null;
  transcriptAt: Date | null;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, media_file_id, media_kind, transcript, transcript_at
    FROM messages_log WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as
    | {
        id: number;
        media_file_id: string | null;
        media_kind: string | null;
        transcript: string | null;
        transcript_at: Date | null;
      }
    | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    mediaFileId: r.media_file_id ?? null,
    mediaKind: r.media_kind ?? null,
    transcript: r.transcript ?? null,
    transcriptAt: r.transcript_at ?? null,
  };
}

export async function saveTranscript(
  id: number,
  transcript: string,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE messages_log
    SET transcript = ${transcript}, transcript_at = NOW()
    WHERE id = ${id}`;
}

export async function saveMediaDescription(
  id: number,
  description: string,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE messages_log
    SET media_description = ${description}, media_description_at = NOW()
    WHERE id = ${id}`;
}

// Mark every messages_log row for the given (bcId, chatId, messageId)
// tuples as deleted. Telegram pushes deleted_business_messages with a
// list of message_ids when either side erases a DM; we keep the row
// (and its text/transcript/media description) but stamp deleted_at so
// the dashboard can show the "Deleted" label without losing the
// content.
export async function markMessagesDeleted(args: {
  businessConnectionId: string;
  chatId: number;
  messageIds: number[];
}): Promise<number> {
  if (!hasDb() || args.messageIds.length === 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    UPDATE messages_log
    SET deleted_at = NOW()
    WHERE business_connection_id = ${args.businessConnectionId}
      AND chat_id = ${args.chatId}
      AND message_id = ANY(${args.messageIds}::bigint[])
      AND deleted_at IS NULL
    RETURNING id`;
  return rows.length;
}

// Snapshot the existing text/transcript into message_edits and update
// the live row with the new text. Called from the edited_business_
// message handler. If nothing actually changed we no-op so we don't
// pad the history with phantom edits.
export async function recordMessageEdit(args: {
  businessConnectionId: string;
  chatId: number;
  messageId: number;
  newText: string;
  newTranscript?: string | null;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, message_text, transcript
    FROM messages_log
    WHERE business_connection_id = ${args.businessConnectionId}
      AND chat_id = ${args.chatId}
      AND message_id = ${args.messageId}
    LIMIT 1`;
  const r = rows[0] as
    | { id: string; message_text: string; transcript: string | null }
    | undefined;
  if (!r) return false;
  const oldText = r.message_text ?? "";
  const oldTranscript = r.transcript ?? null;
  const textChanged = oldText !== args.newText;
  const transcriptChanged =
    args.newTranscript !== undefined && args.newTranscript !== oldTranscript;
  if (!textChanged && !transcriptChanged) return false;
  await sql()`
    INSERT INTO message_edits (message_log_id, previous_text, previous_transcript)
    VALUES (${Number(r.id)}, ${oldText}, ${oldTranscript})`;
  if (transcriptChanged) {
    await sql()`
      UPDATE messages_log
      SET message_text = ${args.newText},
          transcript = ${args.newTranscript ?? null},
          edited_at = NOW()
      WHERE id = ${Number(r.id)}`;
  } else {
    await sql()`
      UPDATE messages_log
      SET message_text = ${args.newText},
          edited_at = NOW()
      WHERE id = ${Number(r.id)}`;
  }
  return true;
}

export type MessageEdit = {
  id: number;
  messageLogId: number;
  previousText: string | null;
  previousTranscript: string | null;
  editedAt: Date;
};

export async function getMessageEdits(
  messageLogId: number,
): Promise<MessageEdit[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, message_log_id, previous_text, previous_transcript, edited_at
    FROM message_edits
    WHERE message_log_id = ${messageLogId}
    ORDER BY edited_at DESC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    messageLogId: Number(r.message_log_id),
    previousText: (r.previous_text as string) ?? null,
    previousTranscript: (r.previous_transcript as string) ?? null,
    editedAt: r.edited_at as Date,
  }));
}

// "Owner active in this chat" for the grace window means the owner
// actually typed something in Telegram — NOT the bot's own AI/auto reply
// (those land in messages_log with from_owner=TRUE because Telegram
// attributes business outgoing to the user). Bot-generated rows have a
// non-null `source` (ai_chat, auto_reply, friendly_reply, bot_echo,
// ai_dashboard, owner_dashboard, ...) so we ignore anything with a
// source set. Owner-typed messages from the Telegram client are logged
// with source IS NULL.
export async function lastOwnerMessageAt(chatId: number): Promise<Date | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT MAX(created_at) AS at FROM messages_log
    WHERE chat_id = ${chatId}
      AND from_owner = TRUE
      AND source IS NULL`;
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
  mediaKind: string | null;
  mediaFileId: string | null;
  transcript: string | null;
  transcriptAt: Date | null;
  mediaDescription: string | null;
  mediaDescriptionAt: Date | null;
  otpCode: string | null;
  deletedAt: Date | null;
  editedAt: Date | null;
  editCount: number;
  fromOwner: boolean;
  source: string | null;
  chatMode: ChatMode;
  // Per-chat custom labels from chat_rules — when present, the UI
  // should prefer these over senderName (which is the raw Telegram-
  // supplied first name). Only filled for DMs / chats where the
  // operator has labelled the chat.
  chatFirstName: string | null;
  chatLastName: string | null;
  chatNickname: string | null;
  inlineButtons: Array<{ label: string; url: string }> | null;
  isPrivateConversation: boolean;
  privateRevealedAt: Date | null;
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
    mediaKind: (r.media_kind as string) ?? null,
    mediaFileId: (r.media_file_id as string) ?? null,
    transcript: (r.transcript as string) ?? null,
    transcriptAt: (r.transcript_at as Date) ?? null,
    mediaDescription: (r.media_description as string) ?? null,
    mediaDescriptionAt: (r.media_description_at as Date) ?? null,
    otpCode: (r.otp_code as string) ?? null,
    deletedAt: (r.deleted_at as Date) ?? null,
    editedAt: (r.edited_at as Date) ?? null,
    editCount:
      r.edit_count != null ? Number(r.edit_count) : 0,
    fromOwner: Boolean(r.from_owner),
    source: (r.source as string) ?? null,
    chatMode:
      (CHAT_MODES.includes((r.chat_mode as ChatMode) ?? "secretary")
        ? (r.chat_mode as ChatMode)
        : "secretary"),
    chatFirstName: (r.chat_rule_first_name as string) ?? null,
    chatLastName: (r.chat_rule_last_name as string) ?? null,
    chatNickname: (r.chat_rule_nickname as string) ?? null,
    inlineButtons: parseInlineButtons(r.inline_buttons),
    isPrivateConversation: Boolean(r.is_private_conversation),
    privateRevealedAt: (r.private_revealed_at as Date) ?? null,
  };
}

function parseInlineButtons(
  raw: unknown,
): Array<{ label: string; url: string }> | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const out: Array<{ label: string; url: string }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const it = item as { label?: unknown; url?: unknown };
    const label = typeof it.label === "string" ? it.label : "";
    const url = typeof it.url === "string" ? it.url : "";
    if (label && url) out.push({ label, url });
  }
  return out.length > 0 ? out : null;
}

export async function listMessages(opts: {
  urgentOnly?: boolean;
  unhandledOnly?: boolean;
  chatId?: number;
  search?: string;
  kind?: "all" | "deleted" | "edited";
  limit?: number;
  offset?: number;
}): Promise<MessageRow[]> {
  await ensureSchema();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = sql();
  const search = opts.search ? `%${opts.search}%` : null;
  const kind = opts.kind ?? "all";
  const onlyDeleted = kind === "deleted";
  const onlyEdited = kind === "edited";
  const rows = await q`
    SELECT m.*, COALESCE(r.mode, 'secretary') AS chat_mode,
           r.first_name AS chat_rule_first_name,
           r.last_name  AS chat_rule_last_name,
           r.nickname   AS chat_rule_nickname,
           (SELECT COUNT(*)::int FROM message_edits e WHERE e.message_log_id = m.id) AS edit_count
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE (${opts.urgentOnly ?? false}::boolean = FALSE OR m.urgent = TRUE)
      AND (${opts.unhandledOnly ?? false}::boolean = FALSE OR m.handled_at IS NULL)
      AND (${opts.chatId ?? null}::bigint IS NULL OR m.chat_id = ${opts.chatId ?? null}::bigint)
      AND (${search}::text IS NULL OR m.message_text ILIKE ${search} OR m.sender_name ILIKE ${search})
      AND (${onlyDeleted}::boolean = FALSE OR m.deleted_at IS NOT NULL)
      AND (
        ${onlyEdited}::boolean = FALSE
        OR EXISTS (SELECT 1 FROM message_edits e WHERE e.message_log_id = m.id)
      )
    ORDER BY m.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(rowToMessage);
}

// --- Thread summaries ---

export type ThreadSummary = {
  id: number;
  chatId: number;
  threadStartedAt: Date;
  threadEndedAt: Date;
  messageCount: number;
  summary: string;
  topics: string[];
  actionItems: string[];
  createdAt: Date;
};

function rowToThreadSummary(r: Record<string, unknown>): ThreadSummary {
  const topicsRaw = r.topics;
  const actionsRaw = r.action_items;
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    threadStartedAt: r.thread_started_at as Date,
    threadEndedAt: r.thread_ended_at as Date,
    messageCount: Number(r.message_count),
    summary: r.summary as string,
    topics: Array.isArray(topicsRaw)
      ? (topicsRaw.filter((x) => typeof x === "string") as string[])
      : [],
    actionItems: Array.isArray(actionsRaw)
      ? (actionsRaw.filter((x) => typeof x === "string") as string[])
      : [],
    createdAt: r.created_at as Date,
  };
}

// Record where we posted the summary, so a reply to that message in
// the summary_inbox can be routed back to the source chat. Called
// after sendMessage to the inbox returns the new message id.
export async function setThreadSummaryInbox(args: {
  chatId: number;
  threadStartedAt: Date;
  inboxChatId: number;
  inboxMessageId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE thread_summaries
    SET inbox_chat_id = ${args.inboxChatId},
        inbox_message_id = ${args.inboxMessageId}
    WHERE chat_id = ${args.chatId}
      AND thread_started_at = ${args.threadStartedAt.toISOString()}`;
}

// Look up the source chat for a reply that landed in the
// summary_inbox. Used by the channel-post / inbox-reply handler.
export async function findThreadByInboxMessage(
  inboxChatId: number,
  inboxMessageId: number,
): Promise<{ chatId: number; threadStartedAt: Date } | null> {
  if (!hasDb()) return null;
  const rows = await sql()`
    SELECT chat_id, thread_started_at
    FROM thread_summaries
    WHERE inbox_chat_id = ${inboxChatId}
      AND inbox_message_id = ${inboxMessageId}
    LIMIT 1`;
  const r = rows[0] as
    | { chat_id: string; thread_started_at: Date }
    | undefined;
  if (!r) return null;
  return {
    chatId: Number(r.chat_id),
    threadStartedAt: r.thread_started_at,
  };
}

export async function upsertThreadSummary(args: {
  chatId: number;
  threadStartedAt: Date;
  threadEndedAt: Date;
  messageCount: number;
  summary: string;
  topics: string[];
  actionItems: string[];
}): Promise<ThreadSummary> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO thread_summaries (
      chat_id, thread_started_at, thread_ended_at, message_count,
      summary, topics, action_items
    ) VALUES (
      ${args.chatId}, ${args.threadStartedAt.toISOString()},
      ${args.threadEndedAt.toISOString()}, ${args.messageCount},
      ${args.summary},
      ${JSON.stringify(args.topics)}::jsonb,
      ${JSON.stringify(args.actionItems)}::jsonb
    )
    ON CONFLICT (chat_id, thread_started_at) DO UPDATE SET
      thread_ended_at = EXCLUDED.thread_ended_at,
      message_count = EXCLUDED.message_count,
      summary = EXCLUDED.summary,
      topics = EXCLUDED.topics,
      action_items = EXCLUDED.action_items,
      created_at = NOW()
    RETURNING id, chat_id, thread_started_at, thread_ended_at,
              message_count, summary, topics, action_items, created_at`;
  return rowToThreadSummary(rows[0] as Record<string, unknown>);
}

export async function listThreadSummaries(
  chatId: number,
  threadStartedAts: Date[],
): Promise<ThreadSummary[]> {
  if (!hasDb() || threadStartedAts.length === 0) return [];
  await ensureSchema();
  const isoList = threadStartedAts.map((d) => d.toISOString());
  const rows = await sql()`
    SELECT id, chat_id, thread_started_at, thread_ended_at,
           message_count, summary, topics, action_items, created_at
    FROM thread_summaries
    WHERE chat_id = ${chatId}
      AND thread_started_at = ANY(${isoList}::timestamptz[])`;
  return (rows as Array<Record<string, unknown>>).map(rowToThreadSummary);
}

// Cluster a chat's messages into threads by time gap (default: a >5min
// silence starts a new thread). Used by the ai_listen mode dashboard so
// the owner can scan what happened during periods they weren't looking
// at the chat. Returns one row per message, tagged with the thread it
// belongs to; callers group by threadNo client-side.
export type ThreadedMessageRow = MessageRow & { threadNo: number };

export async function listChatThreaded(opts: {
  chatId: number;
  gapMinutes?: number;
  limit?: number;
}): Promise<ThreadedMessageRow[]> {
  await ensureSchema();
  const gap = Math.max(1, Math.min(opts.gapMinutes ?? 5, 240));
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const rows = await sql()`
    WITH ordered AS (
      SELECT m.*, LAG(m.created_at) OVER (ORDER BY m.created_at) AS prev_at
      FROM messages_log m
      WHERE m.chat_id = ${opts.chatId}
        AND COALESCE(m.skipped_reason, '') <> 'muted'
    ),
    flagged AS (
      SELECT *,
        CASE
          WHEN prev_at IS NULL
            OR EXTRACT(EPOCH FROM (created_at - prev_at)) > ${gap * 60}
          THEN 1 ELSE 0
        END AS is_new_thread
      FROM ordered
    ),
    numbered AS (
      SELECT *,
        SUM(is_new_thread) OVER (ORDER BY created_at) AS thread_no
      FROM flagged
    ),
    latest_threads AS (
      SELECT DISTINCT thread_no
      FROM numbered
      ORDER BY thread_no DESC
      LIMIT 30
    )
    SELECT n.*, COALESCE(r.mode, 'off') AS chat_mode
    FROM numbered n
    LEFT JOIN chat_rules r ON r.chat_id = n.chat_id
    WHERE n.thread_no IN (SELECT thread_no FROM latest_threads)
    ORDER BY n.created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    ...rowToMessage(r),
    threadNo: Number((r as { thread_no: number }).thread_no),
  }));
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

export async function bulkMarkMessagesHandled(
  ids: number[],
  actorId: number,
  handled: boolean,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  await ensureSchema();
  const rows = handled
    ? await sql()`
        UPDATE messages_log
        SET handled_at = NOW(), handled_by = ${actorId}
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`
    : await sql()`
        UPDATE messages_log
        SET handled_at = NULL, handled_by = NULL
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`;
  return rows.length;
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
