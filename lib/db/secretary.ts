// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { CHAT_MODES, ChatMode, ChatRule, FUNCTION_ROLES, FunctionRole, RELATIONSHIPS, Relationship, getChatRule, rowToChatRule } from "./chats";
import { ensureSchema, hasDb, sql } from "./core";

// --- Secretary relays ---

export type SecretaryRelay = {
  id: number;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SecretaryRelayParty = {
  relayId: number;
  chatId: number;
  label: string | null;
  createdAt: Date;
};

function rowToSecretaryRelay(r: Record<string, unknown>): SecretaryRelay {
  return {
    id: Number(r.id),
    name: r.name as string,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function listSecretaryRelays(args?: {
  enabledOnly?: boolean;
}): Promise<SecretaryRelay[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const enabledOnly = args?.enabledOnly ?? false;
  const rows = await sql()`
    SELECT id, name, enabled, created_at, updated_at
    FROM secretary_relays
    WHERE (${enabledOnly}::boolean = FALSE OR enabled = TRUE)
    ORDER BY created_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToSecretaryRelay);
}

export async function getSecretaryRelay(id: number): Promise<SecretaryRelay | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, name, enabled, created_at, updated_at
    FROM secretary_relays WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretaryRelay(r) : null;
}

export async function createSecretaryRelay(args: {
  name: string;
  enabled?: boolean;
}): Promise<SecretaryRelay> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO secretary_relays (name, enabled)
    VALUES (${args.name}, ${args.enabled ?? true})
    RETURNING id, name, enabled, created_at, updated_at`;
  return rowToSecretaryRelay(rows[0] as Record<string, unknown>);
}

export async function updateSecretaryRelay(
  id: number,
  patch: Partial<{ name: string; enabled: boolean }>,
): Promise<SecretaryRelay | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    UPDATE secretary_relays SET
      name = COALESCE(${patch.name ?? null}, name),
      enabled = COALESCE(${patch.enabled ?? null}::boolean, enabled),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, enabled, created_at, updated_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToSecretaryRelay(r) : null;
}

export async function deleteSecretaryRelay(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`DELETE FROM secretary_relays WHERE id = ${id}`;
}

export async function listSecretaryRelaySources(
  relayId: number,
): Promise<SecretaryRelayParty[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT relay_id, source_chat_id, source_label, created_at
    FROM secretary_relay_sources
    WHERE relay_id = ${relayId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    relayId: Number(r.relay_id),
    chatId: Number(r.source_chat_id),
    label: (r.source_label as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function addSecretaryRelaySource(args: {
  relayId: number;
  sourceChatId: number;
  label?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_relay_sources (relay_id, source_chat_id, source_label)
    VALUES (${args.relayId}, ${args.sourceChatId}, ${args.label ?? null})
    ON CONFLICT (relay_id, source_chat_id) DO UPDATE SET
      source_label = COALESCE(EXCLUDED.source_label, secretary_relay_sources.source_label)`;
}

export async function removeSecretaryRelaySource(args: {
  relayId: number;
  sourceChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM secretary_relay_sources
    WHERE relay_id = ${args.relayId}
      AND source_chat_id = ${args.sourceChatId}`;
}

export async function listSecretaryRelayRecipients(
  relayId: number,
): Promise<SecretaryRelayParty[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT relay_id, recipient_chat_id, recipient_label, created_at
    FROM secretary_relay_recipients
    WHERE relay_id = ${relayId}
    ORDER BY created_at ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    relayId: Number(r.relay_id),
    chatId: Number(r.recipient_chat_id),
    label: (r.recipient_label as string) ?? null,
    createdAt: r.created_at as Date,
  }));
}

export async function addSecretaryRelayRecipient(args: {
  relayId: number;
  recipientChatId: number;
  label?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_relay_recipients (relay_id, recipient_chat_id, recipient_label)
    VALUES (${args.relayId}, ${args.recipientChatId}, ${args.label ?? null})
    ON CONFLICT (relay_id, recipient_chat_id) DO UPDATE SET
      recipient_label = COALESCE(EXCLUDED.recipient_label, secretary_relay_recipients.recipient_label)`;
}

export async function removeSecretaryRelayRecipient(args: {
  relayId: number;
  recipientChatId: number;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    DELETE FROM secretary_relay_recipients
    WHERE relay_id = ${args.relayId}
      AND recipient_chat_id = ${args.recipientChatId}`;
}

// Lookup: every enabled Route that lists this source chat.
export async function findEnabledRelaysForSource(
  sourceChatId: number,
): Promise<
  Array<SecretaryRelay & { recipients: SecretaryRelayParty[] }>
> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT r.id, r.name, r.enabled, r.created_at, r.updated_at
    FROM secretary_relays r
    JOIN secretary_relay_sources s ON s.relay_id = r.id
    WHERE r.enabled = TRUE
      AND s.source_chat_id = ${sourceChatId}
    ORDER BY r.created_at ASC`;
  const relays = (rows as Array<Record<string, unknown>>).map(
    rowToSecretaryRelay,
  );
  const out: Array<SecretaryRelay & { recipients: SecretaryRelayParty[] }> = [];
  for (const relay of relays) {
    const recipients = await listSecretaryRelayRecipients(relay.id);
    out.push({ ...relay, recipients });
  }
  return out;
}

export async function recordSecretaryRelayLink(args: {
  relayId: number | null;
  businessConnectionId: string | null;
  sourceChatId: number;
  sourceMessageId: number | null;
  recipientChatId: number;
  recipientMessageId: number;
  direction: "inbound" | "outbound";
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO secretary_relay_links (
      relay_id, business_connection_id, source_chat_id, source_message_id,
      recipient_chat_id, recipient_message_id, direction
    ) VALUES (
      ${args.relayId ?? null}, ${args.businessConnectionId},
      ${args.sourceChatId}, ${args.sourceMessageId ?? null},
      ${args.recipientChatId}, ${args.recipientMessageId}, ${args.direction}
    )
    ON CONFLICT (recipient_chat_id, recipient_message_id) DO UPDATE SET
      source_message_id = COALESCE(EXCLUDED.source_message_id,
                                   secretary_relay_links.source_message_id)`;
}

export type SecretaryRelayLink = {
  id: number;
  relayId: number | null;
  businessConnectionId: string | null;
  sourceChatId: number;
  sourceMessageId: number | null;
  recipientChatId: number;
  recipientMessageId: number;
  direction: string;
};

// Reply routing: given an inbound message at (recipient_chat,
// recipient_message_id) — typically the message the recipient is
// REPLYING to — find the source chat to relay the reply back to.
export async function findSecretaryRelayLinkByRecipientMessage(
  recipientChatId: number,
  recipientMessageId: number,
): Promise<SecretaryRelayLink | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, relay_id, business_connection_id, source_chat_id, source_message_id,
           recipient_chat_id, recipient_message_id, direction
    FROM secretary_relay_links
    WHERE recipient_chat_id = ${recipientChatId}
      AND recipient_message_id = ${recipientMessageId}
    LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    relayId: r.relay_id != null ? Number(r.relay_id) : null,
    businessConnectionId: (r.business_connection_id as string) ?? null,
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    recipientChatId: Number(r.recipient_chat_id),
    recipientMessageId: Number(r.recipient_message_id),
    direction: r.direction as string,
  };
}

// Fallback when the recipient typed a fresh message (no reply): pick
// the most recent inbound link for this recipient chat. Lets a
// recipient "just type" in their DM without manually replying to the
// forwarded message.
export async function findLatestInboundLinkForRecipient(
  recipientChatId: number,
  withinMinutes: number,
): Promise<SecretaryRelayLink | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, relay_id, business_connection_id, source_chat_id, source_message_id,
           recipient_chat_id, recipient_message_id, direction
    FROM secretary_relay_links
    WHERE recipient_chat_id = ${recipientChatId}
      AND direction = 'inbound'
      AND created_at > NOW() - make_interval(mins => ${withinMinutes})
    ORDER BY created_at DESC LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    relayId: r.relay_id != null ? Number(r.relay_id) : null,
    businessConnectionId: (r.business_connection_id as string) ?? null,
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    recipientChatId: Number(r.recipient_chat_id),
    recipientMessageId: Number(r.recipient_message_id),
    direction: r.direction as string,
  };
}

// Source-side reverse lookup: when the source message itself comes in
// (e.g. for a "delete" or "edit" propagation), find the recipient
// copies. Not used by the current implementation but exposed for
// future extension.
export async function listRelayLinksBySource(
  sourceChatId: number,
  sourceMessageId: number,
): Promise<SecretaryRelayLink[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, relay_id, business_connection_id, source_chat_id, source_message_id,
           recipient_chat_id, recipient_message_id, direction
    FROM secretary_relay_links
    WHERE source_chat_id = ${sourceChatId}
      AND source_message_id = ${sourceMessageId}`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    relayId: r.relay_id != null ? Number(r.relay_id) : null,
    businessConnectionId: (r.business_connection_id as string) ?? null,
    sourceChatId: Number(r.source_chat_id),
    sourceMessageId:
      r.source_message_id != null ? Number(r.source_message_id) : null,
    recipientChatId: Number(r.recipient_chat_id),
    recipientMessageId: Number(r.recipient_message_id),
    direction: r.direction as string,
  }));
}

export async function setChatPhoneNumber(
  chatId: number,
  phoneNumber: string | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const trimmed = phoneNumber?.trim() ?? null;
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, phone_number, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${trimmed},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      phone_number = ${trimmed},
      updated_at = NOW()`;
}

export async function setChatIgnored(
  chatId: number,
  ignored: boolean,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Same upsert dance as setAutoSummarize so chats without a
  // chat_rules row yet still get one when the flag is toggled.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, ignored, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${ignored},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      ignored = ${ignored},
      updated_at = NOW()`;
}

// Lightweight "should we even touch this chat?" check used at the top
// of handleBusinessMessage / handleAnyChatPost so the rest of the
// pipeline never sees ignored chats. Cached in-memory briefly so a
// burst of messages doesn't query for every one.
const ignoredCache = new Map<number, { v: boolean; expiresAt: number }>();
const IGNORED_TTL_MS = 10_000;

export async function isChatIgnored(chatId: number): Promise<boolean> {
  if (!hasDb()) return false;
  const cached = ignoredCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) return cached.v;
  await ensureSchema();
  const rows = await sql()`
    SELECT ignored FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const v = Boolean((rows[0] as { ignored?: boolean } | undefined)?.ignored);
  ignoredCache.set(chatId, { v, expiresAt: Date.now() + IGNORED_TTL_MS });
  return v;
}

export function invalidateIgnoredCache(chatId?: number): void {
  if (chatId == null) ignoredCache.clear();
  else ignoredCache.delete(chatId);
}

// First chat tagged as the summary_inbox. The caller decides whether
// to fan out to multiple if more than one is tagged; for now we use
// the most recently updated one.
export async function getPrimarySummaryInbox(): Promise<ChatRule | null> {
  if (!hasDb()) return null;
  const list = await listChatsByFunction("summary_inbox");
  return list[0] ?? null;
}

export async function listChatsByFunction(
  role: FunctionRole,
  tenantId?: number | null,
): Promise<ChatRule[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  // Pull chats whose junction table OR legacy function_role column
  // contains this role. The OR keeps the path safe even if the
  // migration hasn't run yet on a stale deploy.
  const rows = await sql()`
    SELECT r.chat_id, r.chat_type, r.chat_title, r.vip, r.muted, r.custom_reply, r.notes,
           r.mode, r.mode_changed_at, r.secretary_user_id,
           r.first_name, r.last_name, r.nickname, r.relationship,
           r.relationship_notes, r.talk_style_notes,
           r.tone_profile, r.tone_profile_at,
           r.flood_cooldown_until, r.flood_deflected_at,
           r.ai_process_voice, r.ai_process_stickers, r.ai_process_gifs, r.ai_process_photos,
           r.ai_process_video_notes, r.ai_generate_photo,
           r.function_role, r.function_config,
           r.auto_summarize_enabled, r.auto_summarize_gap_minutes,
           r.auto_summarize_smart_timing,
           r.last_auto_summary_at,
           r.auto_forward_voice, r.auto_forward_video, r.auto_forward_photo,
           r.auto_forward_location, r.auto_extract_notes,
           r.is_bot, r.ignored, r.phone_number,
           r.grace_skipped_at, r.updated_at
    FROM chat_rules r
    WHERE (
      r.function_role = ${role}
      OR EXISTS (
        SELECT 1 FROM chat_function_roles f
        WHERE f.chat_id = r.chat_id AND f.role = ${role}
      )
    )
      AND (${tenantId ?? null}::bigint IS NULL OR r.tenant_id = ${tenantId ?? null})
    ORDER BY r.updated_at DESC`;
  return (rows as Array<Record<string, unknown>>).map(rowToChatRule);
}

// Chats assigned to a role, organized by their function category. Used
// by the /functions page to render "Downloader bots → default group →
// [chat A] / work group → [chat B]" without two round-trips per role.
export type RoleChatWithCategory = {
  chatId: number;
  category: string;
  chatTitle: string | null;
  chatType: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
};

export async function listChatsByFunctionWithCategory(
  role: FunctionRole,
  tenantId?: number | null,
): Promise<RoleChatWithCategory[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT cfr.chat_id,
           COALESCE(NULLIF(cfr.category, ''), 'default') AS category,
           r.chat_title, r.chat_type,
           r.first_name, r.last_name, r.nickname
    FROM chat_function_roles cfr
    LEFT JOIN chat_rules r ON r.chat_id = cfr.chat_id
    WHERE cfr.role = ${role}
      AND (${tenantId ?? null}::bigint IS NULL OR r.tenant_id = ${tenantId ?? null})
    ORDER BY category ASC, cfr.chat_id ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    chatId: Number(r.chat_id),
    category: r.category as string,
    chatTitle: (r.chat_title as string) ?? null,
    chatType: (r.chat_type as string) ?? "private",
    firstName: (r.first_name as string) ?? null,
    lastName: (r.last_name as string) ?? null,
    nickname: (r.nickname as string) ?? null,
  }));
}

export type FunctionCategory = {
  slug: string;
  label: string;
  emoji: string | null;
  sortOrder: number;
  isBuiltin: boolean;
};

export async function listFunctionCategories(): Promise<FunctionCategory[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT slug, label, emoji, sort_order, is_builtin
    FROM function_categories
    ORDER BY sort_order ASC, label ASC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    slug: r.slug as string,
    label: r.label as string,
    emoji: (r.emoji as string) ?? null,
    sortOrder: Number(r.sort_order ?? 100),
    isBuiltin: Boolean(r.is_builtin),
  }));
}

export async function createFunctionCategory(args: {
  slug: string;
  label: string;
  emoji?: string | null;
  sortOrder?: number;
}): Promise<FunctionCategory> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO function_categories (slug, label, emoji, sort_order, is_builtin)
    VALUES (${args.slug}, ${args.label}, ${args.emoji ?? null},
            ${args.sortOrder ?? 100}, FALSE)
    ON CONFLICT (slug) DO UPDATE SET
      label = EXCLUDED.label,
      emoji = EXCLUDED.emoji,
      sort_order = EXCLUDED.sort_order
    RETURNING slug, label, emoji, sort_order, is_builtin`;
  const r = rows[0] as Record<string, unknown>;
  return {
    slug: r.slug as string,
    label: r.label as string,
    emoji: (r.emoji as string) ?? null,
    sortOrder: Number(r.sort_order ?? 100),
    isBuiltin: Boolean(r.is_builtin),
  };
}

export async function deleteFunctionCategory(slug: string): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Move assignments to default before deleting.
  await sql()`UPDATE chat_function_roles SET category = 'default' WHERE category = ${slug}`;
  await sql()`DELETE FROM function_categories WHERE slug = ${slug} AND is_builtin = FALSE`;
}

export async function setChatFunctionCategory(args: {
  chatId: number;
  role: FunctionRole;
  category: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_function_roles
    SET category = ${args.category}
    WHERE chat_id = ${args.chatId} AND role = ${args.role}`;
}

// All function roles for a single chat, sorted alphabetically. New
// code should read from here; the legacy ChatRule.functionRole single
// value stays exposed for backwards compat with callers that haven't
// been migrated to multi-role yet.
export async function getChatFunctionRoles(
  chatId: number,
): Promise<FunctionRole[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT role FROM chat_function_roles
    WHERE chat_id = ${chatId}
    ORDER BY role ASC`;
  return (rows as Array<{ role: string }>)
    .map((r) => r.role)
    .filter((r): r is FunctionRole =>
      (FUNCTION_ROLES as readonly string[]).includes(r),
    );
}

// Drop a single role assignment from a chat. Used by self-healing
// paths (e.g. when the follow-up cron detects the notes_inbox chat
// is unreachable and wants to stop retrying forever).
export async function removeChatFunctionRole(
  chatId: number,
  role: FunctionRole,
): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    DELETE FROM chat_function_roles
     WHERE chat_id = ${chatId} AND role = ${role}
     RETURNING chat_id`;
  // Also clear the legacy single-role mirror if this was the value
  // stored there.
  await sql()`
    UPDATE chat_rules SET function_role = NULL, updated_at = NOW()
     WHERE chat_id = ${chatId} AND function_role = ${role}`;
  return (rows as Array<unknown>).length;
}

export async function setChatFunctionRoles(
  chatId: number,
  roles: FunctionRole[],
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const q = sql();
  // Replace strategy — clear then insert. Roles list is small (≤10
  // total) so the round-trip cost is negligible.
  await q`DELETE FROM chat_function_roles WHERE chat_id = ${chatId}`;
  const filtered = roles.filter((r) =>
    (FUNCTION_ROLES as readonly string[]).includes(r),
  );
  for (const role of filtered) {
    await q`
      INSERT INTO chat_function_roles (chat_id, role)
      VALUES (${chatId}, ${role})
      ON CONFLICT (chat_id, role) DO NOTHING`;
  }
  // Mirror to the legacy single-role column for callers still on
  // the old API: pick the first role (sorted by insertion order).
  // chat_rules row must exist; create if not. Same chat_type lookup
  // dance as setChatAutomation so we don't stamp 'private' onto a
  // channel that's never had a chat_rules row before.
  const primary = filtered[0] ?? null;
  const guessed = chatId < 0 ? "supergroup" : "private";
  await q`
    INSERT INTO chat_rules (chat_id, chat_type, function_role, updated_at)
    VALUES (${chatId},
      COALESCE(
        (SELECT chat_type FROM messages_log WHERE chat_id = ${chatId} LIMIT 1),
        ${guessed}
      ),
      ${primary}, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      function_role = ${primary},
      updated_at = NOW()`;
}

// Persist a fine-tuned tone profile for a chat. Separate from
// upsertChatRule so we can update it without overwriting any of the
// per-chat metadata.
export async function saveToneProfile(
  chatId: number,
  toneProfile: string,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET tone_profile = ${toneProfile},
        tone_profile_at = NOW(),
        updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

// Cooldown helpers for the flood-protection / waitlist logic. Once we
// send the "I'm busy" deflection, we stay silent in that chat for the
// duration of the cooldown.
export async function setFloodCooldown(
  chatId: number,
  cooldownUntil: Date,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET flood_cooldown_until = ${cooldownUntil.toISOString()},
        flood_deflected_at = NOW(),
        updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

// Count how many non-owner, non-bot messages this chat received in the
// last N seconds. Used by the AI reply path to decide whether the
// person is flooding.
export async function recentIncomingCount(
  chatId: number,
  windowSeconds: number,
): Promise<number> {
  if (!hasDb()) return 0;
  await ensureSchema();
  const rows = await sql()`
    SELECT COUNT(*)::int AS n FROM messages_log
    WHERE chat_id = ${chatId}
      AND from_owner = FALSE
      AND source IS NULL
      AND created_at > NOW() - (${windowSeconds} || ' seconds')::INTERVAL`;
  return Number((rows[0] as { n: number })?.n) || 0;
}

// Owner clicked "Resume bot now" — mark grace as skipped at this instant.
// The bot's grace check ignores grace whenever grace_skipped_at is more
// recent than the owner's last message in this chat. As soon as the owner
// sends another message, grace_skipped_at becomes older than that and the
// grace timer restarts automatically.
export async function skipChatGrace(args: {
  chatId: number;
  chatType: string;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, grace_skipped_at, updated_at)
    VALUES (${args.chatId}, ${args.chatType}, NOW(), NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      grace_skipped_at = NOW(),
      updated_at = NOW()`;
}

// Auto-fill chat first/last name from Telegram's user info ONLY when the
// owner hasn't set them yet (COALESCE keeps existing custom values).
export async function autoFillChatNames(args: {
  chatId: number;
  chatType: string;
  firstName?: string | null;
  lastName?: string | null;
  isBot?: boolean;
}): Promise<void> {
  if (!hasDb()) return;
  if (!args.firstName && !args.lastName && !args.isBot) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, first_name, last_name, is_bot, updated_at)
    VALUES (${args.chatId}, ${args.chatType},
            ${args.firstName ?? null}, ${args.lastName ?? null},
            ${args.isBot ?? false}, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      first_name = COALESCE(chat_rules.first_name, EXCLUDED.first_name),
      last_name = COALESCE(chat_rules.last_name, EXCLUDED.last_name),
      is_bot = chat_rules.is_bot OR EXCLUDED.is_bot,
      updated_at = CASE
        WHEN chat_rules.first_name IS NULL OR chat_rules.last_name IS NULL
          THEN NOW() ELSE chat_rules.updated_at
      END`;
}

export async function getChatMode(
  chatId: number,
): Promise<{ mode: ChatMode; changedAt: Date }> {
  const rule = await getChatRule(chatId).catch(() => null);
  return {
    mode: rule?.mode ?? "off",
    changedAt: rule?.modeChangedAt ?? new Date(0),
  };
}

export type ChatListFilters = {
  mode?: ChatMode | null;
  // Telegram chat type: "private" | "group" | "supergroup" | "channel"
  chatType?: string | null;
  relationship?: Relationship | "__unset__" | null;
  functionRole?: string | "__unset__" | null;
  // Boolean toggles — undefined = ignore, true = require ON, false = require OFF.
  vip?: boolean;
  muted?: boolean;
  isBot?: boolean;
  hasProfile?: boolean;
  autoSummarizeOn?: boolean;
  followUpOn?: boolean;
  followUpTranscribeOn?: boolean;
  autoForwardVoiceOn?: boolean;
  autoForwardVideoOn?: boolean;
  autoForwardPhotoOn?: boolean;
  autoExtractNotesOn?: boolean;
  hasPhone?: boolean;
  // profileId: include only chats explicitly assigned to this profile.
  // When the profile is the tenant default, also include chats with
  // NULL profile_id (they implicitly belong to the default profile).
  profileId?: number | null;
  // text search across first/last name / nickname / chat_title
  q?: string | null;
};

export async function listChats(opts: {
  limit?: number;
  offset?: number;
  filters?: ChatListFilters;
} = {}): Promise<
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
    mode: ChatMode;
    modeChangedAt: Date | null;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    relationship: Relationship | null;
    secretaryUserId: number | null;
    functionRole: string | null;
    isBot: boolean;
    aiCostUsd: number;
    aiTokens: number;
  }>
> {
  await ensureSchema();
  const f = opts.filters ?? {};
  const like = f.q?.trim() ? `%${f.q.trim()}%` : null;
  // Resolve sentinel "__unset__" up-front so the SQL stays simple:
  // relValue=null + relUnset=true means "filter to NULL relationship".
  const relUnset = f.relationship === "__unset__";
  const relValue: string | null = relUnset
    ? null
    : (f.relationship ?? null);
  const roleUnset = f.functionRole === "__unset__";
  const roleValue: string | null = roleUnset
    ? null
    : (f.functionRole ?? null);
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
      MAX(r.custom_reply) AS custom_reply,
      MAX(r.mode) AS mode,
      MAX(r.mode_changed_at) AS mode_changed_at,
      MAX(r.first_name) AS first_name,
      MAX(r.last_name) AS last_name,
      MAX(r.nickname) AS nickname,
      MAX(r.relationship) AS relationship,
      MAX(r.secretary_user_id) AS secretary_user_id,
      MAX(r.function_role) AS function_role,
      BOOL_OR(COALESCE(r.is_bot, FALSE)) AS is_bot,
      -- Scalar subqueries instead of LEFT JOIN ai_usage — the JOIN
      -- exploded every messages_log row by every ai_usage row for the
      -- same chat (Cartesian product within each GROUP BY group),
      -- which dragged the page out to 30 seconds on tenants with
      -- modest AI history. Subquery runs once per chat, hits the
      -- ai_usage_chat_idx index, and stays cheap.
      COALESCE((SELECT SUM(cost_usd)::float8 FROM ai_usage WHERE chat_id = m.chat_id), 0) AS ai_cost,
      COALESCE((SELECT SUM(total_tokens)::int FROM ai_usage WHERE chat_id = m.chat_id), 0) AS ai_tokens
    FROM messages_log m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE
      (${f.mode ?? null}::text IS NULL OR COALESCE(r.mode, 'off') = ${f.mode ?? null})
      AND (
        ${f.chatType ?? null}::text IS NULL
        OR (
          ${f.chatType ?? null}::text = 'private'
            AND m.chat_type = 'private'
            AND NOT COALESCE(r.is_bot, FALSE)
        )
        OR (
          ${f.chatType ?? null}::text = 'bot'
            AND m.chat_type = 'private'
            AND COALESCE(r.is_bot, FALSE)
        )
        OR (
          ${f.chatType ?? null}::text = 'group'
            AND m.chat_type IN ('group', 'supergroup')
        )
        OR (
          ${f.chatType ?? null}::text = 'channel'
            AND m.chat_type = 'channel'
        )
        OR (
          ${f.chatType ?? null}::text NOT IN ('private', 'bot', 'group', 'channel')
            AND m.chat_type = ${f.chatType ?? null}
        )
      )
      AND (${relUnset}::boolean = FALSE OR r.relationship IS NULL)
      AND (${relValue}::text IS NULL OR r.relationship = ${relValue})
      AND (
        ${roleUnset}::boolean = FALSE
        OR (r.function_role IS NULL AND NOT EXISTS (
              SELECT 1 FROM chat_function_roles fr WHERE fr.chat_id = m.chat_id
           ))
      )
      AND (
        ${roleValue}::text IS NULL
        OR r.function_role = ${roleValue}
        OR EXISTS (
          SELECT 1 FROM chat_function_roles fr
          WHERE fr.chat_id = m.chat_id AND fr.role = ${roleValue}
        )
      )
      AND (${f.vip === undefined}::boolean OR COALESCE(r.vip, FALSE) = ${f.vip ?? false}::boolean)
      AND (${f.muted === undefined}::boolean OR COALESCE(r.muted, FALSE) = ${f.muted ?? false}::boolean)
      AND (${f.isBot === undefined}::boolean OR COALESCE(r.is_bot, FALSE) = ${f.isBot ?? false}::boolean)
      AND (${f.hasProfile === undefined}::boolean OR (r.profile_id IS NOT NULL) = ${f.hasProfile ?? false}::boolean)
      AND (${f.autoSummarizeOn === undefined}::boolean OR COALESCE(r.auto_summarize_enabled, FALSE) = ${f.autoSummarizeOn ?? false}::boolean)
      AND (${f.followUpOn === undefined}::boolean OR COALESCE(r.follow_up_enabled, TRUE) = ${f.followUpOn ?? false}::boolean)
      AND (${f.followUpTranscribeOn === undefined}::boolean OR COALESCE(r.follow_up_transcribe_voices, FALSE) = ${f.followUpTranscribeOn ?? false}::boolean)
      AND (${f.autoForwardVoiceOn === undefined}::boolean OR COALESCE(r.auto_forward_voice, FALSE) = ${f.autoForwardVoiceOn ?? false}::boolean)
      AND (${f.autoForwardVideoOn === undefined}::boolean OR COALESCE(r.auto_forward_video, FALSE) = ${f.autoForwardVideoOn ?? false}::boolean)
      AND (${f.autoForwardPhotoOn === undefined}::boolean OR COALESCE(r.auto_forward_photo, FALSE) = ${f.autoForwardPhotoOn ?? false}::boolean)
      AND (${f.autoExtractNotesOn === undefined}::boolean OR COALESCE(r.auto_extract_notes, FALSE) = ${f.autoExtractNotesOn ?? false}::boolean)
      AND (${f.hasPhone === undefined}::boolean OR (r.phone_number IS NOT NULL AND r.phone_number <> '') = ${f.hasPhone ?? false}::boolean)
      AND (
        ${f.profileId ?? null}::int IS NULL
        OR r.profile_id = ${f.profileId ?? null}
        OR (
          r.profile_id IS NULL AND EXISTS (
            SELECT 1 FROM chat_profiles dp
            WHERE dp.id = ${f.profileId ?? null} AND dp.is_default = TRUE
          )
        )
      )
      AND (
        ${like}::text IS NULL
        OR COALESCE(r.first_name, '') ILIKE ${like}
        OR COALESCE(r.last_name, '') ILIKE ${like}
        OR COALESCE(r.nickname, '') ILIKE ${like}
        OR COALESCE(m.chat_title, '') ILIKE ${like}
        OR CAST(m.chat_id AS TEXT) ILIKE ${like}
      )
    GROUP BY m.chat_id
    ORDER BY last_seen DESC NULLS LAST
    LIMIT ${Math.min(Math.max(opts.limit ?? 200, 1), 1000)}
    OFFSET ${Math.max(opts.offset ?? 0, 0)}`;
  return rows.map((r) => {
    const mode = (r.mode as string) ?? "off";
    const rel = (r.relationship as string) ?? null;
    return {
      chatId: Number(r.chat_id),
      chatType: r.chat_type as string,
      chatTitle: (r.chat_title as string) ?? null,
      messages: Number(r.messages),
      urgent: Number(r.urgent),
      lastSeen: (r.last_seen as Date) ?? null,
      vip: r.vip as boolean,
      muted: r.muted as boolean,
      customReply: (r.custom_reply as string) ?? null,
      mode: (CHAT_MODES.includes(mode as ChatMode) ? mode : "off") as ChatMode,
      modeChangedAt: (r.mode_changed_at as Date) ?? null,
      firstName: (r.first_name as string) ?? null,
      lastName: (r.last_name as string) ?? null,
      nickname: (r.nickname as string) ?? null,
      relationship:
        rel && (RELATIONSHIPS as readonly string[]).includes(rel)
          ? (rel as Relationship)
          : null,
      secretaryUserId:
        r.secretary_user_id == null ? null : Number(r.secretary_user_id),
      functionRole: (r.function_role as string) ?? null,
      isBot: Boolean(r.is_bot),
      aiCostUsd: Number(r.ai_cost) || 0,
      aiTokens: Number(r.ai_tokens) || 0,
    };
  });
}

// Light version of listChats — returns only chat_ids matching the
// filters, with no GROUP BY / aggregates / joins to ai_usage. Used by
// the /chats "select all filtered" path which needs only ids.
export async function listChatIds(opts: {
  limit?: number;
  filters?: ChatListFilters;
} = {}): Promise<number[]> {
  await ensureSchema();
  const f = opts.filters ?? {};
  const like = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const relUnset = f.relationship === "__unset__";
  const relValue: string | null = relUnset ? null : (f.relationship ?? null);
  const roleUnset = f.functionRole === "__unset__";
  const roleValue: string | null = roleUnset ? null : (f.functionRole ?? null);
  const rows = await sql()`
    SELECT m.chat_id
    FROM (SELECT DISTINCT chat_id FROM messages_log) m
    LEFT JOIN chat_rules r ON r.chat_id = m.chat_id
    WHERE
      (${f.mode ?? null}::text IS NULL OR COALESCE(r.mode, 'off') = ${f.mode ?? null})
      AND (
        ${f.chatType ?? null}::text IS NULL
        OR (
          ${f.chatType ?? null}::text = 'private'
            AND COALESCE(r.chat_type, 'private') = 'private'
            AND NOT COALESCE(r.is_bot, FALSE)
        )
        OR (
          ${f.chatType ?? null}::text = 'bot'
            AND COALESCE(r.chat_type, 'private') = 'private'
            AND COALESCE(r.is_bot, FALSE)
        )
        OR (
          ${f.chatType ?? null}::text = 'group'
            AND r.chat_type IN ('group', 'supergroup')
        )
        OR (
          ${f.chatType ?? null}::text = 'channel'
            AND r.chat_type = 'channel'
        )
      )
      AND (${relUnset}::boolean = FALSE OR r.relationship IS NULL)
      AND (${relValue}::text IS NULL OR r.relationship = ${relValue})
      AND (
        ${roleUnset}::boolean = FALSE
        OR (r.function_role IS NULL AND NOT EXISTS (
              SELECT 1 FROM chat_function_roles fr WHERE fr.chat_id = m.chat_id
           ))
      )
      AND (
        ${roleValue}::text IS NULL
        OR r.function_role = ${roleValue}
        OR EXISTS (
          SELECT 1 FROM chat_function_roles fr
          WHERE fr.chat_id = m.chat_id AND fr.role = ${roleValue}
        )
      )
      AND (${f.vip === undefined}::boolean OR COALESCE(r.vip, FALSE) = ${f.vip ?? false}::boolean)
      AND (${f.muted === undefined}::boolean OR COALESCE(r.muted, FALSE) = ${f.muted ?? false}::boolean)
      AND (${f.isBot === undefined}::boolean OR COALESCE(r.is_bot, FALSE) = ${f.isBot ?? false}::boolean)
      AND (${f.hasProfile === undefined}::boolean OR (r.profile_id IS NOT NULL) = ${f.hasProfile ?? false}::boolean)
      AND (${f.autoSummarizeOn === undefined}::boolean OR COALESCE(r.auto_summarize_enabled, FALSE) = ${f.autoSummarizeOn ?? false}::boolean)
      AND (${f.followUpOn === undefined}::boolean OR COALESCE(r.follow_up_enabled, TRUE) = ${f.followUpOn ?? false}::boolean)
      AND (${f.followUpTranscribeOn === undefined}::boolean OR COALESCE(r.follow_up_transcribe_voices, FALSE) = ${f.followUpTranscribeOn ?? false}::boolean)
      AND (${f.autoForwardVoiceOn === undefined}::boolean OR COALESCE(r.auto_forward_voice, FALSE) = ${f.autoForwardVoiceOn ?? false}::boolean)
      AND (${f.autoForwardVideoOn === undefined}::boolean OR COALESCE(r.auto_forward_video, FALSE) = ${f.autoForwardVideoOn ?? false}::boolean)
      AND (${f.autoForwardPhotoOn === undefined}::boolean OR COALESCE(r.auto_forward_photo, FALSE) = ${f.autoForwardPhotoOn ?? false}::boolean)
      AND (${f.autoExtractNotesOn === undefined}::boolean OR COALESCE(r.auto_extract_notes, FALSE) = ${f.autoExtractNotesOn ?? false}::boolean)
      AND (${f.hasPhone === undefined}::boolean OR (r.phone_number IS NOT NULL AND r.phone_number <> '') = ${f.hasPhone ?? false}::boolean)
      AND (
        ${f.profileId ?? null}::int IS NULL
        OR r.profile_id = ${f.profileId ?? null}
        OR (
          r.profile_id IS NULL AND EXISTS (
            SELECT 1 FROM chat_profiles dp
            WHERE dp.id = ${f.profileId ?? null} AND dp.is_default = TRUE
          )
        )
      )
      AND (
        ${like}::text IS NULL
        OR COALESCE(r.first_name, '') ILIKE ${like}
        OR COALESCE(r.last_name, '') ILIKE ${like}
        OR COALESCE(r.nickname, '') ILIKE ${like}
        OR COALESCE(r.chat_title, '') ILIKE ${like}
        OR CAST(m.chat_id AS TEXT) ILIKE ${like}
      )
    LIMIT ${Math.min(Math.max(opts.limit ?? 5000, 1), 10000)}`;
  return (rows as Array<{ chat_id: string | number }>).map((r) =>
    Number(r.chat_id),
  );
}

// Per-dimension counts across ALL chats in the system (post tenant
// scope, pre other filters). Used to populate the /chats filter
// dropdowns with global counts instead of "loaded-page" counts.
export type ChatFacets = {
  total: number;
  byMode: Record<string, number>;
  byChatType: Record<string, number>;
  byRelationship: Record<string, number>;
  byFunctionRole: Record<string, number>;
  byProfile: Array<{
    profileId: number | null;
    name: string;
    emoji: string | null;
    isDefault: boolean;
    count: number;
  }>;
  flags: {
    vip: number;
    muted: number;
    isBot: number;
    hasProfile: number;
    hasPhone: number;
    autoSummarizeOn: number;
    followUpOn: number;
    followUpTranscribeOn: number;
    autoForwardVoiceOn: number;
    autoForwardVideoOn: number;
    autoForwardPhotoOn: number;
    autoExtractNotesOn: number;
  };
};

export async function chatFacets(): Promise<ChatFacets> {
  await ensureSchema();
  // Universe = every chat that has at least one logged message.
  // Pick the latest chat_type per chat (messages_log can have the
  // same chat under multiple types over time — pick the most recent).
  const rows = await sql()`
    WITH chats AS (
      -- Plain MAX(chat_type) per chat instead of an ORDER BY-driven
      -- ARRAY_AGG — same result in practice (chat_type rarely
      -- changes for a chat), at a fraction of the per-row cost.
      SELECT m.chat_id, MAX(m.chat_type) AS chat_type
      FROM messages_log m
      GROUP BY m.chat_id
    ),
    joined AS (
      SELECT c.chat_id, COALESCE(r.chat_type, c.chat_type) AS chat_type,
             r.mode, r.relationship, r.function_role,
             r.vip, r.muted, r.is_bot, r.phone_number, r.profile_id,
             r.auto_summarize_enabled, r.follow_up_enabled,
             r.follow_up_transcribe_voices, r.auto_forward_voice,
             r.auto_forward_video, r.auto_forward_photo,
             r.auto_extract_notes
      FROM chats c
      LEFT JOIN chat_rules r ON r.chat_id = c.chat_id
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(mode, 'off') = 'off')::int AS m_off,
      COUNT(*) FILTER (WHERE mode = 'secretary')::int AS m_secretary,
      COUNT(*) FILTER (WHERE mode = 'auto_reply')::int AS m_auto_reply,
      COUNT(*) FILTER (WHERE mode = 'friendly_reply')::int AS m_friendly_reply,
      COUNT(*) FILTER (WHERE mode = 'ai_chat')::int AS m_ai_chat,
      COUNT(*) FILTER (WHERE mode = 'ai_listen')::int AS m_ai_listen,
      COUNT(*) FILTER (WHERE chat_type = 'private' AND NOT COALESCE(is_bot, FALSE))::int AS t_private,
      COUNT(*) FILTER (WHERE chat_type = 'private' AND COALESCE(is_bot, FALSE))::int AS t_bot,
      COUNT(*) FILTER (WHERE chat_type IN ('group', 'supergroup'))::int AS t_group,
      COUNT(*) FILTER (WHERE chat_type = 'channel')::int AS t_channel,
      COUNT(*) FILTER (WHERE COALESCE(vip, FALSE))::int AS f_vip,
      COUNT(*) FILTER (WHERE COALESCE(muted, FALSE))::int AS f_muted,
      COUNT(*) FILTER (WHERE COALESCE(is_bot, FALSE))::int AS f_bot,
      COUNT(*) FILTER (WHERE profile_id IS NOT NULL)::int AS f_profile,
      COUNT(*) FILTER (WHERE phone_number IS NOT NULL AND phone_number <> '')::int AS f_phone,
      COUNT(*) FILTER (WHERE COALESCE(auto_summarize_enabled, FALSE))::int AS f_autosum,
      COUNT(*) FILTER (WHERE COALESCE(follow_up_enabled, TRUE))::int AS f_followup,
      COUNT(*) FILTER (WHERE COALESCE(follow_up_transcribe_voices, FALSE))::int AS f_transcribe,
      COUNT(*) FILTER (WHERE COALESCE(auto_forward_voice, FALSE))::int AS f_fwd_voice,
      COUNT(*) FILTER (WHERE COALESCE(auto_forward_video, FALSE))::int AS f_fwd_video,
      COUNT(*) FILTER (WHERE COALESCE(auto_forward_photo, FALSE))::int AS f_fwd_photo,
      COUNT(*) FILTER (WHERE COALESCE(auto_extract_notes, FALSE))::int AS f_extract
    FROM joined`;
  const r = (rows[0] as Record<string, number | string>) ?? {};

  const relRows = await sql()`
    WITH chats AS (
      SELECT DISTINCT m.chat_id FROM messages_log m
    )
    SELECT COALESCE(r.relationship, '') AS rel, COUNT(*)::int AS cnt
    FROM chats c
    LEFT JOIN chat_rules r ON r.chat_id = c.chat_id
    GROUP BY rel`;
  const byRelationship: Record<string, number> = {};
  for (const x of relRows as Array<{ rel: string; cnt: number }>) {
    byRelationship[x.rel || "__unset__"] = Number(x.cnt);
  }

  const roleRows = await sql()`
    WITH chats AS (
      SELECT DISTINCT m.chat_id FROM messages_log m
    ),
    role_of AS (
      SELECT c.chat_id,
             COALESCE(
               (SELECT f.role FROM chat_function_roles f
                  WHERE f.chat_id = c.chat_id LIMIT 1),
               r.function_role
             ) AS role
      FROM chats c
      LEFT JOIN chat_rules r ON r.chat_id = c.chat_id
    )
    SELECT COALESCE(role, '') AS role, COUNT(*)::int AS cnt
    FROM role_of
    GROUP BY role`;
  const byFunctionRole: Record<string, number> = {};
  for (const x of roleRows as Array<{ role: string; cnt: number }>) {
    byFunctionRole[x.role || "__unset__"] = Number(x.cnt);
  }

  const profRows = await sql()`
    WITH chats AS (
      SELECT DISTINCT m.chat_id FROM messages_log m
    ),
    pid_of AS (
      SELECT c.chat_id, r.profile_id
      FROM chats c
      LEFT JOIN chat_rules r ON r.chat_id = c.chat_id
    )
    SELECT p.id AS profile_id, p.name, p.emoji, p.is_default,
           CASE
             WHEN p.is_default THEN
               (SELECT COUNT(*)::int FROM pid_of
                 WHERE profile_id = p.id OR profile_id IS NULL)
             ELSE
               (SELECT COUNT(*)::int FROM pid_of WHERE profile_id = p.id)
           END AS cnt
    FROM chat_profiles p
    ORDER BY p.is_default DESC, p.is_builtin DESC, p.name ASC`;
  const byProfile = (profRows as Array<Record<string, unknown>>).map((x) => ({
    profileId: Number(x.profile_id),
    name: x.name as string,
    emoji: (x.emoji as string) ?? null,
    isDefault: Boolean(x.is_default),
    count: Number(x.cnt),
  }));

  return {
    total: Number(r.total ?? 0),
    byMode: {
      off: Number(r.m_off ?? 0),
      secretary: Number(r.m_secretary ?? 0),
      auto_reply: Number(r.m_auto_reply ?? 0),
      friendly_reply: Number(r.m_friendly_reply ?? 0),
      ai_chat: Number(r.m_ai_chat ?? 0),
      ai_listen: Number(r.m_ai_listen ?? 0),
    },
    byChatType: {
      private: Number(r.t_private ?? 0),
      bot: Number(r.t_bot ?? 0),
      group: Number(r.t_group ?? 0),
      channel: Number(r.t_channel ?? 0),
    },
    byRelationship,
    byFunctionRole,
    byProfile,
    flags: {
      vip: Number(r.f_vip ?? 0),
      muted: Number(r.f_muted ?? 0),
      isBot: Number(r.f_bot ?? 0),
      hasProfile: Number(r.f_profile ?? 0),
      hasPhone: Number(r.f_phone ?? 0),
      autoSummarizeOn: Number(r.f_autosum ?? 0),
      followUpOn: Number(r.f_followup ?? 0),
      followUpTranscribeOn: Number(r.f_transcribe ?? 0),
      autoForwardVoiceOn: Number(r.f_fwd_voice ?? 0),
      autoForwardVideoOn: Number(r.f_fwd_video ?? 0),
      autoForwardPhotoOn: Number(r.f_fwd_photo ?? 0),
      autoExtractNotesOn: Number(r.f_extract ?? 0),
    },
  };
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

export function rowToSecretarySession(r: Record<string, unknown>): SecretarySession {
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
  // Return the most recent active session for this secretary. When several
  // are open simultaneously we assume the secretary means the one they
  // touched last — they can always tap "reply" on a specific thread to be
  // explicit.
  const rows = await sql()`
    SELECT * FROM secretary_sessions
    WHERE secretary_user_id = ${secretaryUserId}
      AND ended_at IS NULL
      AND last_activity_at > NOW() - make_interval(mins => ${idleMinutes})
    ORDER BY last_activity_at DESC LIMIT 1`;
  if (rows.length === 0) return null;
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

export type AuditRow = {
  id: number;
  createdAt: Date;
  actorId: number | null;
  actorName: string | null;
  action: string;
  target: string | null;
  details: unknown;
};

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT id, created_at, actor_id, actor_name, action, target, details
    FROM audit_log ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`;
  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: r.created_at as Date,
    actorId: r.actor_id != null ? Number(r.actor_id) : null,
    actorName: (r.actor_name as string) ?? null,
    action: r.action as string,
    target: (r.target as string) ?? null,
    details: r.details ?? null,
  }));
}
