// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { randomBytes } from "node:crypto";
import { ensureSchema, hasDb, sql } from "./core";
import { MessageRule, RuleMatch, rowToRule } from "./rules";

// --- Media routing log ---

export type MediaRoutingDecision =
  | "routed" // voice/video/photo copied to target storage chat
  | "no_rule" // source chat has no chat_rules row
  | "flag_off" // auto_forward_* is false on the source chat
  | "muted" // source chat muted, so we skip routing
  | "no_target" // no chat tagged with the target role
  | "error" // sendXxx call threw
  | "received_business" // diagnostic: media reached handleBusinessMessage
  | "received_group" // diagnostic: media reached handleAnyChatPost
  | "received_secretary" // diagnostic: media reached handleSecretaryReply
  | "received_edit" // diagnostic: media reached handleBusinessEdit
  | "skipped_bot_echo" // diagnostic: returned at the sender_business_bot guard
  | "skipped_no_owner" // diagnostic: resolveOwner returned null
  | "skipped_owner_self" // diagnostic: entered the owner-self branch but
  //                          maybeRouteMedia was NOT called from here yet
  | "passed_to_router" // diagnostic: about to call maybeRouteMedia
  | "skipped_no_bcid" // diagnostic: business_message without business_connection_id
  | "skipped_no_content"; // diagnostic: hasContent guard returned false

export type MediaRoutingLogEntry = {
  id: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  kind: string;
  decision: MediaRoutingDecision;
  targetRole: string | null;
  targetChatId: number | null;
  targetMessageId: number | null;
  error: string | null;
  createdAt: Date;
};

export async function logMediaRouting(args: {
  sourceChatId: number;
  sourceMessageId?: number | null;
  kind: string;
  decision: MediaRoutingDecision;
  targetRole?: string | null;
  targetChatId?: number | null;
  targetMessageId?: number | null;
  error?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    INSERT INTO media_routing_log (
      source_chat_id, source_message_id, kind, decision,
      target_role, target_chat_id, target_message_id, error
    )
    VALUES (${args.sourceChatId}, ${args.sourceMessageId ?? null},
            ${args.kind}, ${args.decision},
            ${args.targetRole ?? null}, ${args.targetChatId ?? null},
            ${args.targetMessageId ?? null}, ${args.error ?? null})`;
}

export async function listMediaRoutingLog(opts: {
  chatId?: number | null;
  decision?: MediaRoutingDecision;
  limit?: number;
} = {}): Promise<MediaRoutingLogEntry[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, source_chat_id, source_message_id, kind, decision,
           target_role, target_chat_id, target_message_id, error, created_at
    FROM media_routing_log
    WHERE (${opts.chatId ?? null}::bigint IS NULL OR source_chat_id = ${opts.chatId ?? null})
      AND (${opts.decision ?? null}::text IS NULL OR decision = ${opts.decision ?? null})
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 200}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id == null ? null : Number(r.source_message_id),
    kind: r.kind as string,
    decision: r.decision as MediaRoutingDecision,
    targetRole: (r.target_role as string) ?? null,
    targetChatId: r.target_chat_id == null ? null : Number(r.target_chat_id),
    targetMessageId:
      r.target_message_id == null ? null : Number(r.target_message_id),
    error: (r.error as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function markAutoSummaryDelivered(chatId: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE chat_rules
    SET last_auto_summary_at = NOW(), updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

export async function saveOtpCode(
  messageLogId: number,
  code: string,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE messages_log
    SET otp_code = ${code}
    WHERE id = ${messageLogId}`;
}

// Save a phone → identity mapping observed from a Telegram contact
// share. Idempotent on (phone_tail, telegram_user_id) — repeated
// shares only refresh observed_at + names.
export async function recordPhoneContact(args: {
  phoneFull: string;
  telegramUserId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  source?: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const digits = args.phoneFull.replace(/\D/g, "");
  if (digits.length < 6) return;
  const tail = digits.slice(-9);
  // Existing row with same tail + user_id (or both with null user)?
  const existing = await sql()`
    SELECT id FROM phone_contacts
    WHERE phone_tail = ${tail}
      AND COALESCE(telegram_user_id, 0) = COALESCE(${args.telegramUserId ?? null}, 0)
    LIMIT 1`;
  if ((existing as unknown[]).length > 0) {
    await sql()`
      UPDATE phone_contacts
      SET observed_at = NOW(),
          first_name = COALESCE(${args.firstName ?? null}, first_name),
          last_name  = COALESCE(${args.lastName ?? null}, last_name),
          username   = COALESCE(${args.username ?? null}, username),
          phone_full = ${args.phoneFull}
      WHERE id = ${Number((existing[0] as { id: string }).id)}`;
    return;
  }
  await sql()`
    INSERT INTO phone_contacts (
      phone_full, phone_tail, telegram_user_id, first_name, last_name, username, source
    ) VALUES (
      ${args.phoneFull}, ${tail}, ${args.telegramUserId ?? null},
      ${args.firstName ?? null}, ${args.lastName ?? null}, ${args.username ?? null},
      ${args.source ?? "contact_share"}
    )`;
}

// Lookup a phone tail → best-known identity. Prefers entries with a
// telegram_user_id (we actually know the user) over name-only ones.
export async function lookupPhoneContact(phone: string): Promise<{
  name: string | null;
  telegramUserId: number | null;
  username: string | null;
} | null> {
  if (!hasDb() || !phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const tail = digits.slice(-9);
  await ensureSchema();
  const rows = await sql()`
    SELECT first_name, last_name, username, telegram_user_id
    FROM phone_contacts
    WHERE phone_tail = ${tail}
    ORDER BY (telegram_user_id IS NOT NULL) DESC, observed_at DESC
    LIMIT 1`;
  const r = rows[0] as
    | {
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        telegram_user_id: string | number | null;
      }
    | undefined;
  if (!r) return null;
  const name =
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
    r.username ||
    null;
  return {
    name,
    telegramUserId: r.telegram_user_id == null ? null : Number(r.telegram_user_id),
    username: r.username,
  };
}

// Best-guess identity for a phone number, based on past messages
// the bot has logged. Tries a few strategies in priority order:
//   1. chat_rules row whose notes/relationship_notes mention the
//      number tail (operator manually labelled them).
//   2. messages_log row mentioning the number tail — most-mentioning
//      chat wins; uses the chat's first_name/last_name/nickname.
// Returns null when nothing matches; the SMS forwarder then falls
// back to "☎️ +PHONE" with no name.
export async function findOwnerOfPhone(phone: string): Promise<{
  name: string | null;
  chatId: number | null;
} | null> {
  if (!phone || !hasDb()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  // Use the LAST 8 digits so "+989121234567" and "09121234567" both
  // match "121234567" (Iran mobile mid-section). Long enough to be
  // distinctive but tolerant of country code variations.
  const tail = digits.slice(-8);
  await ensureSchema();
  // Strategy 0a: operator-entered chat_rules.phone_number — most
  // authoritative because the operator typed it specifically to
  // bind this person ↔ this number. We match on the same 8-digit
  // tail used elsewhere.
  const phoneRows = await sql()`
    SELECT chat_id, first_name, last_name, nickname
    FROM chat_rules
    WHERE phone_number IS NOT NULL
      AND regexp_replace(phone_number, '\\D', '', 'g') LIKE ${`%${tail}`}
    LIMIT 1`;
  if ((phoneRows as unknown[]).length > 0) {
    const r = phoneRows[0] as Record<string, unknown>;
    const name =
      [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
      (r.nickname as string) ||
      null;
    return { name: name || null, chatId: Number(r.chat_id) };
  }
  // Strategy 0b: phone_contacts table populated from harvested
  // contact shares — most reliable identity source we have because
  // it carries an actual telegram_user_id when available.
  const phoneHit = await lookupPhoneContact(phone).catch(() => null);
  if (phoneHit?.name) {
    return { name: phoneHit.name, chatId: phoneHit.telegramUserId };
  }
  // Earlier revisions also fell back to ILIKE scans over
  // chat_rules.notes and messages_log.message_text but both turned
  // out to be noisy in practice — random conversations that
  // happened to contain the same 9 digits ("زهرا شیخ", an SMS
  // aggregator channel, …) kept winning the tiebreak and getting
  // stamped on every forward. We now refuse to guess: if there's no
  // operator-typed phone binding AND no harvested contact share,
  // return null so the caller can fall back to the webhook's own
  // sourceLabel.
  return null;
}

export type SmsWebhook = {
  id: number;
  name: string;
  secret: string;
  enabled: boolean;
  kind: "sms" | "insta";
  redactPrivate: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
};

function rowToSmsWebhook(r: Record<string, unknown>): SmsWebhook {
  const rawKind = (r.kind as string) ?? "sms";
  return {
    id: Number(r.id),
    name: r.name as string,
    secret: r.secret as string,
    enabled: Boolean(r.enabled),
    kind: rawKind === "insta" ? "insta" : "sms",
    redactPrivate: Boolean(r.redact_private ?? false),
    lastUsedAt: (r.last_used_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function listSmsWebhooks(args?: {
  kind?: "sms" | "insta";
}): Promise<SmsWebhook[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const kindFilter = args?.kind ?? null;
  const rows = await sql()`
    SELECT id, name, secret, enabled, kind, redact_private,
           last_used_at, created_at
    FROM sms_webhooks
    WHERE (${kindFilter}::text IS NULL OR kind = ${kindFilter}::text)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSmsWebhook);
}

export async function createSmsWebhook(args: {
  name: string;
  secret: string;
  kind?: "sms" | "insta";
}): Promise<SmsWebhook> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const kind = args.kind ?? "sms";
  const rows = await sql()`
    INSERT INTO sms_webhooks (name, secret, kind)
    VALUES (${args.name}, ${args.secret}, ${kind})
    RETURNING id, name, secret, enabled, kind, redact_private,
              last_used_at, created_at`;
  return rowToSmsWebhook(rows[0] as Record<string, unknown>);
}

export async function updateSmsWebhook(
  id: number,
  patch: Partial<{ name: string; enabled: boolean; redactPrivate: boolean }>,
): Promise<SmsWebhook | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE sms_webhooks SET
      name = COALESCE(${patch.name ?? null}, name),
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      redact_private = COALESCE(${patch.redactPrivate ?? null}::boolean, redact_private)
    WHERE id = ${id}
    RETURNING id, name, secret, enabled, kind, redact_private,
              last_used_at, created_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSmsWebhook(r) : null;
}

export async function deleteSmsWebhook(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM sms_webhooks WHERE id = ${id}`;
}

export async function findSmsWebhookBySecret(
  secret: string,
  kind?: "sms" | "insta",
): Promise<SmsWebhook | null> {
  if (!hasDb() || !secret) return null;
  await ensureSchema();
  const kindFilter = kind ?? null;
  const rows = await sql()`
    SELECT id, name, secret, enabled, kind, redact_private,
           last_used_at, created_at
    FROM sms_webhooks
    WHERE secret = ${secret} AND enabled = TRUE
      AND (${kindFilter}::text IS NULL OR kind = ${kindFilter}::text)
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSmsWebhook(r) : null;
}

// Clean up duplicate SMS rows already stored in messages_log. For each
// (chat_id, message_text) group of source LIKE 'sms_webhook:%' rows
// that landed within `windowSeconds` of each other, keep the earliest
// and delete the rest along with their owner_reactions.
export async function dedupeSmsMessages(opts: {
  chatId: number;
  windowSeconds: number;
}): Promise<{ removed: number; reactions: number }> {
  if (!hasDb()) return { removed: 0, reactions: 0 };
  await ensureSchema();
  const dup = await sql()`
    WITH ranked AS (
      SELECT id, message_text, created_at,
             LAG(id)         OVER w AS prev_id,
             LAG(created_at) OVER w AS prev_at
      FROM messages_log
      WHERE chat_id = ${opts.chatId}
        AND source LIKE 'sms_webhook:%'
      WINDOW w AS (PARTITION BY message_text ORDER BY created_at, id)
    )
    SELECT id FROM ranked
    WHERE prev_id IS NOT NULL
      AND created_at - prev_at < (${opts.windowSeconds} || ' seconds')::interval
  `;
  const ids = dup.map((r) => Number((r as { id: string | number }).id));
  if (ids.length === 0) return { removed: 0, reactions: 0 };
  // Best-effort: drop owner_reactions tied to these rows first.
  let reactions = 0;
  try {
    const reactionRows = await sql()`
      DELETE FROM owner_reactions
      WHERE message_log_id = ANY(${ids}::bigint[])
      RETURNING id`;
    reactions = reactionRows.length;
  } catch {}
  const removedRows = await sql()`
    DELETE FROM messages_log WHERE id = ANY(${ids}::bigint[]) RETURNING id`;
  return { removed: removedRows.length, reactions };
}

// SMS-webhook dedupe lookup. The Android forwarder retries on slow /
// failed responses and some carriers re-deliver, so a single user-
// visible SMS can hit the webhook multiple times. We short-circuit if
// an identical body from the same source landed in the last few
// seconds.
export async function recentSmsLogId(opts: {
  chatId: number;
  text: string;
  sourceLike: string;
  withinSeconds: number;
}): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT id FROM messages_log
    WHERE chat_id = ${opts.chatId}
      AND message_text = ${opts.text}
      AND source = ${opts.sourceLike}
      AND created_at > NOW() - (${opts.withinSeconds} || ' seconds')::interval
    ORDER BY id DESC
    LIMIT 1`;
  const r = rows[0] as { id: string | number } | undefined;
  return r ? Number(r.id) : 0;
}

// Mark a logged SMS as a private conversation so the dashboard +
// notes_inbox card show "🔒 پیام خصوصی" until the operator reveals.
export async function markMessagePrivate(logId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE messages_log
       SET is_private_conversation = TRUE
     WHERE id = ${logId}`;
}

export async function revealPrivateMessage(logId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE messages_log
       SET private_revealed_at = NOW()
     WHERE id = ${logId}`;
}

export async function getPrivateMessage(
  logId: number,
): Promise<{
  id: number;
  body: string;
  senderName: string;
  isPrivate: boolean;
  revealedAt: Date | null;
} | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, message_text, sender_name, is_private_conversation, private_revealed_at
    FROM messages_log WHERE id = ${logId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    body: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "",
    isPrivate: Boolean(r.is_private_conversation),
    revealedAt: (r.private_revealed_at as Date) ?? null,
  };
}

export async function touchSmsWebhook(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE sms_webhooks SET last_used_at = NOW() WHERE id = ${id}`;
}

// --- Owner-uploaded binary assets ---

export type OwnerAsset = { mime: string; data: Uint8Array; updatedAt: Date };

export async function setOwnerAsset(args: {
  kind: string;
  mime: string;
  data: Uint8Array;
  tenantId?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const tenantId = args.tenantId ?? null;
  // Delete-then-insert because the unique index uses COALESCE on
  // tenant_id and ON CONFLICT can't target an expression index in
  // every Postgres version. Race is harmless — worst case the latest
  // upload wins.
  await sql()`
    DELETE FROM owner_assets
    WHERE kind = ${args.kind}
      AND COALESCE(tenant_id, 0) = COALESCE(${tenantId}, 0)`;
  await sql()`
    INSERT INTO owner_assets (kind, tenant_id, mime, data, updated_at)
    VALUES (${args.kind}, ${tenantId}, ${args.mime}, ${args.data}, NOW())`;
}

export async function getOwnerAsset(
  kind: string,
  tenantId?: number | null,
): Promise<OwnerAsset | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT mime, data, updated_at
    FROM owner_assets
    WHERE kind = ${kind}
      AND COALESCE(tenant_id, 0) = COALESCE(${tenantId ?? null}, 0)
    LIMIT 1`;
  const r = rows[0] as
    | { mime: string; data: Uint8Array; updated_at: Date }
    | undefined;
  if (!r) return null;
  // neon driver returns BYTEA as a Buffer; normalise to Uint8Array.
  const data =
    r.data instanceof Uint8Array
      ? r.data
      : new Uint8Array(r.data as ArrayBufferLike);
  return { mime: r.mime, data, updatedAt: r.updated_at };
}

export async function deleteOwnerAsset(
  kind: string,
  tenantId?: number | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM owner_assets
    WHERE kind = ${kind}
      AND COALESCE(tenant_id, 0) = COALESCE(${tenantId ?? null}, 0)`;
}

export async function aiUsageOverview(): Promise<{
  totalCostUsd: number;
  totalTokens: number;
  totalCalls: number;
  last24hCostUsd: number;
}> {
  if (!hasDb()) {
    return { totalCostUsd: 0, totalTokens: 0, totalCalls: 0, last24hCostUsd: 0 };
  }
  await ensureSchema();
  const rows = await sql()`
    SELECT
      COALESCE(SUM(cost_usd), 0)::float8 AS total_cost,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COUNT(*)::int AS total_calls,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0)::float8 AS cost_24h
    FROM ai_usage`;
  const r = rows[0] as {
    total_cost: number;
    total_tokens: number;
    total_calls: number;
    cost_24h: number;
  };
  return {
    totalCostUsd: Number(r.total_cost) || 0,
    totalTokens: Number(r.total_tokens) || 0,
    totalCalls: Number(r.total_calls) || 0,
    last24hCostUsd: Number(r.cost_24h) || 0,
  };
}

// --- Channel-mirror album buffering ---
// Store one part of an incoming album while we wait for the rest.
export async function bufferMirrorAlbumPart(args: {
  groupKey: string;
  targetChatId: number;
  threadId: number | null;
  sourceMessageId: number;
  fileId: string;
  kind: string;
  caption: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO mirror_album_buffer
      (group_key, target_chat_id, thread_id, source_message_id, file_id, kind, caption)
    VALUES (${args.groupKey}, ${args.targetChatId}, ${args.threadId},
            ${args.sourceMessageId}, ${args.fileId}, ${args.kind}, ${args.caption})`;
}

// Atomically claim the right to flush this group — only the first
// caller gets true, so concurrent album parts don't each send.
export async function claimMirrorAlbumFlush(groupKey: string): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO mirror_album_claim (group_key)
    VALUES (${groupKey})
    ON CONFLICT (group_key) DO NOTHING
    RETURNING 1`;
  return rows.length > 0;
}

export type MirrorAlbumPart = {
  sourceMessageId: number;
  fileId: string;
  kind: string;
  caption: string | null;
  targetChatId: number;
  threadId: number | null;
};

// Read the buffered parts of a group in original album order.
export async function getMirrorAlbumParts(
  groupKey: string,
): Promise<MirrorAlbumPart[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT source_message_id, file_id, kind, caption, target_chat_id, thread_id
      FROM mirror_album_buffer
     WHERE group_key = ${groupKey}
     ORDER BY source_message_id ASC`;
  return rows.map((r) => ({
    sourceMessageId: Number(r.source_message_id),
    fileId: r.file_id as string,
    kind: r.kind as string,
    caption: (r.caption as string | null) ?? null,
    targetChatId: Number(r.target_chat_id),
    threadId: r.thread_id == null ? null : Number(r.thread_id),
  }));
}

export async function deleteMirrorAlbumBuffer(groupKey: string): Promise<void> {
  if (!hasDb()) return;
  await sql()`DELETE FROM mirror_album_buffer WHERE group_key = ${groupKey}`;
}

// Release a flush claim after a FAILED send so the next cron tick can
// retry the group. Without this the claim blocks retries forever (and
// the 1-day claim prune would then re-send a possibly half-delivered
// album a day later).
export async function deleteMirrorAlbumClaim(groupKey: string): Promise<void> {
  if (!hasDb()) return;
  await sql()`DELETE FROM mirror_album_claim WHERE group_key = ${groupKey}`;
}

// Album groups whose newest buffered part is older than `quietSeconds`
// — i.e. no new part has arrived recently, so the group is complete and
// ready to flush. Excludes already-claimed groups so we don't re-send.
export async function getReadyMirrorAlbumGroups(
  quietSeconds: number,
): Promise<string[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT b.group_key
      FROM mirror_album_buffer b
      LEFT JOIN mirror_album_claim c ON c.group_key = b.group_key
     WHERE c.group_key IS NULL
     GROUP BY b.group_key
    HAVING MAX(b.created_at) < NOW() - (${quietSeconds}::int || ' seconds')::interval`;
  return rows.map((r) => r.group_key as string);
}

// Pause / resume a recipient without deleting it. Paused recipients
// keep their config + history but receive no new forwards.
export async function setRuleRecipientPaused(args: {
  ruleId: number;
  recipientChatId: number;
  paused: boolean;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_recipients
    SET paused = ${args.paused}
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

export async function addRuleRecipient(args: {
  ruleId: number;
  recipientChatId: number;
  recipientLabel?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO message_rule_recipients (rule_id, recipient_chat_id, recipient_label)
    VALUES (${args.ruleId}, ${args.recipientChatId}, ${args.recipientLabel ?? null})
    ON CONFLICT (rule_id, recipient_chat_id) DO UPDATE SET
      recipient_label = COALESCE(EXCLUDED.recipient_label, message_rule_recipients.recipient_label)`;
}

// Rename a recipient (edit its label). Empty label → NULL.
export async function setRuleRecipientLabel(args: {
  ruleId: number;
  recipientChatId: number;
  recipientLabel: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_recipients
    SET recipient_label = ${args.recipientLabel}
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

export async function removeRuleRecipient(args: {
  ruleId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM message_rule_recipients
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

export async function recordRuleMatch(args: {
  ruleId: number;
  messageLogId: number;
  formattedText?: string | null;
  forwardedTo: number[];
  forwardErrors?: Record<string, string>;
}): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const errs = args.forwardErrors ?? {};
  const errsJson = Object.keys(errs).length > 0 ? JSON.stringify(errs) : null;
  const rows = await sql()`
    INSERT INTO message_rule_matches (rule_id, message_log_id, formatted_text, forwarded_to, forward_errors)
    VALUES (
      ${args.ruleId},
      ${args.messageLogId},
      ${args.formattedText ?? null},
      ${args.forwardedTo}::bigint[],
      ${errsJson}::jsonb
    )
    RETURNING id`;
  return Number((rows[0] as { id: string }).id);
}

export async function appendForwardErrors(args: {
  matchId: number;
  errors: Record<string, string>;
}): Promise<void> {
  if (!hasDb()) return;
  if (Object.keys(args.errors).length === 0) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_matches
    SET forward_errors = COALESCE(forward_errors, '{}'::jsonb) || ${JSON.stringify(args.errors)}::jsonb
    WHERE id = ${args.matchId}`;
}

export async function listRuleMatches(args: {
  ruleId: number;
  limit?: number;
  offset?: number;
}): Promise<
  Array<
    RuleMatch & {
      messageText: string;
      senderName: string;
      chatId: number;
      forwardErrors: Record<string, string> | null;
    }
  >
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  const offset = Math.max(args.offset ?? 0, 0);
  const rows = await sql()`
    SELECT m.id, m.rule_id, m.message_log_id, m.formatted_text, m.forwarded_to,
           m.forward_errors, m.matched_at,
           l.message_text, l.sender_name, l.chat_id
    FROM message_rule_matches m
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    WHERE m.rule_id = ${args.ruleId}
    ORDER BY m.matched_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    messageLogId: Number(r.message_log_id),
    formattedText: (r.formatted_text as string) ?? null,
    forwardedTo: ((r.forwarded_to as unknown[]) ?? []).map((n) => Number(n)),
    matchedAt: r.matched_at as Date,
    messageText: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "?",
    chatId: r.chat_id != null ? Number(r.chat_id) : 0,
    forwardErrors:
      (r.forward_errors as Record<string, string> | null) ?? null,
  }));
}

// rule_match  = positive: messages that SHOULD match (forward).
// negative_match = counter-examples: messages that must NOT match.
// gate_match   = phrasings that OPEN the request gate ("send me the code").
export type RuleExamplePurpose = "rule_match" | "gate_match" | "negative_match";

export type RuleExample = {
  id: number;
  ruleId: number;
  text: string;
  label: string | null;
  purpose: RuleExamplePurpose;
  createdAt: Date;
};

export async function listRuleExamples(
  ruleId: number,
  purpose: RuleExamplePurpose | "all" = "rule_match",
): Promise<RuleExample[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const purposeFilter = purpose === "all" ? null : purpose;
  const rows = await sql()`
    SELECT id, rule_id, text, label, purpose, created_at
    FROM message_rule_examples
    WHERE rule_id = ${ruleId}
      AND (${purposeFilter}::text IS NULL OR purpose = ${purposeFilter})
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    text: r.text as string,
    label: (r.label as string) ?? null,
    purpose: ((r.purpose as string) ?? "rule_match") as RuleExamplePurpose,
    createdAt: r.created_at as Date,
  }));
}

export async function addRuleExample(args: {
  ruleId: number;
  text: string;
  label?: string | null;
  purpose?: RuleExamplePurpose;
}): Promise<RuleExample> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const purpose = args.purpose ?? "rule_match";
  const rows = await sql()`
    INSERT INTO message_rule_examples (rule_id, text, label, purpose)
    VALUES (${args.ruleId}, ${args.text}, ${args.label ?? null}, ${purpose})
    RETURNING id, rule_id, text, label, purpose, created_at`;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    text: r.text as string,
    label: (r.label as string) ?? null,
    purpose: ((r.purpose as string) ?? "rule_match") as RuleExamplePurpose,
    createdAt: r.created_at as Date,
  };
}

export async function deleteRuleExample(exampleId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM message_rule_examples WHERE id = ${exampleId}`;
}

// Cross-rule recent forwarded-match feed for /rules.
export async function listRecentRuleMatches(args: {
  limit: number;
  offset?: number;
}): Promise<
  Array<{
    id: number;
    ruleId: number;
    ruleName: string;
    messageLogId: number;
    formattedText: string | null;
    forwardedTo: number[];
    matchedAt: Date;
    messageText: string;
    senderName: string;
    chatId: number;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const n = Math.min(Math.max(args.limit, 1), 200);
  const offset = Math.max(args.offset ?? 0, 0);
  const rows = await sql()`
    SELECT m.id, m.rule_id, r.name AS rule_name,
           m.message_log_id, m.formatted_text, m.forwarded_to, m.matched_at,
           l.message_text, l.sender_name, l.chat_id
    FROM message_rule_matches m
    LEFT JOIN message_rules r ON r.id = m.rule_id
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    ORDER BY m.matched_at DESC
    LIMIT ${n} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ruleId: Number(r.rule_id),
    ruleName: (r.rule_name as string) ?? "?",
    messageLogId: Number(r.message_log_id),
    formattedText: (r.formatted_text as string) ?? null,
    forwardedTo: ((r.forwarded_to as unknown[]) ?? []).map((n) => Number(n)),
    matchedAt: r.matched_at as Date,
    messageText: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "?",
    chatId: r.chat_id != null ? Number(r.chat_id) : 0,
  }));
}

// Rules where the given chat_id is a recipient. Used by /chats/[id]
// to show "this chat receives the following rules" and by the request-
// trigger lookback path in bot.ts.
export async function listRulesForRecipient(
  recipientChatId: number,
): Promise<MessageRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT r.id, r.tenant_id, r.name, r.description, r.forward_format, r.forward_header,
           r.request_trigger, r.request_window_seconds,
           r.show_rule_prefix, r.format_as_otp, r.enabled,
           r.created_by, r.created_at, r.updated_at
    FROM message_rules r
    JOIN message_rule_recipients rr ON rr.rule_id = r.id
    WHERE rr.recipient_chat_id = ${recipientChatId}
    ORDER BY r.name ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToRule);
}

// Find rule-matches for a given recipient that haven't been forwarded
// to them yet AND fell within the request_window_seconds of now. Used
// when the recipient sends a "send me the code" trigger and we want to
// release the pending matches.
export async function findPendingMatchesForRecipient(args: {
  ruleId: number;
  recipientChatId: number;
  withinSeconds: number;
}): Promise<
  Array<{
    matchId: number;
    messageLogId: number;
    formattedText: string | null;
    messageText: string;
    senderName: string;
    chatId: number;
    matchedAt: Date;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT m.id AS match_id, m.message_log_id, m.formatted_text,
           m.matched_at, l.message_text, l.sender_name, l.chat_id
    FROM message_rule_matches m
    LEFT JOIN messages_log l ON l.id = m.message_log_id
    WHERE m.rule_id = ${args.ruleId}
      AND m.matched_at > NOW() - (${args.withinSeconds}::int || ' seconds')::interval
      AND NOT (${args.recipientChatId}::bigint = ANY(COALESCE(m.forwarded_to, ARRAY[]::bigint[])))
    ORDER BY m.matched_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    matchId: Number(r.match_id),
    messageLogId: Number(r.message_log_id),
    formattedText: (r.formatted_text as string) ?? null,
    messageText: (r.message_text as string) ?? "",
    senderName: (r.sender_name as string) ?? "?",
    chatId: r.chat_id != null ? Number(r.chat_id) : 0,
    matchedAt: r.matched_at as Date,
  }));
}

// Mark "the recipient just asked for the code" so later matches
// arriving inside the window can skip the gate.
export async function markRecipientRequestedNow(args: {
  ruleId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_recipients
    SET last_request_at = NOW()
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

// True when the recipient sent a trigger within the last
// windowSeconds. Used by the FORWARD path to decide whether to skip
// the gate for this recipient on a freshly-arrived match.
export async function recipientRequestedRecently(args: {
  ruleId: number;
  recipientChatId: number;
  windowSeconds: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM message_rule_recipients
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}
      AND last_request_at IS NOT NULL
      AND last_request_at > NOW() - (${args.windowSeconds}::int || ' seconds')::interval
    LIMIT 1`;
  return rows.length > 0;
}

// Consume the recipient's request stamp after a code has actually
// been delivered to them. One request = one delivery: without this a
// single "کد بده" opens the gate for the whole window and EVERY code
// arriving in that window (from any chat) leaks to the recipient.
export async function clearRecipientRequest(args: {
  ruleId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_recipients
    SET last_request_at = NULL
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

// ATOMIC check-and-consume of the request stamp. Returns true iff the
// recipient had a still-valid request stamp, which is cleared in the
// SAME statement. This closes the read→send→clear race: two codes
// arriving concurrently for one "کد بده" can no longer BOTH see the
// stamp and both forward — exactly one UPDATE wins the RETURNING row.
export async function consumeRecipientRequest(args: {
  ruleId: number;
  recipientChatId: number;
  windowSeconds: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    UPDATE message_rule_recipients
    SET last_request_at = NULL
    WHERE rule_id = ${args.ruleId}
      AND recipient_chat_id = ${args.recipientChatId}
      AND last_request_at IS NOT NULL
      AND last_request_at > NOW() - (${args.windowSeconds}::int || ' seconds')::interval
    RETURNING 1`;
  return rows.length > 0;
}

// Append a recipient chat_id to a match's forwarded_to array — used
// both on first forward and when releasing a held match later.
export async function markMatchForwardedTo(args: {
  matchId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE message_rule_matches
    SET forwarded_to = ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(forwarded_to, ARRAY[]::bigint[]) || ARRAY[${args.recipientChatId}::bigint]
      )
    )
    WHERE id = ${args.matchId}`;
}

// Fetch recent messages for the "test this rule on history" action.
export async function listRecentMessagesForTest(
  limit: number,
): Promise<
  Array<{
    id: number;
    chatId: number;
    chatTitle: string | null;
    senderName: string;
    messageText: string;
    createdAt: Date;
  }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const n = Math.min(Math.max(limit, 1), 200);
  const rows = await sql()`
    SELECT id, chat_id, chat_title, sender_name, message_text, created_at
    FROM messages_log
    WHERE from_owner = FALSE
      AND COALESCE(message_text, '') <> ''
    ORDER BY created_at DESC
    LIMIT ${n}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    chatId: Number(r.chat_id),
    chatTitle: (r.chat_title as string) ?? null,
    senderName: (r.sender_name as string) ?? "?",
    messageText: (r.message_text as string) ?? "",
    createdAt: r.created_at as Date,
  }));
}


// ── Site monitors ───────────────────────────────────────────────
export type SiteMonitor = {
  id: number;
  name: string;
  loginUrl: string;
  checkUrl: string;
  username: string | null;
  password: string | null;
  usernameField: string;
  passwordField: string;
  extraFieldsJson: string | null;
  checkHoursTehran: string;
  skipWeekdays: string;
  enabled: boolean;
  notifyOn: string;
  scrapeMode: string;
  lastRunAt: Date | null;
  lastRunSlot: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastContentHash: string | null;
  lastContent: string | null;
  lastSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToSiteMonitor(r: Record<string, unknown>): SiteMonitor {
  return {
    id: Number(r.id),
    name: (r.name as string) ?? "",
    loginUrl: (r.login_url as string) ?? "",
    checkUrl: (r.check_url as string) ?? "",
    username: (r.username as string) ?? null,
    password: (r.password as string) ?? null,
    usernameField: (r.username_field as string) ?? "username",
    passwordField: (r.password_field as string) ?? "password",
    extraFieldsJson: (r.extra_fields_json as string) ?? null,
    checkHoursTehran: (r.check_hours_tehran as string) ?? "13,15",
    skipWeekdays: (r.skip_weekdays as string) ?? "4,5",
    enabled: Boolean(r.enabled),
    notifyOn: (r.notify_on as string) ?? "change",
    scrapeMode: (r.scrape_mode as string) ?? "http",
    lastRunAt: (r.last_run_at as Date) ?? null,
    lastRunSlot: (r.last_run_slot as string) ?? null,
    lastStatus: (r.last_status as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    lastContentHash: (r.last_content_hash as string) ?? null,
    lastContent: (r.last_content as string) ?? null,
    lastSummary: (r.last_summary as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listSiteMonitors(): Promise<SiteMonitor[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`SELECT * FROM site_monitors ORDER BY id ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSiteMonitor);
}

export async function getSiteMonitor(id: number): Promise<SiteMonitor | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`SELECT * FROM site_monitors WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSiteMonitor(r) : null;
}

export async function getSiteMonitorByName(
  name: string,
): Promise<SiteMonitor | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM site_monitors WHERE LOWER(name) = LOWER(${name}) LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSiteMonitor(r) : null;
}

export async function createSiteMonitor(m: {
  name: string;
  loginUrl: string;
  checkUrl: string;
  username: string | null;
  password: string | null;
  usernameField?: string;
  passwordField?: string;
  extraFieldsJson?: string | null;
  checkHoursTehran?: string;
  skipWeekdays?: string;
  notifyOn?: string;
  scrapeMode?: string;
}): Promise<number> {
  if (!hasDb()) throw new Error("no db");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO site_monitors
      (name, login_url, check_url, username, password, username_field,
       password_field, extra_fields_json, check_hours_tehran, skip_weekdays,
       notify_on, scrape_mode)
    VALUES
      (${m.name}, ${m.loginUrl}, ${m.checkUrl}, ${m.username}, ${m.password},
       ${m.usernameField ?? "username"}, ${m.passwordField ?? "password"},
       ${m.extraFieldsJson ?? null}, ${m.checkHoursTehran ?? "13,15"},
       ${m.skipWeekdays ?? "4,5"}, ${m.notifyOn ?? "change"},
       ${m.scrapeMode ?? "http"})
    RETURNING id`;
  return Number((rows[0] as { id: string | number }).id);
}

export async function updateSiteMonitor(
  id: number,
  patch: Partial<{
    name: string;
    loginUrl: string;
    checkUrl: string;
    username: string | null;
    password: string | null;
    usernameField: string;
    passwordField: string;
    extraFieldsJson: string | null;
    checkHoursTehran: string;
    skipWeekdays: string;
    enabled: boolean;
    notifyOn: string;
    scrapeMode: string;
  }>,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const cur = await getSiteMonitor(id);
  if (!cur) return;
  const v = {
    name: patch.name ?? cur.name,
    loginUrl: patch.loginUrl ?? cur.loginUrl,
    checkUrl: patch.checkUrl ?? cur.checkUrl,
    username: patch.username === undefined ? cur.username : patch.username,
    password:
      patch.password === undefined || patch.password === ""
        ? cur.password
        : patch.password,
    usernameField: patch.usernameField ?? cur.usernameField,
    passwordField: patch.passwordField ?? cur.passwordField,
    extraFieldsJson:
      patch.extraFieldsJson === undefined
        ? cur.extraFieldsJson
        : patch.extraFieldsJson,
    checkHoursTehran: patch.checkHoursTehran ?? cur.checkHoursTehran,
    skipWeekdays: patch.skipWeekdays ?? cur.skipWeekdays,
    enabled: patch.enabled === undefined ? cur.enabled : patch.enabled,
    notifyOn: patch.notifyOn ?? cur.notifyOn,
    scrapeMode: patch.scrapeMode ?? cur.scrapeMode,
  };
  await sql()`
    UPDATE site_monitors SET
      name = ${v.name}, login_url = ${v.loginUrl}, check_url = ${v.checkUrl},
      username = ${v.username}, password = ${v.password},
      username_field = ${v.usernameField}, password_field = ${v.passwordField},
      extra_fields_json = ${v.extraFieldsJson},
      check_hours_tehran = ${v.checkHoursTehran}, skip_weekdays = ${v.skipWeekdays},
      enabled = ${v.enabled}, notify_on = ${v.notifyOn},
      scrape_mode = ${v.scrapeMode}, updated_at = NOW()
    WHERE id = ${id}`;
}

export async function deleteSiteMonitor(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM site_monitors WHERE id = ${id}`;
}

export async function recordSiteMonitorRun(
  id: number,
  r: {
    slot: string;
    status: string;
    error: string | null;
    contentHash: string | null;
    content: string | null;
    summary: string | null;
  },
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE site_monitors SET
      last_run_at = NOW(), last_run_slot = ${r.slot}, last_status = ${r.status},
      last_error = ${r.error}, last_content_hash = ${r.contentHash},
      last_content = ${r.content}, last_summary = ${r.summary}, updated_at = NOW()
    WHERE id = ${id}`;
}

// ── Emails (Resend) ─────────────────────────────────────────────
export type EmailRow = {
  id: number;
  accountId: number | null;
  direction: "in" | "out";
  resendId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  threadKey: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  summary: string | null;
  attachments: EmailAttachment[] | null;
  tgChatId: number | null;
  tgMessageId: number | null;
  status: string | null;
  error: string | null;
  publicToken: string | null;
  createdAt: Date;
};

export type EmailAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  contentDisposition: string | null;
  contentId: string | null;
};

function parseAttachments(v: unknown): EmailAttachment[] | null {
  let arr: unknown = v;
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((x) => ({
      id: String(x.id ?? ""),
      filename: (x.filename as string) ?? null,
      contentType: (x.contentType ?? x.content_type ?? null) as string | null,
      size: x.size != null ? Number(x.size) : null,
      contentDisposition: (x.contentDisposition ?? x.content_disposition ?? null) as string | null,
      contentId: (x.contentId ?? x.content_id ?? null) as string | null,
    }))
    .filter((x) => x.id);
}

function rowToEmail(r: Record<string, unknown>): EmailRow {
  return {
    id: Number(r.id),
    accountId: r.account_id != null ? Number(r.account_id) : null,
    direction: (r.direction as "in" | "out") ?? "in",
    resendId: (r.resend_id as string) ?? null,
    messageId: (r.message_id as string) ?? null,
    inReplyTo: (r.in_reply_to as string) ?? null,
    threadKey: (r.thread_key as string) ?? null,
    fromEmail: (r.from_email as string) ?? null,
    fromName: (r.from_name as string) ?? null,
    toEmails: (r.to_emails as string) ?? null,
    ccEmails: (r.cc_emails as string) ?? null,
    subject: (r.subject as string) ?? null,
    textBody: (r.text_body as string) ?? null,
    htmlBody: (r.html_body as string) ?? null,
    summary: (r.summary as string) ?? null,
    attachments: parseAttachments(r.attachments),
    tgChatId: r.tg_chat_id != null ? Number(r.tg_chat_id) : null,
    tgMessageId: r.tg_message_id != null ? Number(r.tg_message_id) : null,
    status: (r.status as string) ?? null,
    error: (r.error as string) ?? null,
    publicToken: (r.public_token as string) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function insertEmail(e: {
  direction: "in" | "out";
  accountId?: number | null;
  resendId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  threadKey?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  toEmails?: string | null;
  ccEmails?: string | null;
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  attachments?: EmailAttachment[] | null;
  status?: string | null;
  error?: string | null;
}): Promise<number> {
  if (!hasDb()) throw new Error("no db");
  await ensureSchema();
  const attachments =
    e.attachments && e.attachments.length ? JSON.stringify(e.attachments) : null;
  const rows = await sql()`
    INSERT INTO emails
      (direction, account_id, resend_id, message_id, in_reply_to, thread_key,
       from_email, from_name, to_emails, cc_emails, subject,
       text_body, html_body, attachments, status, error, public_token)
    VALUES
      (${e.direction}, ${e.accountId ?? null}, ${e.resendId ?? null},
       ${e.messageId ?? null}, ${e.inReplyTo ?? null}, ${e.threadKey ?? null},
       ${e.fromEmail ?? null}, ${e.fromName ?? null}, ${e.toEmails ?? null},
       ${e.ccEmails ?? null}, ${e.subject ?? null}, ${e.textBody ?? null},
       ${e.htmlBody ?? null}, ${attachments}::jsonb, ${e.status ?? null}, ${e.error ?? null},
       ${randomBytes(12).toString("hex")})
    RETURNING id`;
  return Number((rows[0] as { id: string | number }).id);
}

// Has this exact Resend event already been turned into a row? Resend
// retries a webhook it didn't get a 2xx for, and the dashboard's
// "send test event" reuses one fixed id — both produced duplicate
// cards in the channel before this check existed.
export async function findEmailByResendId(
  resendId: string,
  direction: "in" | "out",
): Promise<number | null> {
  if (!hasDb() || !resendId) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id FROM emails
    WHERE resend_id = ${resendId} AND direction = ${direction}
    LIMIT 1`;
  const r = rows[0] as { id: string | number } | undefined;
  return r ? Number(r.id) : null;
}

export async function getEmail(id: number): Promise<EmailRow | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`SELECT * FROM emails WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToEmail(r) : null;
}

export async function listEmails(opts?: {
  direction?: "in" | "out";
  limit?: number;
  offset?: number;
}): Promise<EmailRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const dir = opts?.direction ?? null;
  const rows = await sql()`
    SELECT * FROM emails
    WHERE (${dir}::text IS NULL OR direction = ${dir})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return (rows as Array<Record<string, unknown>>).map(rowToEmail);
}

export async function setEmailTelegramRef(
  id: number,
  tgChatId: number,
  tgMessageId: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE emails SET tg_chat_id = ${tgChatId}, tg_message_id = ${tgMessageId}
    WHERE id = ${id}`;
}

export async function setEmailSummary(id: number, summary: string): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`UPDATE emails SET summary = ${summary} WHERE id = ${id}`;
}

// ── Email accounts (multi) ──────────────────────────────────────
export type EmailAccount = {
  id: number;
  name: string;
  resendApiKey: string | null;
  fromEmail: string | null;
  inboundToken: string | null;
  tgChannelId: number | null;
  publicUrl: string | null;
  inboundDomains: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function rowToEmailAccount(r: Record<string, unknown>): EmailAccount {
  return {
    id: Number(r.id),
    name: (r.name as string) ?? "",
    resendApiKey: (r.resend_api_key as string) ?? null,
    fromEmail: (r.from_email as string) ?? null,
    inboundToken: (r.inbound_token as string) ?? null,
    tgChannelId: r.tg_channel_id != null ? Number(r.tg_channel_id) : null,
    publicUrl: (r.public_url as string) ?? null,
    inboundDomains: (r.inbound_domains as string) ?? null,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listEmailAccounts(): Promise<EmailAccount[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`SELECT * FROM email_accounts ORDER BY id ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToEmailAccount);
}

export async function getEmailAccount(id: number): Promise<EmailAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`SELECT * FROM email_accounts WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToEmailAccount(r) : null;
}

export async function getEmailAccountByToken(
  token: string,
): Promise<EmailAccount | null> {
  if (!hasDb() || !token) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM email_accounts WHERE inbound_token = ${token} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToEmailAccount(r) : null;
}

export async function getEmailAccountByChannel(
  chatId: number,
): Promise<EmailAccount | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT * FROM email_accounts WHERE tg_channel_id = ${chatId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToEmailAccount(r) : null;
}

// Resolve the account that owns an inbound email by its recipient
// domain. Matches (in order of specificity) the account's
// inbound_domains list, its from_email domain, or its name treated as
// a domain (e.g. account "RatekLend.ir" ← admin@rateklend.ir).
export async function getEmailAccountByRecipientDomain(
  toEmails: string | null,
): Promise<EmailAccount | null> {
  if (!hasDb() || !toEmails) return null;
  const domains = Array.from(
    new Set(
      (toEmails.toLowerCase().match(/@([a-z0-9.-]+)/g) ?? []).map((d) =>
        d.slice(1),
      ),
    ),
  );
  if (domains.length === 0) return null;
  await ensureSchema();
  const accounts = await listEmailAccounts();
  for (const domain of domains) {
    const hit = accounts.find((a) => {
      if (!a.enabled) return false;
      const inbound = (a.inboundDomains ?? "")
        .toLowerCase()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (inbound.includes(domain)) return true;
      const fromDomain = (a.fromEmail ?? "").toLowerCase().split("@")[1]?.trim();
      if (fromDomain && fromDomain === domain) return true;
      if ((a.name ?? "").toLowerCase().trim() === domain) return true;
      return false;
    });
    if (hit) return hit;
  }
  return null;
}

export async function createEmailAccount(a: {
  name: string;
  resendApiKey?: string | null;
  fromEmail?: string | null;
  inboundToken?: string | null;
  tgChannelId?: number | null;
  publicUrl?: string | null;
  inboundDomains?: string | null;
}): Promise<number> {
  if (!hasDb()) throw new Error("no db");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO email_accounts (name, resend_api_key, from_email, inbound_token, tg_channel_id, public_url, inbound_domains)
    VALUES (${a.name}, ${a.resendApiKey ?? null}, ${a.fromEmail ?? null},
            ${a.inboundToken ?? null}, ${a.tgChannelId ?? null}, ${a.publicUrl ?? null},
            ${a.inboundDomains ?? null})
    RETURNING id`;
  return Number((rows[0] as { id: string | number }).id);
}

export async function updateEmailAccount(
  id: number,
  patch: Partial<{
    name: string;
    resendApiKey: string | null;
    fromEmail: string | null;
    inboundToken: string | null;
    tgChannelId: number | null;
    publicUrl: string | null;
    inboundDomains: string | null;
    enabled: boolean;
  }>,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const cur = await getEmailAccount(id);
  if (!cur) return;
  const v = {
    name: patch.name ?? cur.name,
    resendApiKey:
      patch.resendApiKey === undefined || patch.resendApiKey === ""
        ? cur.resendApiKey
        : patch.resendApiKey,
    fromEmail: patch.fromEmail === undefined ? cur.fromEmail : patch.fromEmail,
    inboundToken:
      patch.inboundToken === undefined ? cur.inboundToken : patch.inboundToken,
    tgChannelId:
      patch.tgChannelId === undefined ? cur.tgChannelId : patch.tgChannelId,
    publicUrl: patch.publicUrl === undefined ? cur.publicUrl : patch.publicUrl,
    inboundDomains:
      patch.inboundDomains === undefined ? cur.inboundDomains : patch.inboundDomains,
    enabled: patch.enabled === undefined ? cur.enabled : patch.enabled,
  };
  await sql()`
    UPDATE email_accounts SET
      name = ${v.name}, resend_api_key = ${v.resendApiKey},
      from_email = ${v.fromEmail}, inbound_token = ${v.inboundToken},
      tg_channel_id = ${v.tgChannelId}, public_url = ${v.publicUrl},
      inbound_domains = ${v.inboundDomains}, enabled = ${v.enabled}, updated_at = NOW()
    WHERE id = ${id}`;
}

export async function deleteEmailAccount(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM email_accounts WHERE id = ${id}`;
}

// ── Email pending replies (Telegram force-reply flow) ───────────
export async function createEmailPendingReply(
  promptChatId: number,
  promptMessageId: number,
  emailId: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO email_pending_replies (prompt_chat_id, prompt_message_id, email_id)
    VALUES (${promptChatId}, ${promptMessageId}, ${emailId})
    ON CONFLICT (prompt_chat_id, prompt_message_id) DO UPDATE SET email_id = ${emailId}`;
}

export async function getEmailPendingReply(
  promptChatId: number,
  promptMessageId: number,
): Promise<number | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT email_id FROM email_pending_replies
    WHERE prompt_chat_id = ${promptChatId} AND prompt_message_id = ${promptMessageId}
    LIMIT 1`;
  const r = rows[0] as { email_id: string | number } | undefined;
  return r ? Number(r.email_id) : null;
}

export async function deleteEmailPendingReply(
  promptChatId: number,
  promptMessageId: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM email_pending_replies
    WHERE prompt_chat_id = ${promptChatId} AND prompt_message_id = ${promptMessageId}`;
}

// --- Media-link download relay ---
export type LinkDownloader = {
  id: number;
  label: string;
  kind: string;
  botId: number;
  hosts: string[];
  enabled: boolean;
};

// Cached briefly: this runs on every private message.
let dlCache: { rows: LinkDownloader[]; at: number } | null = null;

export function invalidateLinkDownloaders(): void {
  dlCache = null;
}

export async function listLinkDownloaders(
  all = false,
): Promise<LinkDownloader[]> {
  if (!hasDb()) return [];
  if (!all && dlCache && Date.now() - dlCache.at < 30_000) return dlCache.rows;
  await ensureSchema();
  const rows = await sql()`SELECT * FROM link_downloaders ORDER BY id`;
  const out = rows.map((r) => ({
    id: Number(r.id),
    label: String(r.label ?? ""),
    kind: String(r.kind ?? ""),
    botId: Number(r.bot_id),
    hosts: String(r.hosts ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase().replace(/^\.+/, ""))
      .filter(Boolean),
    enabled: Boolean(r.enabled),
  }));
  if (!all) {
    const on = out.filter((d) => d.enabled);
    dlCache = { rows: on, at: Date.now() };
    return on;
  }
  return out;
}

export async function upsertLinkDownloader(a: {
  id?: number;
  label: string;
  kind: string;
  botId: number;
  hosts: string[];
  enabled: boolean;
}): Promise<void> {
  await ensureSchema();
  const hosts = a.hosts.join(",");
  if (a.id) {
    await sql()`UPDATE link_downloaders SET label=${a.label}, kind=${a.kind},
      bot_id=${a.botId}, hosts=${hosts}, enabled=${a.enabled} WHERE id=${a.id}`;
  } else {
    await sql()`INSERT INTO link_downloaders (label, kind, bot_id, hosts, enabled)
      VALUES (${a.label}, ${a.kind}, ${a.botId}, ${hosts}, ${a.enabled})`;
  }
  invalidateLinkDownloaders();
}

export async function deleteLinkDownloader(id: number): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM link_downloaders WHERE id = ${id}`;
  invalidateLinkDownloaders();
}

// Host must equal the pattern or be a subdomain of it. Substring
// matching would let "open.spotify.com.attacker.net" through.
// Exported for tests: the anchored match is the whole point of this
// function (it must not treat "notinstagram.com" as instagram.com).
export function hostMatches(host: string, pattern: string): boolean {
  return host === pattern || host.endsWith("." + pattern);
}

const URL_RE = /https?:\/\/[^\s<>()"']+/gi;

export async function findDownloadableLink(
  text: string,
): Promise<{ kind: string; botId: number; label: string; url: string } | null> {
  if (!text) return null;
  const downloaders = await listLinkDownloaders();
  if (downloaders.length === 0) return null;
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(/[).,،]+$/, "");
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    for (const d of downloaders) {
      if (d.hosts.some((h) => hostMatches(host, h))) {
        return { kind: d.kind, botId: d.botId, label: d.label, url };
      }
    }
  }
  return null;
}

export type LinkJob = {
  id: number;
  kind: string;
  relayBotId: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  link: string;
};

function rowToLinkJob(r: Record<string, unknown>): LinkJob {
  return {
    id: Number(r.id),
    kind: String(r.kind ?? ""),
    relayBotId: Number(r.relay_bot_id),
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId: r.source_message_id == null ? null : Number(r.source_message_id),
    link: String(r.link ?? ""),
  };
}

export async function createLinkJob(args: {
  kind: string;
  relayBotId: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  link: string;
  relayMessageId: number | null;
}): Promise<number | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO link_download_jobs
      (kind, relay_bot_id, source_chat_id, source_message_id, link, relay_message_id)
    VALUES (${args.kind}, ${args.relayBotId}, ${args.sourceChatId},
            ${args.sourceMessageId}, ${args.link}, ${args.relayMessageId})
    RETURNING id`;
  return Number((rows[0] as { id: number }).id);
}

// The downloader answers inside the owner's DM with it. Prefer an exact
// match on the message it replied to; otherwise take that bot's oldest
// pending job — correct because we relay one link at a time per bot.
export async function findPendingLinkJob(
  relayBotId: number,
  replyToMessageId: number | null,
): Promise<LinkJob | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  if (replyToMessageId != null) {
    const exact = await sql()`
      SELECT * FROM link_download_jobs
       WHERE status = 'pending' AND relay_bot_id = ${relayBotId}
         AND relay_message_id = ${replyToMessageId}
       ORDER BY created_at ASC LIMIT 1`;
    if (exact[0]) return rowToLinkJob(exact[0]);
  }
  const rows = await sql()`
    SELECT * FROM link_download_jobs
     WHERE status = 'pending' AND relay_bot_id = ${relayBotId}
       AND created_at > NOW() - INTERVAL '10 minutes'
     ORDER BY created_at ASC LIMIT 1`;
  return rows[0] ? rowToLinkJob(rows[0]) : null;
}

export async function finishLinkJob(id: number, delivered: number): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE link_download_jobs
       SET status = 'done', delivered = delivered + ${delivered}, completed_at = NOW()
     WHERE id = ${id}`;
}
