// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";

// --- Note watchlist ---

export type NoteWatchItem = {
  id: number;
  concept: string;
  description: string | null;
  enabled: boolean;
  matchCount: number;
  lastMatchedAt: Date | null;
  emoji: string | null;
  priority: "low" | "normal" | "high";
  forwardToInbox: boolean;
  cooldownOverrideMinutes: number | null;
  // Domain the concept lives in — e.g. "music / singer / concert".
  // The scanner only fires when the message is clearly in this
  // context AND contains the concept / an alias. Null = no
  // context filter (match purely on string presence).
  context: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NoteWatchMatch = {
  id: number;
  itemId: number;
  chatId: number;
  chatTitle: string | null;
  messageLogId: number | null;
  sourceMessageId: number | null;
  senderName: string | null;
  quote: string;
  reason: string | null;
  forwardedTo: number | null;
  createdAt: Date;
};

function rowToNoteWatchItem(r: Record<string, unknown>): NoteWatchItem {
  const rawPri = (r.priority as string) ?? "normal";
  const priority: NoteWatchItem["priority"] =
    rawPri === "low" || rawPri === "high" ? rawPri : "normal";
  return {
    id: Number(r.id),
    concept: r.concept as string,
    description: (r.description as string) ?? null,
    enabled: Boolean(r.enabled),
    matchCount: Number(r.match_count ?? 0),
    lastMatchedAt: (r.last_matched_at as Date) ?? null,
    emoji: (r.emoji as string) ?? null,
    priority,
    forwardToInbox:
      r.forward_to_inbox == null ? true : Boolean(r.forward_to_inbox),
    cooldownOverrideMinutes:
      r.cooldown_override_minutes != null
        ? Number(r.cooldown_override_minutes)
        : null,
    context: (r.context as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export function rowToNoteWatchMatch(r: Record<string, unknown>): NoteWatchMatch {
  return {
    id: Number(r.id),
    itemId: Number(r.item_id),
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    messageLogId: r.message_log_id != null ? Number(r.message_log_id) : null,
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    senderName: (r.sender_name as string) ?? null,
    quote: r.quote as string,
    reason: (r.reason as string) ?? null,
    forwardedTo: r.forwarded_to != null ? Number(r.forwarded_to) : null,
    createdAt: r.created_at as Date,
  };
}

export async function listNoteWatchItems(args?: {
  enabledOnly?: boolean;
}): Promise<NoteWatchItem[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const rows = await sql()`
    SELECT id, concept, description, enabled, match_count, last_matched_at,
           emoji, priority, forward_to_inbox, cooldown_override_minutes,
           context, created_at, updated_at
    FROM note_watch_items
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToNoteWatchItem);
}

export async function getNoteWatchItem(
  id: number,
): Promise<NoteWatchItem | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, concept, description, enabled, match_count, last_matched_at,
           emoji, priority, forward_to_inbox, cooldown_override_minutes,
           context, created_at, updated_at
    FROM note_watch_items WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchItem(r) : null;
}

export async function createNoteWatchItem(args: {
  concept: string;
  description?: string | null;
  enabled?: boolean;
}): Promise<NoteWatchItem> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO note_watch_items (concept, description, enabled)
    VALUES (${args.concept}, ${args.description ?? null}, ${args.enabled ?? true})
    RETURNING id, concept, description, enabled, match_count, last_matched_at,
              emoji, priority, forward_to_inbox, cooldown_override_minutes,
              context, created_at, updated_at`;
  return rowToNoteWatchItem(rows[0] as Record<string, unknown>);
}

export async function updateNoteWatchItem(
  id: number,
  patch: Partial<{
    concept: string;
    description: string | null;
    enabled: boolean;
    emoji: string | null;
    priority: "low" | "normal" | "high";
    forwardToInbox: boolean;
    cooldownOverrideMinutes: number | null;
    context: string | null;
  }>,
): Promise<NoteWatchItem | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Use markers for nullable fields so we can tell "leave alone"
  // (undefined) from "set to NULL" (null).
  const descMarker = patch.description === undefined ? 0 : 1;
  const descValue = patch.description ?? null;
  const emojiMarker = patch.emoji === undefined ? 0 : 1;
  const emojiValue = patch.emoji ?? null;
  const cooldownMarker =
    patch.cooldownOverrideMinutes === undefined ? 0 : 1;
  const cooldownValue = patch.cooldownOverrideMinutes ?? null;
  const contextMarker = patch.context === undefined ? 0 : 1;
  const contextValue = patch.context ?? null;
  const rows = await sql()`
    UPDATE note_watch_items SET
      concept = COALESCE(${patch.concept ?? null}, concept),
      description = CASE WHEN ${descMarker}::int = 1 THEN ${descValue} ELSE description END,
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      emoji = CASE WHEN ${emojiMarker}::int = 1 THEN ${emojiValue} ELSE emoji END,
      priority = COALESCE(${patch.priority ?? null}, priority),
      forward_to_inbox = COALESCE(${patch.forwardToInbox ?? null}::boolean, forward_to_inbox),
      cooldown_override_minutes = CASE
        WHEN ${cooldownMarker}::int = 1 THEN ${cooldownValue}::int
        ELSE cooldown_override_minutes
      END,
      context = CASE WHEN ${contextMarker}::int = 1 THEN ${contextValue} ELSE context END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, concept, description, enabled, match_count, last_matched_at,
              emoji, priority, forward_to_inbox, cooldown_override_minutes,
              context, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchItem(r) : null;
}

export async function deleteNoteWatchItem(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM note_watch_items WHERE id = ${id}`;
}

export type NoteWatchAlias = {
  id: number;
  itemId: number;
  alias: string;
  createdAt: Date;
};

export async function listNoteWatchAliases(
  itemId?: number,
): Promise<NoteWatchAlias[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = itemId
    ? await sql()`
        SELECT id, item_id, alias, created_at
        FROM note_watch_aliases
        WHERE item_id = ${itemId}
        ORDER BY created_at ASC`
    : await sql()`
        SELECT id, item_id, alias, created_at
        FROM note_watch_aliases
        ORDER BY item_id, created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    itemId: Number(r.item_id),
    alias: r.alias as string,
    createdAt: r.created_at as Date,
  }));
}

export async function addNoteWatchAlias(args: {
  itemId: number;
  alias: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO note_watch_aliases (item_id, alias)
    VALUES (${args.itemId}, ${args.alias})
    ON CONFLICT (item_id, alias) DO NOTHING`;
}

export async function deleteNoteWatchAlias(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM note_watch_aliases WHERE id = ${id}`;
}

// One-shot fetch used by the bot scanner: every enabled concept with
// its alias list inlined. Keeps the scanner from issuing N+1 lookups
// per message.
export async function listNoteWatchItemsWithAliases(args?: {
  enabledOnly?: boolean;
}): Promise<Array<NoteWatchItem & { aliases: string[] }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const items = await listNoteWatchItems({
    enabledOnly: args?.enabledOnly ?? false,
  });
  if (items.length === 0) return [];
  const allAliases = await listNoteWatchAliases();
  const byItem = new Map<number, string[]>();
  for (const a of allAliases) {
    const arr = byItem.get(a.itemId) ?? [];
    arr.push(a.alias);
    byItem.set(a.itemId, arr);
  }
  return items.map((it) => ({ ...it, aliases: byItem.get(it.id) ?? [] }));
}

export async function recordNoteWatchMatch(args: {
  itemId: number;
  chatId: number;
  chatTitle: string | null;
  messageLogId: number | null;
  sourceMessageId: number | null;
  senderName: string | null;
  quote: string;
  reason: string | null;
  forwardedTo: number | null;
}): Promise<NoteWatchMatch | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO note_watch_matches (
      item_id, chat_id, chat_title, message_log_id, source_message_id,
      sender_name, quote, reason, forwarded_to
    ) VALUES (
      ${args.itemId}, ${args.chatId}, ${args.chatTitle},
      ${args.messageLogId}, ${args.sourceMessageId},
      ${args.senderName}, ${args.quote}, ${args.reason}, ${args.forwardedTo}
    )
    RETURNING id, item_id, chat_id, chat_title, message_log_id, source_message_id,
              sender_name, quote, reason, forwarded_to, created_at`;
  await sql()`
    UPDATE note_watch_items
    SET match_count = match_count + 1, last_matched_at = NOW()
    WHERE id = ${args.itemId}`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToNoteWatchMatch(r) : null;
}

// Cooldown gate: returns true when there's already a recent match
// for this (itemId, chatId) within the window — caller should skip
// the LLM call / forward to keep one chat from spamming the inbox.
export async function hasRecentNoteWatchMatch(args: {
  itemId: number;
  chatId: number;
  withinMinutes: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  if (args.withinMinutes <= 0) return false;
  const rows = await sql()`
    SELECT 1 FROM note_watch_matches
    WHERE item_id = ${args.itemId}
      AND chat_id = ${args.chatId}
      AND created_at > NOW() - make_interval(mins => ${args.withinMinutes})
    LIMIT 1`;
  return rows.length > 0;
}

// Archive sweeper used by the optional notesAutoArchiveDays setting.
// Marks every non-archived chat_notes row older than `days` as
// archived. Returns the number affected so the cron can log it.
export async function archiveOldChatNotes(days: number): Promise<number> {
  if (!hasDb() || days <= 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    UPDATE chat_notes
    SET archived_at = NOW()
    WHERE archived_at IS NULL
      AND created_at < NOW() - make_interval(days => ${days})
    RETURNING id`;
  return rows.length;
}

export async function listNoteWatchMatches(args?: {
  itemId?: number;
  limit?: number;
  offset?: number;
}): Promise<NoteWatchMatch[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(Math.max(args?.limit ?? 50, 1), 200);
  const offset = Math.max(args?.offset ?? 0, 0);
  const rows = await sql()`
    SELECT id, item_id, chat_id, chat_title, message_log_id, source_message_id,
           sender_name, quote, reason, forwarded_to, created_at
    FROM note_watch_matches
    WHERE (${args?.itemId ?? null}::bigint IS NULL OR item_id = ${args?.itemId ?? null}::bigint)
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map(rowToNoteWatchMatch);
}

// --- Extracted reminders/events/tasks ---

const VALID_PRIORITIES = new Set(["urgent", "high", "normal", "low"]);
function normalisePriority(p: string | null | undefined): string {
  const v = (p ?? "").toLowerCase().trim();
  return VALID_PRIORITIES.has(v) ? v : "normal";
}

export type ExtractedItem = {
  id: number;
  messageId: number | null;
  tgMessageId: number | null;
  chatId: number | null;
  chatTitle: string | null;
  senderName: string | null;
  kind: string;
  priority: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  location: string | null;
  participants: string[] | null;
  sourceText: string | null;
  doneAt: Date | null;
  createdAt: Date;
};

export async function saveExtractedItems(items: Array<{
  messageId: number | null;
  tgMessageId?: number | null;
  chatId: number | null;
  chatTitle: string | null;
  senderName: string | null;
  kind: string;
  priority?: string | null;
  title: string;
  description?: string | null;
  dueAt?: Date | null;
  location?: string | null;
  participants?: string[] | null;
  sourceText?: string | null;
}>): Promise<number> {
  if (!hasDb() || items.length === 0) return 0;
  await ensureSchema();
  let n = 0;
  const q = sql();
  for (const it of items) {
    await q`
      INSERT INTO extracted_items (
        message_id, tg_message_id, chat_id, chat_title, sender_name,
        kind, priority, title, description, due_at, location, participants, source_text
      ) VALUES (
        ${it.messageId}, ${it.tgMessageId ?? null}, ${it.chatId}, ${it.chatTitle}, ${it.senderName},
        ${it.kind}, ${normalisePriority(it.priority)}, ${it.title}, ${it.description ?? null},
        ${it.dueAt ? it.dueAt.toISOString() : null},
        ${it.location ?? null},
        ${it.participants ? JSON.stringify(it.participants) : null}::jsonb,
        ${it.sourceText ?? null}
      )`;
    n++;
  }
  return n;
}

function rowToExtracted(r: Record<string, unknown>): ExtractedItem {
  const p = r.participants as unknown;
  return {
    id: Number(r.id),
    messageId: r.message_id != null ? Number(r.message_id) : null,
    tgMessageId: r.tg_message_id != null ? Number(r.tg_message_id) : null,
    chatId: r.chat_id != null ? Number(r.chat_id) : null,
    chatTitle: (r.chat_title as string) ?? null,
    senderName: (r.sender_name as string) ?? null,
    kind: r.kind as string,
    priority: normalisePriority(r.priority as string | null),
    title: r.title as string,
    description: (r.description as string) ?? null,
    dueAt: (r.due_at as Date) ?? null,
    location: (r.location as string) ?? null,
    participants: Array.isArray(p) ? (p as string[]) : null,
    sourceText: (r.source_text as string) ?? null,
    doneAt: (r.done_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function listExtractedItems(opts: {
  upcoming?: boolean;
  doneOnly?: boolean;
  priority?: string | null;
  limit?: number;
}): Promise<ExtractedItem[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(opts.limit ?? 100, 500);
  // Priority filter is applied as an extra clause to whichever base
  // query the view (upcoming / done / all) selected. null = no filter.
  const prio =
    opts.priority && VALID_PRIORITIES.has(opts.priority)
      ? opts.priority
      : null;
  const rows = opts.upcoming
    ? await sql()`
        SELECT * FROM extracted_items
        WHERE done_at IS NULL
          AND (due_at IS NULL OR due_at > NOW() - INTERVAL '1 day')
          AND (${prio}::text IS NULL OR priority = ${prio})
        ORDER BY
          COALESCE(due_at, created_at + INTERVAL '100 years') ASC,
          created_at DESC
        LIMIT ${limit}`
    : opts.doneOnly
      ? await sql()`
          SELECT * FROM extracted_items
          WHERE done_at IS NOT NULL
            AND (${prio}::text IS NULL OR priority = ${prio})
          ORDER BY done_at DESC LIMIT ${limit}`
      : await sql()`
          SELECT * FROM extracted_items
          WHERE (${prio}::text IS NULL OR priority = ${prio})
          ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(rowToExtracted);
}

export async function markExtractedDone(id: number, done: boolean): Promise<void> {
  if (!hasDb()) return;
  if (done) {
    await sql()`UPDATE extracted_items SET done_at = NOW() WHERE id = ${id}`;
  } else {
    await sql()`UPDATE extracted_items SET done_at = NULL WHERE id = ${id}`;
  }
}

// Bulk versions: caller passes a list of ids and we run a single SQL
// per op. ANY(...) keeps the round-trip cost flat regardless of how
// many items the owner ticked.
export async function bulkMarkExtractedDone(
  ids: number[],
  done: boolean,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = done
    ? await sql()`
        UPDATE extracted_items
        SET done_at = NOW()
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`
    : await sql()`
        UPDATE extracted_items
        SET done_at = NULL
        WHERE id = ANY(${ids}::bigint[])
        RETURNING id`;
  return rows.length;
}

export async function bulkDeleteExtracted(ids: number[]): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = await sql()`
    DELETE FROM extracted_items
    WHERE id = ANY(${ids}::bigint[])
    RETURNING id`;
  return rows.length;
}

export async function bulkSetExtractedKind(
  ids: number[],
  kind: string,
): Promise<number> {
  if (!hasDb() || ids.length === 0) return 0;
  const rows = await sql()`
    UPDATE extracted_items
    SET kind = ${kind}
    WHERE id = ANY(${ids}::bigint[])
    RETURNING id`;
  return rows.length;
}

export async function upcomingReminderCount(): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT COUNT(*)::int AS n FROM extracted_items
    WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at > NOW()`;
  return Number((rows[0] as { n: number })?.n) || 0;
}

// --- Knowledge base ---

export type KnowledgeEntry = {
  id: number;
  title: string;
  aliases: string[];
  body: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

function rowToKnowledge(r: Record<string, unknown>): KnowledgeEntry {
  const aliasesRaw = r.aliases;
  const tagsRaw = r.tags;
  const aliases =
    Array.isArray(aliasesRaw)
      ? (aliasesRaw.filter((x) => typeof x === "string") as string[])
      : [];
  const tags =
    Array.isArray(tagsRaw)
      ? (tagsRaw.filter((x) => typeof x === "string") as string[])
      : [];
  return {
    id: Number(r.id),
    title: r.title as string,
    aliases,
    body: r.body as string,
    tags,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, title, aliases, body, tags, created_at, updated_at
    FROM knowledge_entries
    ORDER BY updated_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToKnowledge);
}

export async function getKnowledge(id: number): Promise<KnowledgeEntry | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, title, aliases, body, tags, created_at, updated_at
    FROM knowledge_entries WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToKnowledge(r) : null;
}

export async function upsertKnowledge(args: {
  id?: number;
  title: string;
  aliases: string[];
  body: string;
  tags: string[];
  createdBy?: number | null;
}): Promise<number> {
  await ensureSchema();
  const aliasesJson = JSON.stringify(args.aliases);
  const tagsJson = JSON.stringify(args.tags);
  if (args.id) {
    await sql()`
      UPDATE knowledge_entries
      SET title = ${args.title},
          aliases = ${aliasesJson}::jsonb,
          body = ${args.body},
          tags = ${tagsJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${args.id}`;
    return args.id;
  }
  const rows = await sql()`
    INSERT INTO knowledge_entries (title, aliases, body, tags, created_by)
    VALUES (${args.title}, ${aliasesJson}::jsonb, ${args.body},
            ${tagsJson}::jsonb, ${args.createdBy ?? null})
    RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

export async function deleteKnowledge(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM knowledge_entries WHERE id = ${id}`;
}

// Substring match the incoming text against every knowledge entry's
// title + aliases (case-insensitive). Returns matches sorted by length
// of the matched needle so longer / more specific terms win. We do this
// in JS because the table is small (single-user app, expected <few-
// hundred entries) and matching with proper word boundaries across
// Persian + English at SQL level would be more code than it's worth.
// Persian/Arabic text written in Telegram is full of variants the
// human eye reads as the same letter but JS sees as different bytes:
// ي vs ی, ك vs ک, ة vs ه, plus invisible ZWNJ / diacritics. Without
// folding all of that into a canonical form, substring matching
// against KB titles silently misses. We also strip the standard
// Arabic harakat and the ZWNJ since they're rarely typed
// consistently.
function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[ؤئ]/g, "ی")
    .replace(/[إأآا]/g, "ا")
    .replace(/[ً-ْٰ‌‍‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findKnowledgeMatches(
  text: string,
  limit = 6,
): Promise<KnowledgeEntry[]> {
  if (!text) return [];
  const haystack = normaliseForMatch(text);
  if (!haystack) return [];
  const all = await listKnowledge();
  const hits: Array<{ entry: KnowledgeEntry; matched: string }> = [];
  for (const e of all) {
    const needles = [e.title, ...e.aliases]
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    let best: string | null = null;
    for (const n of needles) {
      const needle = normaliseForMatch(n);
      if (!needle) continue;
      if (haystack.includes(needle)) {
        if (!best || needle.length > best.length) best = needle;
      }
    }
    if (best) hits.push({ entry: e, matched: best });
  }
  hits.sort((a, b) => b.matched.length - a.matched.length);
  return hits.slice(0, limit).map((h) => h.entry);
}

// --- Ask queries (saved natural-language Q&A) ---

export type AskQuery = {
  id: number;
  prompt: string;
  answer: string;
  scannedMessages: number;
  days: number;
  createdAt: Date;
};

function rowToAsk(r: Record<string, unknown>): AskQuery {
  return {
    id: Number(r.id),
    prompt: r.prompt as string,
    answer: r.answer as string,
    scannedMessages: Number(r.scanned_messages),
    days: Number(r.days),
    createdAt: r.created_at as Date,
  };
}

export async function saveAskQuery(args: {
  prompt: string;
  promptHash: string;
  answer: string;
  scannedMessages: number;
  days: number;
  createdBy?: number | null;
}): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO ask_queries (
      prompt, prompt_hash, answer, scanned_messages, days, created_by
    ) VALUES (
      ${args.prompt}, ${args.promptHash}, ${args.answer},
      ${args.scannedMessages}, ${args.days}, ${args.createdBy ?? null}
    ) RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

// Find the most recent cached answer for an identical (prompt, days)
// pair within the last `ttlMinutes`. Returns null when no fresh hit
// exists; the caller can then run the AI and cache the new result.
export async function findCachedAsk(
  promptHash: string,
  days: number,
  ttlMinutes: number,
): Promise<AskQuery | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, prompt, answer, scanned_messages, days, created_at
    FROM ask_queries
    WHERE prompt_hash = ${promptHash}
      AND days = ${days}
      AND created_at > NOW() - (${ttlMinutes} || ' minutes')::INTERVAL
    ORDER BY created_at DESC
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToAsk(r) : null;
}

export async function listAskQueries(limit = 30): Promise<AskQuery[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = await sql()`
    SELECT id, prompt, answer, scanned_messages, days, created_at
    FROM ask_queries
    ORDER BY created_at DESC LIMIT ${cap}`;
  return (rows as Array<Record<string, unknown>>).map(rowToAsk);
}

export async function getAskQuery(id: number): Promise<AskQuery | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, prompt, answer, scanned_messages, days, created_at
    FROM ask_queries WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToAsk(r) : null;
}

export async function deleteAskQuery(id: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`DELETE FROM ask_queries WHERE id = ${id}`;
}
