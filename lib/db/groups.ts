// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { boardPromptCache } from "./board";
import { ensureSchema, hasDb, sql } from "./core";

// --- Group analytics cache + share token ---

export type GroupAnalyticsCache = {
  chatId: number;
  chatTitle: string | null;
  windowDays: number;
  sinceIso: string;
  messageCount: number;
  analysis: unknown;
  createdAt: Date;
};

function rowToGroupAnalyticsCache(
  r: Record<string, unknown>,
): GroupAnalyticsCache {
  return {
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    windowDays: Number(r.window_days),
    sinceIso: r.since_iso as string,
    messageCount: Number(r.message_count),
    analysis: r.analysis,
    createdAt: r.created_at as Date,
  };
}

export async function deleteGroupAnalytics(chatId: number): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    DELETE FROM group_analytics WHERE chat_id = ${chatId} RETURNING id`;
  return (rows as Array<unknown>).length;
}

// Which analytics windows actually have a cached report for this chat.
// The public share page uses this so it only offers windows that will
// really render something.
export async function listCachedAnalyticsWindows(
  chatId: number,
): Promise<Array<{ windowDays: number; createdAt: string; messageCount: number }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT window_days, message_count, created_at
      FROM group_analytics WHERE chat_id = ${chatId}
     ORDER BY window_days ASC`;
  return rows.map((r) => ({
    windowDays: Number(r.window_days ?? 0),
    messageCount: Number(r.message_count ?? 0),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ""),
  }));
}

export async function getCachedGroupAnalytics(
  chatId: number,
  windowDays: number,
): Promise<GroupAnalyticsCache | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_title, window_days, since_iso, message_count, analysis, created_at
    FROM group_analytics
    WHERE chat_id = ${chatId} AND window_days = ${windowDays}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToGroupAnalyticsCache(r) : null;
}

export async function upsertGroupAnalytics(args: {
  chatId: number;
  chatTitle: string | null;
  windowDays: number;
  sinceIso: string;
  messageCount: number;
  analysis: unknown;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO group_analytics (chat_id, chat_title, window_days, since_iso, message_count, analysis)
    VALUES (${args.chatId}, ${args.chatTitle}, ${args.windowDays}, ${args.sinceIso},
            ${args.messageCount}, ${JSON.stringify(args.analysis)}::jsonb)
    ON CONFLICT (chat_id, window_days) DO UPDATE SET
      chat_title = EXCLUDED.chat_title,
      since_iso = EXCLUDED.since_iso,
      message_count = EXCLUDED.message_count,
      analysis = EXCLUDED.analysis,
      created_at = NOW()`;
}

export async function getGroupAnalyticsShareToken(
  chatId: number,
): Promise<string | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT analytics_share_token FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as { analytics_share_token: string | null } | undefined;
  return r?.analytics_share_token ?? null;
}

export async function setGroupAnalyticsShareToken(args: {
  chatId: number;
  token: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Make sure a chat_rules row exists for this chat so the UPDATE
  // actually hits. The defaults match other code paths that touch
  // chat_rules without a full rule setup.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, analytics_share_token)
    VALUES (${args.chatId}, 'group', ${args.token})
    ON CONFLICT (chat_id) DO UPDATE SET
      analytics_share_token = ${args.token},
      updated_at = NOW()`;
}

// Resolve the chat_id a share token belongs to (used by the editable
// board API to authorise a request by its token instead of a session).
export async function getChatIdByShareToken(token: string): Promise<{
  chatId: number;
  chatTitle: string | null;
  boardCode: string | null;
  boardColumns: string | null;
  boardPrompt: string | null;
  boardLabels: string | null;
  boardPriorities: string | null;
} | null> {
  if (!hasDb() || !token) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_title, board_code, board_columns, board_prompt, board_labels, board_priorities
      FROM chat_rules WHERE analytics_share_token = ${token} LIMIT 1`;
  const r = rows[0] as
    | {
        chat_id: number | string;
        chat_title: string | null;
        board_code: string | null;
        board_columns: string | null;
        board_prompt: string | null;
        board_labels: string | null;
        board_priorities: string | null;
      }
    | undefined;
  return r
    ? {
        chatId: Number(r.chat_id),
        chatTitle: r.chat_title ?? null,
        boardCode: r.board_code ?? null,
        boardColumns: r.board_columns ?? null,
        boardPrompt: r.board_prompt ?? null,
        boardLabels: r.board_labels ?? null,
        boardPriorities: r.board_priorities ?? null,
      }
    : null;
}

export async function setBoardConfig(args: {
  chatId: number;
  code?: string | null;
  columns?: string | null;
  prompt?: string | null;
  labels?: string | null;
  priorities?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules SET
      board_code       = CASE WHEN ${args.code !== undefined} THEN ${args.code ?? null} ELSE board_code END,
      board_columns    = CASE WHEN ${args.columns !== undefined} THEN ${args.columns ?? null} ELSE board_columns END,
      board_prompt     = CASE WHEN ${args.prompt !== undefined} THEN ${args.prompt ?? null} ELSE board_prompt END,
      board_labels     = CASE WHEN ${args.labels !== undefined} THEN ${args.labels ?? null} ELSE board_labels END,
      board_priorities = CASE WHEN ${args.priorities !== undefined} THEN ${args.priorities ?? null} ELSE board_priorities END,
      updated_at = NOW()
    WHERE chat_id = ${args.chatId}`;
  // Drop the cached AI-prompt so the next analysis picks up the edit.
  if (args.prompt !== undefined) boardPromptCache.delete(args.chatId);
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

export type GroupListRow = {
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  messages: number;
  senders: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
  summaryCount: number;
  lastSummaryAt: Date | null;
  hasAnalysis: boolean;
  shareToken: string | null;
};

// EVERY group the bot has seen — not just the ones that happen to have a
// summary already. The dashboard used to list group_summaries, so a group
// the bot had just joined was invisible: you could not summarise it and
// could not reach its share settings, because both live behind a link
// that only rendered for groups already in that table.
export async function listAllGroups(): Promise<GroupListRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT
      m.chat_id,
      (ARRAY_AGG(m.chat_title ORDER BY m.created_at DESC)
         FILTER (WHERE m.chat_title IS NOT NULL))[1] AS chat_title,
      (ARRAY_AGG(m.chat_type ORDER BY m.created_at DESC))[1] AS chat_type,
      COUNT(*)::int AS messages,
      COUNT(DISTINCT m.sender_id)::int AS senders,
      MIN(m.created_at) AS first_seen,
      MAX(m.created_at) AS last_seen,
      COALESCE(s.n, 0)::int AS summary_count,
      s.last_at AS last_summary_at,
      EXISTS (SELECT 1 FROM group_analytics g WHERE g.chat_id = m.chat_id) AS has_analysis,
      r.analytics_share_token AS share_token
    FROM messages_log m
    LEFT JOIN (
      SELECT chat_id, COUNT(*) AS n, MAX(created_at) AS last_at
      FROM group_summaries GROUP BY chat_id
    ) s ON s.chat_id = m.chat_id
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE m.chat_type IN ('group', 'supergroup')
    GROUP BY m.chat_id, s.n, s.last_at, r.analytics_share_token
    ORDER BY MAX(m.created_at) DESC`;
  return rows.map((r) => ({
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    chatType: (r.chat_type as string) ?? "group",
    messages: Number(r.messages),
    senders: Number(r.senders),
    firstSeen: (r.first_seen as Date) ?? null,
    lastSeen: (r.last_seen as Date) ?? null,
    summaryCount: Number(r.summary_count ?? 0),
    lastSummaryAt: (r.last_summary_at as Date) ?? null,
    hasAnalysis: Boolean(r.has_analysis),
    shareToken: (r.share_token as string) ?? null,
  }));
}

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
  businessConnectionId: string | null;
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

// Flat per-chat message dump for AI analytics. Returns messages from a
// single chat over a time window, oldest first, so the model sees the
// natural conversation flow when classifying announce/in-progress/done
// task lifecycles on /groups/[id].
export async function listChatMessagesForAnalysis(args: {
  chatId: number;
  since: Date;
  limit?: number;
}): Promise<{
  chatTitle: string | null;
  messages: {
    sender: string;
    text: string;
    at: Date;
    fromOwner: boolean;
    messageThreadId: number | null;
  }[];
}> {
  await ensureSchema();
  const limit = Math.min(Math.max(args.limit ?? 1500, 1), 5000);
  const rows = await sql()`
    SELECT chat_title, sender_name, message_text, transcript,
           media_description, media_kind, created_at, from_owner,
           message_thread_id
    FROM messages_log
    WHERE chat_id = ${args.chatId}
      AND created_at >= ${args.since.toISOString()}
      AND COALESCE(skipped_reason, '') <> 'muted'
      AND (
        message_thread_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM forum_topics ft
          WHERE ft.chat_id = ${args.chatId}
            AND ft.message_thread_id = messages_log.message_thread_id
            AND ft.archived_at IS NOT NULL
        )
      )
    ORDER BY created_at ASC
    LIMIT ${limit}`;
  let chatTitle: string | null = null;
  const messages: {
    sender: string;
    text: string;
    at: Date;
    fromOwner: boolean;
    messageThreadId: number | null;
  }[] = [];
  for (const r of rows) {
    if (!chatTitle && r.chat_title) chatTitle = r.chat_title as string;
    const transcript = (r.transcript as string) ?? null;
    const desc = (r.media_description as string) ?? null;
    const kind = (r.media_kind as string) ?? null;
    const body = (r.message_text as string) ?? "";
    let text = body;
    if (!text && transcript) text = `[voice] ${transcript}`;
    else if (!text && desc) text = `[${kind ?? "media"}] ${desc}`;
    else if (!text && kind) text = `[${kind}]`;
    if (!text) continue;
    messages.push({
      sender: (r.sender_name as string) ?? "?",
      text,
      at: r.created_at as Date,
      fromOwner: Boolean(r.from_owner),
      messageThreadId:
        r.message_thread_id != null ? Number(r.message_thread_id) : null,
    });
  }
  return { chatTitle, messages };
}

export async function groupActivityForPeriod(args: {
  start: Date;
  end: Date;
}): Promise<
  Array<{
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    businessConnectionId: string | null;
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
      businessConnectionId: string | null;
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
        businessConnectionId: (r.business_connection_id as string) ?? null,
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
