// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { bool, date, num, numOrNull, str, strOrNull, type Row } from "./row";
import { ensureSchema, hasDb, sql } from "./core";

// --- Natural-language message rules ---

export type MessageRule = {
  id: number;
  tenantId: number | null;
  name: string;
  description: string;
  forwardFormat: string | null;
  forwardHeader: string | null;
  requestTrigger: string | null;
  requestWindowSeconds: number | null;
  sourceChatIds: number[] | null;
  sourceThreadIds: number[] | null;
  matchPattern: string | null;
  matchAllFromSource: boolean;
  showRulePrefix: boolean;
  formatAsOtp: boolean;
  enabled: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RuleRecipient = {
  ruleId: number;
  recipientChatId: number;
  recipientLabel: string | null;
  paused: boolean;
  createdAt: Date;
};

export type RuleMatch = {
  id: number;
  ruleId: number;
  messageLogId: number;
  formattedText: string | null;
  forwardedTo: number[];
  matchedAt: Date;
};

function parseSourceChatIds(v: unknown): number[] | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ids = v
    .split(/[\s,]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
  return ids.length > 0 ? ids : null;
}

export function rowToRule(r: Row): MessageRule {
  return {
    id: num(r, "id"),
    tenantId: numOrNull(r, "tenant_id"),
    name: str(r, "name"),
    description: str(r, "description"),
    forwardFormat: strOrNull(r, "forward_format"),
    forwardHeader: strOrNull(r, "forward_header"),
    requestTrigger: strOrNull(r, "request_trigger"),
    requestWindowSeconds: numOrNull(r, "request_window_seconds"),
    sourceChatIds: parseSourceChatIds(r.source_chat_ids),
    sourceThreadIds: parseSourceChatIds(r.source_thread_ids),
    matchPattern: strOrNull(r, "match_pattern"),
    matchAllFromSource: bool(r, "match_all_from_source"),
    // NULL means "not set" and the historical default is on.
    showRulePrefix: bool(r, "show_rule_prefix", true),
    formatAsOtp: bool(r, "format_as_otp"),
    enabled: bool(r, "enabled"),
    createdBy: numOrNull(r, "created_by"),
    createdAt: date(r, "created_at"),
    updatedAt: date(r, "updated_at"),
  };
}

export async function listMessageRules(args?: {
  enabledOnly?: boolean;
  tenantId?: number | null;
}): Promise<MessageRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    SELECT id, tenant_id, name, description, forward_format, forward_header,
           request_trigger, request_window_seconds, source_chat_ids, source_thread_ids, match_pattern, match_all_from_source,
           show_rule_prefix, format_as_otp, enabled,
           created_by, created_at, updated_at
    FROM message_rules
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
      AND (${tenantId}::bigint IS NULL OR tenant_id IS NULL OR tenant_id = ${tenantId}::bigint)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToRule);
}

export async function getMessageRule(id: number): Promise<MessageRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, tenant_id, name, description, forward_format, forward_header,
           request_trigger, request_window_seconds, source_chat_ids, source_thread_ids, match_pattern, match_all_from_source,
           show_rule_prefix, format_as_otp, enabled,
           created_by, created_at, updated_at
    FROM message_rules WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToRule(r) : null;
}

export async function createMessageRule(args: {
  name: string;
  description: string;
  forwardFormat?: string | null;
  enabled?: boolean;
  createdBy?: number | null;
  tenantId?: number | null;
}): Promise<MessageRule> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO message_rules (tenant_id, name, description, forward_format, enabled, created_by)
    VALUES (
      ${args.tenantId ?? null},
      ${args.name},
      ${args.description},
      ${args.forwardFormat ?? null},
      ${args.enabled ?? true},
      ${args.createdBy ?? null}
    )
    RETURNING id, tenant_id, name, description, forward_format, forward_header,
              request_trigger, request_window_seconds, source_chat_ids, source_thread_ids, match_pattern, match_all_from_source,
              show_rule_prefix, format_as_otp,
              enabled, created_by, created_at, updated_at`;
  return rowToRule(rows[0] as Record<string, unknown>);
}

export async function updateMessageRule(
  id: number,
  patch: Partial<{
    name: string;
    description: string;
    forwardFormat: string | null;
    forwardHeader: string | null;
    requestTrigger: string | null;
    requestWindowSeconds: number | null;
    sourceChatIds: string | null;
    sourceThreadIds: string | null;
    matchPattern: string | null;
    matchAllFromSource: boolean;
    showRulePrefix: boolean;
    formatAsOtp: boolean;
    enabled: boolean;
  }>,
): Promise<MessageRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  // Nullable fields use a marker+value pair so we can tell "leave alone"
  // (undefined) from "set to NULL" (null).
  const ffMarker = patch.forwardFormat === undefined ? 0 : 1;
  const ffValue = patch.forwardFormat ?? null;
  const fhMarker = patch.forwardHeader === undefined ? 0 : 1;
  const fhValue = patch.forwardHeader ?? null;
  const rtMarker = patch.requestTrigger === undefined ? 0 : 1;
  const rtValue = patch.requestTrigger ?? null;
  const rwMarker = patch.requestWindowSeconds === undefined ? 0 : 1;
  const rwValue = patch.requestWindowSeconds ?? null;
  const scMarker = patch.sourceChatIds === undefined ? 0 : 1;
  const scValue = patch.sourceChatIds ?? null;
  const stMarker = patch.sourceThreadIds === undefined ? 0 : 1;
  const stValue = patch.sourceThreadIds ?? null;
  const mpMarker = patch.matchPattern === undefined ? 0 : 1;
  const mpValue = patch.matchPattern ?? null;
  const rows = await sql()`
    UPDATE message_rules SET
      name = COALESCE(${patch.name ?? null}, name),
      description = COALESCE(${patch.description ?? null}, description),
      forward_format = CASE WHEN ${ffMarker}::int = 1 THEN ${ffValue} ELSE forward_format END,
      forward_header = CASE WHEN ${fhMarker}::int = 1 THEN ${fhValue} ELSE forward_header END,
      request_trigger = CASE WHEN ${rtMarker}::int = 1 THEN ${rtValue} ELSE request_trigger END,
      request_window_seconds = CASE WHEN ${rwMarker}::int = 1 THEN ${rwValue}::int ELSE request_window_seconds END,
      source_chat_ids = CASE WHEN ${scMarker}::int = 1 THEN ${scValue} ELSE source_chat_ids END,
      source_thread_ids = CASE WHEN ${stMarker}::int = 1 THEN ${stValue} ELSE source_thread_ids END,
      match_pattern = CASE WHEN ${mpMarker}::int = 1 THEN ${mpValue} ELSE match_pattern END,
      match_all_from_source = COALESCE(${patch.matchAllFromSource ?? null}::boolean, match_all_from_source),
      show_rule_prefix = COALESCE(${patch.showRulePrefix ?? null}::boolean, show_rule_prefix),
      format_as_otp = COALESCE(${patch.formatAsOtp ?? null}::boolean, format_as_otp),
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, tenant_id, name, description, forward_format, forward_header,
              request_trigger, request_window_seconds, source_chat_ids, source_thread_ids, match_pattern, match_all_from_source,
              show_rule_prefix, format_as_otp,
              enabled, created_by, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToRule(r) : null;
}

export async function deleteMessageRule(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM message_rule_matches WHERE rule_id = ${id}`;
  await sql()`DELETE FROM message_rule_recipients WHERE rule_id = ${id}`;
  await sql()`DELETE FROM message_rules WHERE id = ${id}`;
}

export async function listRuleRecipients(
  ruleId: number,
): Promise<RuleRecipient[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT rule_id, recipient_chat_id, recipient_label, paused, created_at
    FROM message_rule_recipients
    WHERE rule_id = ${ruleId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    ruleId: Number(r.rule_id),
    recipientChatId: Number(r.recipient_chat_id),
    recipientLabel: (r.recipient_label as string) ?? null,
    paused: Boolean(r.paused),
    createdAt: r.created_at as Date,
  }));
}

// Returns true iff the owner should be told "AI is now replying in this
// chat" — i.e. we haven't notified for this (connection, chat) within
// the throttle window. Atomically records the notify time so concurrent
// messages don't double-notify. First engagement always notifies.
export async function shouldNotifyAiActivity(args: {
  businessConnectionId: string;
  chatId: number;
  throttleMinutes: number;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO ai_reply_notifications (business_connection_id, chat_id, last_notified_at)
    VALUES (${args.businessConnectionId}, ${args.chatId}, NOW())
    ON CONFLICT (business_connection_id, chat_id) DO UPDATE
      SET last_notified_at = NOW()
      WHERE ai_reply_notifications.last_notified_at
            < NOW() - (${args.throttleMinutes}::int || ' minutes')::interval
    RETURNING 1`;
  return rows.length > 0;
}
