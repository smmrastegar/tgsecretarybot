// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { ensureSchema, hasDb, sql } from "./core";

// --- SMS dedup ---

export type SmsDedupRow = {
  id: number;
  inboxChatId: number;
  bodySignature: string;
  bodyPreview: string | null;
  firstSentAt: Date;
  lastSeenAt: Date;
  repeatCount: number;
  telegramMessageId: number | null;
};

// Stable signature for dedup. Strips whitespace + lowercases + drops
// per-message dynamic tokens (long digit runs ≥ 4) so two ad blasts
// that only differ in a tracking code coalesce. Short numbers (years,
// times) survive.
export function smsBodySignature(body: string): string {
  let s = body.toLowerCase().trim();
  s = s.replace(/[\s‌]+/g, " ");
  s = s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  // Replace any digit run of 4+ with #### so dynamic codes don't
  // defeat dedup but short years like 2026 still match.
  s = s.replace(/\d{4,}/g, "####");
  return s.slice(0, 800);
}

export async function findSmsDedup(
  inboxChatId: number,
  signature: string,
  withinHours: number,
): Promise<SmsDedupRow | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, inbox_chat_id, body_signature, body_preview,
           first_sent_at, last_seen_at, repeat_count, telegram_message_id
    FROM sms_dedup
    WHERE inbox_chat_id = ${inboxChatId}
      AND body_signature = ${signature}
      AND last_seen_at > NOW() - make_interval(hours => ${withinHours})
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    inboxChatId: Number(r.inbox_chat_id),
    bodySignature: r.body_signature as string,
    bodyPreview: (r.body_preview as string) ?? null,
    firstSentAt: r.first_sent_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    repeatCount: Number(r.repeat_count),
    telegramMessageId:
      r.telegram_message_id != null ? Number(r.telegram_message_id) : null,
  };
}

export async function upsertSmsDedup(args: {
  inboxChatId: number;
  bodySignature: string;
  bodyPreview: string;
  telegramMessageId: number | null;
}): Promise<SmsDedupRow> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO sms_dedup (inbox_chat_id, body_signature, body_preview, telegram_message_id)
    VALUES (${args.inboxChatId}, ${args.bodySignature},
            ${args.bodyPreview.slice(0, 400)}, ${args.telegramMessageId})
    ON CONFLICT (inbox_chat_id, body_signature) DO UPDATE SET
      last_seen_at = NOW(),
      repeat_count = sms_dedup.repeat_count + 1,
      telegram_message_id = COALESCE(EXCLUDED.telegram_message_id,
                                     sms_dedup.telegram_message_id)
    RETURNING id, inbox_chat_id, body_signature, body_preview,
              first_sent_at, last_seen_at, repeat_count, telegram_message_id`;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r.id),
    inboxChatId: Number(r.inbox_chat_id),
    bodySignature: r.body_signature as string,
    bodyPreview: (r.body_preview as string) ?? null,
    firstSentAt: r.first_sent_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    repeatCount: Number(r.repeat_count),
    telegramMessageId:
      r.telegram_message_id != null ? Number(r.telegram_message_id) : null,
  };
}

export async function setSmsDedupMessageId(
  dedupId: number,
  telegramMessageId: number,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_dedup SET telegram_message_id = ${telegramMessageId}
    WHERE id = ${dedupId}`;
}

// Highest telegram_message_id we've ever recorded for this inbox chat
// across all sms_dedup rows. Used by routeSmsForward to decide whether
// the existing dedup target is STILL the bottom of the chat or whether
// a newer SMS has pushed it up — in which case we send a fresh message
// instead of editing the scrolled-past original in place.
export async function getMaxSmsMessageIdInInbox(
  inboxChatId: number,
): Promise<number | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT MAX(telegram_message_id) AS max_id
    FROM sms_dedup
    WHERE inbox_chat_id = ${inboxChatId}
      AND telegram_message_id IS NOT NULL`;
  const r = rows[0] as { max_id: string | number | null } | undefined;
  return r?.max_id == null ? null : Number(r.max_id);
}

// Reset a dedup row's repeat counter (the user perceives a re-send
// after other messages as a fresh occurrence, so the next "🔁 دفعه N"
// should count from this fresh send, not from history).
export async function resetSmsDedupCounter(args: {
  dedupId: number;
  telegramMessageId: number;
  bodyPreview: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_dedup
       SET telegram_message_id = ${args.telegramMessageId},
           body_preview = ${args.bodyPreview.slice(0, 400)},
           repeat_count = 1,
           first_sent_at = NOW(),
           last_seen_at = NOW()
     WHERE id = ${args.dedupId}`;
}

export async function getSmsDedup(
  dedupId: number,
): Promise<SmsDedupRow | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, inbox_chat_id, body_signature, body_preview,
           first_sent_at, last_seen_at, repeat_count, telegram_message_id
    FROM sms_dedup WHERE id = ${dedupId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    inboxChatId: Number(r.inbox_chat_id),
    bodySignature: r.body_signature as string,
    bodyPreview: (r.body_preview as string) ?? null,
    firstSentAt: r.first_sent_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    repeatCount: Number(r.repeat_count),
    telegramMessageId:
      r.telegram_message_id != null ? Number(r.telegram_message_id) : null,
  };
}

export async function deleteSmsDedup(dedupId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM sms_dedup WHERE id = ${dedupId}`;
}

// --- SMS block rules ---

export type SmsBlockRule = {
  id: number;
  exampleBody: string;
  label: string | null;
  enabled: boolean;
  hitCount: number;
  lastHitAt: Date | null;
  createdAt: Date;
  createdBy: number | null;
};

function rowToSmsBlockRule(r: Record<string, unknown>): SmsBlockRule {
  return {
    id: Number(r.id),
    exampleBody: r.example_body as string,
    label: (r.label as string) ?? null,
    enabled: Boolean(r.enabled),
    hitCount: Number(r.hit_count ?? 0),
    lastHitAt: (r.last_hit_at as Date) ?? null,
    createdAt: r.created_at as Date,
    createdBy: r.created_by != null ? Number(r.created_by) : null,
  };
}

export async function listSmsBlockRules(args?: {
  enabledOnly?: boolean;
}): Promise<SmsBlockRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const rows = await sql()`
    SELECT id, example_body, label, enabled, hit_count, last_hit_at,
           created_at, created_by
    FROM sms_block_rules
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSmsBlockRule);
}

export async function createSmsBlockRule(args: {
  exampleBody: string;
  label?: string | null;
  createdBy?: number | null;
}): Promise<SmsBlockRule> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO sms_block_rules (example_body, label, created_by)
    VALUES (${args.exampleBody}, ${args.label ?? null}, ${args.createdBy ?? null})
    RETURNING id, example_body, label, enabled, hit_count, last_hit_at,
              created_at, created_by`;
  return rowToSmsBlockRule(rows[0] as Record<string, unknown>);
}

export async function updateSmsBlockRule(
  id: number,
  patch: Partial<{ label: string | null; enabled: boolean }>,
): Promise<SmsBlockRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const labelMarker = patch.label === undefined ? 0 : 1;
  const labelValue = patch.label ?? null;
  const rows = await sql()`
    UPDATE sms_block_rules SET
      label = CASE WHEN ${labelMarker}::int = 1 THEN ${labelValue} ELSE label END,
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled)
    WHERE id = ${id}
    RETURNING id, example_body, label, enabled, hit_count, last_hit_at,
              created_at, created_by`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSmsBlockRule(r) : null;
}

export async function deleteSmsBlockRule(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM sms_block_rules WHERE id = ${id}`;
}

export async function touchSmsBlockRule(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_block_rules
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE id = ${id}`;
}

// --- SMS accept signatures ---

export async function addSmsAcceptSignature(args: {
  bodySignature: string;
  bodyPreview: string;
  createdBy?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO sms_accept_signatures (body_signature, body_preview, created_by)
    VALUES (${args.bodySignature}, ${args.bodyPreview.slice(0, 400)},
            ${args.createdBy ?? null})
    ON CONFLICT (body_signature) DO NOTHING`;
}

export async function isSmsAcceptedSignature(
  signature: string,
): Promise<boolean> {
  if (!hasDb() || !signature) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM sms_accept_signatures
    WHERE body_signature = ${signature}
    LIMIT 1`;
  return rows.length > 0;
}

export async function touchSmsAcceptSignature(
  signature: string,
): Promise<void> {
  if (!hasDb() || !signature) return;
  await ensureSchema();
  await sql()`
    UPDATE sms_accept_signatures
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE body_signature = ${signature}`;
}
