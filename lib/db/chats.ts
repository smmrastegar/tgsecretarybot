// Split out of the former single lib/db.ts. Import from "@/lib/db" —
// that barrel re-exports every module here.
import { bool, date, dateOrNull, num, numOrNull, str, strOrNull, type Row } from "./row";
import { config } from "../config";
import { ensureSchema, hasDb, sql } from "./core";
import { lastOwnerMessageAt } from "./topics";

// --- Chat rules ---

export type ChatMode =
  | "off"
  | "secretary"
  | "auto_reply"
  | "friendly_reply"
  | "ai_chat"
  | "ai_listen";

export const CHAT_MODES: ChatMode[] = [
  "off",
  "secretary",
  "auto_reply",
  "friendly_reply",
  "ai_chat",
  "ai_listen",
];

export const RELATIONSHIPS = [
  "close_family",
  "family",
  "close_friend",
  "friend",
  "work_acquaintance",
  "employer",
  "formal",
  "suspicious",
  "stranger",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

// Role / function a chat plays in the owner's workflow. Most chats are
// just conversations (null), but some are tools or feeds whose
// behaviour the bot should adapt to.
export const FUNCTION_ROLES = [
  "downloader",
  "sms_inbox",
  "download_archive",
  "news",
  "summary_inbox",
  "storage",
  "voice_storage",
  "video_note_storage",
  "video_storage",
  "photo_storage",
  "notes_inbox",
  "email_inbox",
] as const;
export type FunctionRole = (typeof FUNCTION_ROLES)[number];

export const FUNCTION_ROLE_LABELS: Record<FunctionRole, string> = {
  downloader:
    "Downloader bot (Instagram / YouTube / Twitter / SoundCloud / Spotify)",
  sms_inbox: "SMS inbox (forwarded phone messages)",
  download_archive: "Download archive (saved Instagram / etc. media)",
  news: "News source (channel or group with important news)",
  summary_inbox:
    "Summary inbox (channel/group that receives auto-summaries from ai_listen chats)",
  storage:
    "Storage (channel that receives Instagram stories / posts / reels via HikerAPI)",
  voice_storage:
    "Voice storage (auto-forwarded voice messages). Inline 📝 button transcribes in-place.",
  video_note_storage:
    "Video-note storage (round video bubbles). Inline 📝 button transcribes in-place. Falls back to voice_storage if not set.",
  video_storage:
    "Video storage (auto-forwarded regular videos from chats with auto_forward_video)",
  photo_storage:
    "Photo storage (auto-forwarded photos from chats with auto_forward_photo)",
  notes_inbox:
    "Notes inbox (auto-extracted addresses, locations, contacts and key points from chats with auto_extract_notes)",
  email_inbox:
    "Email inbox (incoming Resend emails are posted here with Preview/Summary/Text/HTML buttons)",
};

export type ChatRule = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode: ChatMode;
  modeChangedAt: Date;
  secretaryUserId: number | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  relationship: Relationship | null;
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  toneProfile: string | null;
  toneProfileAt: Date | null;
  floodCooldownUntil: Date | null;
  floodDeflectedAt: Date | null;
  aiProcessVoice: boolean;
  aiProcessStickers: boolean;
  aiProcessGifs: boolean;
  aiProcessPhotos: boolean;
  aiProcessVideoNotes: boolean;
  aiGeneratePhoto: boolean;
  functionRole: FunctionRole | null;
  functionConfig: Record<string, unknown> | null;
  autoSummarizeEnabled: boolean;
  autoSummarizeGapMinutes: number;
  autoSummarizeSmartTiming: boolean;
  lastAutoSummaryAt: Date | null;
  autoForwardVoice: boolean;
  autoForwardVideo: boolean;
  autoForwardPhoto: boolean;
  autoForwardLocation: boolean;
  autoExtractNotes: boolean;
  selfVoiceTranscript: boolean;
  isBot: boolean;
  ignored: boolean;
  phoneNumber: string | null;
  graceSkippedAt: Date | null;
  // Per-chat cadence for the daily-summary cron. NULL = use the cron
  // default (24h). When set, the cron also tracks lastSummaryRunAt so
  // it can skip chats that aren't due yet.
  summaryIntervalHours: number | null;
  lastSummaryRunAt: Date | null;
  // Public read-only token for the /share/groups/<token> analytics
  // page. Operator generates/revokes via the Share button on
  // /groups/<chatId>.
  analyticsShareToken: string | null;
  // Follow-up reminder fields — set per-chat, defaulted by the
  // schema (enabled=TRUE, threshold=2h, escalate=12h).
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  followUpLastPingAt: Date | null;
  followUpLastPingKind: string | null;
  followUpAckedAt: Date | null;
  profileId: number | null;
  updatedAt: Date;
};

export function rowToChatRule(r: Row): ChatRule {
  const mode = str(r, "mode") || "off";
  const rel = strOrNull(r, "relationship");
  const fnRole = strOrNull(r, "function_role");
  return {
    chatId: num(r, "chat_id"),
    chatType: str(r, "chat_type"),
    chatTitle: strOrNull(r, "chat_title"),
    vip: bool(r, "vip"),
    muted: bool(r, "muted"),
    customReply: strOrNull(r, "custom_reply"),
    notes: strOrNull(r, "notes"),
    mode: (CHAT_MODES.includes(mode as ChatMode) ? mode : "off") as ChatMode,
    modeChangedAt:
      dateOrNull(r, "mode_changed_at") ?? dateOrNull(r, "updated_at") ?? new Date(),
    secretaryUserId: numOrNull(r, "secretary_user_id"),
    firstName: strOrNull(r, "first_name"),
    lastName: strOrNull(r, "last_name"),
    nickname: strOrNull(r, "nickname"),
    relationship:
      rel && (RELATIONSHIPS as readonly string[]).includes(rel)
        ? (rel as Relationship)
        : null,
    relationshipNotes: strOrNull(r, "relationship_notes"),
    talkStyleNotes: strOrNull(r, "talk_style_notes"),
    toneProfile: strOrNull(r, "tone_profile"),
    toneProfileAt: dateOrNull(r, "tone_profile_at"),
    floodCooldownUntil: dateOrNull(r, "flood_cooldown_until"),
    floodDeflectedAt: dateOrNull(r, "flood_deflected_at"),
    aiProcessVoice: bool(r, "ai_process_voice"),
    aiProcessStickers: bool(r, "ai_process_stickers"),
    aiProcessGifs: bool(r, "ai_process_gifs"),
    aiProcessPhotos: bool(r, "ai_process_photos"),
    aiProcessVideoNotes: bool(r, "ai_process_video_notes"),
    aiGeneratePhoto: bool(r, "ai_generate_photo"),
    functionRole:
      fnRole && (FUNCTION_ROLES as readonly string[]).includes(fnRole)
        ? (fnRole as FunctionRole)
        : null,
    functionConfig:
      r.function_config && typeof r.function_config === "object"
        ? (r.function_config as Record<string, unknown>)
        : null,
    autoSummarizeEnabled: bool(r, "auto_summarize_enabled"),
    autoSummarizeGapMinutes:
      num(r, "auto_summarize_gap_minutes") > 0 ? num(r, "auto_summarize_gap_minutes") : 5,
    // NULL means "not set"; the historical default is on.
    autoSummarizeSmartTiming: bool(r, "auto_summarize_smart_timing", true),
    lastAutoSummaryAt: dateOrNull(r, "last_auto_summary_at"),
    autoForwardVoice: bool(r, "auto_forward_voice"),
    autoForwardVideo: bool(r, "auto_forward_video"),
    autoForwardPhoto: bool(r, "auto_forward_photo"),
    autoForwardLocation: bool(r, "auto_forward_location"),
    autoExtractNotes: bool(r, "auto_extract_notes"),
    selfVoiceTranscript: bool(r, "self_voice_transcript"),
    isBot: bool(r, "is_bot"),
    ignored: bool(r, "ignored"),
    phoneNumber: strOrNull(r, "phone_number"),
    graceSkippedAt: dateOrNull(r, "grace_skipped_at"),
    summaryIntervalHours: numOrNull(r, "summary_interval_hours"),
    lastSummaryRunAt: dateOrNull(r, "last_summary_run_at"),
    analyticsShareToken: strOrNull(r, "analytics_share_token"),
    followUpEnabled: bool(r, "follow_up_enabled", true),
    followUpThresholdHours: num(r, "follow_up_threshold_hours", 2),
    followUpEscalateHours: num(r, "follow_up_escalate_hours", 12),
    followUpLastPingAt: dateOrNull(r, "follow_up_last_ping_at"),
    followUpLastPingKind: strOrNull(r, "follow_up_last_ping_kind"),
    followUpAckedAt: dateOrNull(r, "follow_up_acked_at"),
    profileId: numOrNull(r, "profile_id"),
    updatedAt: date(r, "updated_at"),
  };
}

export async function getChatRule(chatId: number): Promise<ChatRule | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id, chat_type, chat_title, vip, muted, custom_reply, notes,
           mode, mode_changed_at, secretary_user_id,
           first_name, last_name, nickname, relationship,
           relationship_notes, talk_style_notes,
           tone_profile, tone_profile_at,
           flood_cooldown_until, flood_deflected_at,
           ai_process_voice, ai_process_stickers, ai_process_gifs, ai_process_photos,
           ai_process_video_notes, ai_generate_photo,
           function_role, function_config,
           auto_summarize_enabled, auto_summarize_gap_minutes,
           auto_summarize_smart_timing,
           last_auto_summary_at,
           auto_forward_voice, auto_forward_video, auto_forward_photo,
           auto_forward_location, auto_extract_notes,
           self_voice_transcript,
           is_bot, ignored, phone_number,
           grace_skipped_at,
           summary_interval_hours, last_summary_run_at, analytics_share_token,
           follow_up_enabled, follow_up_threshold_hours, follow_up_escalate_hours,
           follow_up_last_ping_at, follow_up_last_ping_kind, follow_up_acked_at,
           profile_id, updated_at
    FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToChatRule(r) : null;
}

export async function upsertChatRule(rule: {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode?: ChatMode;
  secretaryUserId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  relationship?: Relationship | null;
  relationshipNotes?: string | null;
  talkStyleNotes?: string | null;
  aiProcessVoice?: boolean;
  aiProcessStickers?: boolean;
  aiProcessGifs?: boolean;
  aiProcessPhotos?: boolean;
  aiProcessVideoNotes?: boolean;
  aiGeneratePhoto?: boolean;
  functionRole?: FunctionRole | null;
  functionConfig?: Record<string, unknown> | null;
}): Promise<void> {
  await ensureSchema();
  const mode = rule.mode ?? "off";
  const secretaryUserId = rule.secretaryUserId ?? null;
  const firstName = rule.firstName ?? null;
  const lastName = rule.lastName ?? null;
  const nickname = rule.nickname ?? null;
  const relationship =
    rule.relationship &&
    (RELATIONSHIPS as readonly string[]).includes(rule.relationship)
      ? rule.relationship
      : null;
  const relationshipNotes = rule.relationshipNotes ?? null;
  const talkStyleNotes = rule.talkStyleNotes ?? null;
  const aiProcessVoice = rule.aiProcessVoice ?? false;
  const aiProcessStickers = rule.aiProcessStickers ?? false;
  const aiProcessGifs = rule.aiProcessGifs ?? false;
  const aiProcessPhotos = rule.aiProcessPhotos ?? false;
  const aiProcessVideoNotes = rule.aiProcessVideoNotes ?? false;
  const aiGeneratePhoto = rule.aiGeneratePhoto ?? false;
  const functionRole =
    rule.functionRole &&
    (FUNCTION_ROLES as readonly string[]).includes(rule.functionRole)
      ? rule.functionRole
      : null;
  const functionConfigJson =
    rule.functionConfig === undefined
      ? undefined
      : rule.functionConfig === null
        ? null
        : JSON.stringify(rule.functionConfig);
  await sql()`
    INSERT INTO chat_rules (
      chat_id, chat_type, chat_title, vip, muted, custom_reply, notes,
      mode, mode_changed_at, secretary_user_id,
      first_name, last_name, nickname, relationship,
      relationship_notes, talk_style_notes,
      ai_process_voice, ai_process_stickers, ai_process_gifs, ai_process_photos,
      ai_process_video_notes, ai_generate_photo,
      function_role, function_config, updated_at
    )
    VALUES (
      ${rule.chatId}, ${rule.chatType}, ${rule.chatTitle}, ${rule.vip}, ${rule.muted},
      ${rule.customReply}, ${rule.notes}, ${mode}, NOW(), ${secretaryUserId},
      ${firstName}, ${lastName}, ${nickname}, ${relationship},
      ${relationshipNotes}, ${talkStyleNotes},
      ${aiProcessVoice}, ${aiProcessStickers}, ${aiProcessGifs}, ${aiProcessPhotos},
      ${aiProcessVideoNotes}, ${aiGeneratePhoto},
      ${functionRole}, ${functionConfigJson}::jsonb, NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      -- chat_type is authoritative from messages_log (written on every
      -- msg ingest). Don't let an API edit clobber it with a stale or
      -- guessed value — only adopt EXCLUDED.chat_type when the existing
      -- row has none (shouldn't happen since the column is NOT NULL,
      -- but kept defensive).
      chat_type = COALESCE(chat_rules.chat_type, EXCLUDED.chat_type),
      chat_title = COALESCE(EXCLUDED.chat_title, chat_rules.chat_title),
      vip = EXCLUDED.vip,
      muted = EXCLUDED.muted,
      custom_reply = EXCLUDED.custom_reply,
      notes = EXCLUDED.notes,
      mode = EXCLUDED.mode,
      mode_changed_at = CASE WHEN chat_rules.mode IS DISTINCT FROM EXCLUDED.mode
                              THEN NOW() ELSE chat_rules.mode_changed_at END,
      secretary_user_id = EXCLUDED.secretary_user_id,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      nickname = EXCLUDED.nickname,
      relationship = EXCLUDED.relationship,
      relationship_notes = EXCLUDED.relationship_notes,
      talk_style_notes = EXCLUDED.talk_style_notes,
      ai_process_voice = EXCLUDED.ai_process_voice,
      ai_process_stickers = EXCLUDED.ai_process_stickers,
      ai_process_gifs = EXCLUDED.ai_process_gifs,
      ai_process_photos = EXCLUDED.ai_process_photos,
      ai_process_video_notes = EXCLUDED.ai_process_video_notes,
      ai_generate_photo = EXCLUDED.ai_generate_photo,
      function_role = COALESCE(EXCLUDED.function_role, chat_rules.function_role),
      function_config = COALESCE(EXCLUDED.function_config, chat_rules.function_config),
      updated_at = NOW()`;
}

// Manual override of the auto-detected is_bot flag (auto-detection
// flags chats whose senders have usernames ending in "bot", which
// covers most cases but the owner needs the escape hatch). Separate
// helper because upsertChatRule's `undefined` couldn't distinguish
// "don't touch" from "set to false".
export async function setChatIsBot(
  chatId: number,
  isBot: boolean,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, is_bot, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${isBot},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      is_bot = ${isBot},
      updated_at = NOW()`;
}

export async function setChatFunction(
  chatId: number,
  role: FunctionRole | null,
  config: Record<string, unknown> | null,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const normalisedRole =
    role && (FUNCTION_ROLES as readonly string[]).includes(role) ? role : null;
  const configJson = config ? JSON.stringify(config) : null;
  // Fresh channels/groups may not have a chat_rules row yet, so a
  // plain UPDATE would silently noop and the role would never stick.
  // Derive chat_type/title from messages_log if any rows exist, else
  // guess from the chat_id sign (positive = private, negative = group/
  // channel). Telegram channel/supergroup IDs are < 0 so this is reliable.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, function_role, function_config, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${normalisedRole},
      ${configJson}::jsonb,
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      function_role = ${normalisedRole},
      function_config = ${configJson}::jsonb,
      updated_at = NOW()`;
}

// Bulk versions for the chats list page. Each is INSERT-from-
// messages_log ON CONFLICT so chats that don't yet have a chat_rules
// row (never edited) still get one. chat_type is required by the
// schema so we pull it from messages_log.
export async function bulkSetChatMode(
  chatIds: number[],
  mode: ChatMode,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, mode, mode_changed_at, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title), ${mode}, NOW(), NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      mode = EXCLUDED.mode,
      mode_changed_at = NOW(),
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

export async function bulkSetChatFlag(
  chatIds: number[],
  flag: "vip" | "muted",
  value: boolean,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  // VIP and muted are mutually exclusive in our UI — turning one ON
  // turns the other OFF.
  if (flag === "vip") {
    const rows = await sql()`
      INSERT INTO chat_rules (chat_id, chat_type, chat_title, vip, muted, updated_at)
      SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title), ${value},
             CASE WHEN ${value} THEN FALSE ELSE FALSE END, NOW()
      FROM messages_log m
      WHERE m.chat_id = ANY(${chatIds}::bigint[])
      GROUP BY m.chat_id
      ON CONFLICT (chat_id) DO UPDATE SET
        vip = EXCLUDED.vip,
        muted = CASE WHEN ${value} THEN FALSE ELSE chat_rules.muted END,
        updated_at = NOW()
      RETURNING chat_id`;
    return rows.length;
  }
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, vip, muted, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title),
           CASE WHEN ${value} THEN FALSE ELSE FALSE END, ${value}, NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      muted = EXCLUDED.muted,
      vip = CASE WHEN ${value} THEN FALSE ELSE chat_rules.vip END,
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

export async function bulkSetChatFunction(
  chatIds: number[],
  role: FunctionRole | null,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const normalisedRole =
    role && (FUNCTION_ROLES as readonly string[]).includes(role) ? role : null;
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title, function_role, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title), ${normalisedRole}, NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      function_role = EXCLUDED.function_role,
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

export async function bulkSetAutoSummarize(
  chatIds: number[],
  enabled: boolean,
  gapMinutes: number,
  smartTiming: boolean = true,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const gap = Math.max(1, Math.min(Math.round(gapMinutes), 240));
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title,
                            auto_summarize_enabled, auto_summarize_gap_minutes,
                            auto_summarize_smart_timing,
                            updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title),
           ${enabled}, ${gap}, ${smartTiming}, NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_summarize_enabled = ${enabled},
      auto_summarize_gap_minutes = ${gap},
      auto_summarize_smart_timing = ${smartTiming},
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

// Toggle auto-summary for a chat (typically called when the owner
// flips the checkbox in /chats/[id]). Stays separate from upsertChatRule
// so the JSON of an unrelated edit doesn't accidentally reset it.
export async function setAutoSummarize(
  chatId: number,
  enabled: boolean,
  gapMinutes: number,
  smartTiming: boolean = true,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const gap = Math.max(1, Math.min(Math.round(gapMinutes), 240));
  // Same trick as setChatFunction: bootstrap a chat_rules row from
  // messages_log (or default to "private") so a plain UPDATE doesn't
  // noop when no row exists yet.
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title,
                            auto_summarize_enabled, auto_summarize_gap_minutes,
                            auto_summarize_smart_timing, updated_at)
    VALUES (
      ${chatId},
      COALESCE(
        (SELECT MAX(chat_type) FROM messages_log WHERE chat_id = ${chatId}),
        CASE WHEN ${chatId}::bigint < 0 THEN 'supergroup' ELSE 'private' END
      ),
      (SELECT MAX(chat_title) FROM messages_log WHERE chat_id = ${chatId}),
      ${enabled},
      ${gap},
      ${smartTiming},
      NOW()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_summarize_enabled = ${enabled},
      auto_summarize_gap_minutes = ${gap},
      auto_summarize_smart_timing = ${smartTiming},
      updated_at = NOW()`;
}

export type ChatAutomationPatch = {
  autoForwardVoice?: boolean;
  autoForwardVideo?: boolean;
  autoForwardPhoto?: boolean;
  autoForwardLocation?: boolean;
  autoExtractNotes?: boolean;
  selfVoiceTranscript?: boolean;
};

export async function setChatAutomation(
  chatId: number,
  patch: ChatAutomationPatch,
): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Don't default chat_type to 'private' — Telegram channels and
  // supergroups have negative IDs and DEFINITELY aren't DMs. Look up
  // the real type from the first messages_log row for this chat; if
  // we can't find one (no history yet), guess from the id (negative
  // = supergroup, positive = private).
  const guessed = chatId < 0 ? "supergroup" : "private";
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type,
      auto_forward_voice, auto_forward_video, auto_forward_photo,
      auto_forward_location, auto_extract_notes, self_voice_transcript, updated_at)
    VALUES (${chatId},
      COALESCE(
        (SELECT chat_type FROM messages_log WHERE chat_id = ${chatId} LIMIT 1),
        ${guessed}
      ),
      ${patch.autoForwardVoice ?? false},
      ${patch.autoForwardVideo ?? false},
      ${patch.autoForwardPhoto ?? false},
      ${patch.autoForwardLocation ?? false},
      ${patch.autoExtractNotes ?? false},
      ${patch.selfVoiceTranscript ?? false},
      NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_forward_voice = COALESCE(${patch.autoForwardVoice ?? null}::boolean, chat_rules.auto_forward_voice),
      auto_forward_video = COALESCE(${patch.autoForwardVideo ?? null}::boolean, chat_rules.auto_forward_video),
      auto_forward_photo = COALESCE(${patch.autoForwardPhoto ?? null}::boolean, chat_rules.auto_forward_photo),
      auto_forward_location = COALESCE(${patch.autoForwardLocation ?? null}::boolean, chat_rules.auto_forward_location),
      auto_extract_notes = COALESCE(${patch.autoExtractNotes ?? null}::boolean, chat_rules.auto_extract_notes),
      self_voice_transcript = COALESCE(${patch.selfVoiceTranscript ?? null}::boolean, chat_rules.self_voice_transcript),
      updated_at = NOW()`;
}

export async function bulkSetChatAutomation(
  chatIds: number[],
  patch: ChatAutomationPatch,
): Promise<number> {
  if (!hasDb() || chatIds.length === 0) return 0;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, chat_title,
      auto_forward_voice, auto_forward_video, auto_forward_photo,
      auto_forward_location, auto_extract_notes, self_voice_transcript, updated_at)
    SELECT m.chat_id, MAX(m.chat_type), MAX(m.chat_title),
           ${patch.autoForwardVoice ?? false},
           ${patch.autoForwardVideo ?? false},
           ${patch.autoForwardPhoto ?? false},
           ${patch.autoForwardLocation ?? false},
           ${patch.autoExtractNotes ?? false},
           ${patch.selfVoiceTranscript ?? false},
           NOW()
    FROM messages_log m
    WHERE m.chat_id = ANY(${chatIds}::bigint[])
    GROUP BY m.chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
      auto_forward_voice = COALESCE(${patch.autoForwardVoice ?? null}::boolean, chat_rules.auto_forward_voice),
      auto_forward_video = COALESCE(${patch.autoForwardVideo ?? null}::boolean, chat_rules.auto_forward_video),
      auto_forward_photo = COALESCE(${patch.autoForwardPhoto ?? null}::boolean, chat_rules.auto_forward_photo),
      auto_forward_location = COALESCE(${patch.autoForwardLocation ?? null}::boolean, chat_rules.auto_forward_location),
      auto_extract_notes = COALESCE(${patch.autoExtractNotes ?? null}::boolean, chat_rules.auto_extract_notes),
      self_voice_transcript = COALESCE(${patch.selfVoiceTranscript ?? null}::boolean, chat_rules.self_voice_transcript),
      updated_at = NOW()
    RETURNING chat_id`;
  return rows.length;
}

// --- Chat notes ---

export type ChatNote = {
  id: number;
  chatId: number;
  tenantId: number | null;
  sourceMessageId: number | null;
  kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  senderName: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

function rowToChatNote(r: Record<string, unknown>): ChatNote {
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    sourceMessageId:
      r.source_message_id == null ? null : Number(r.source_message_id),
    kind: r.kind as string,
    title: (r.title as string) ?? null,
    content: r.content as string,
    metadata:
      r.metadata && typeof r.metadata === "object"
        ? (r.metadata as Record<string, unknown>)
        : null,
    senderName: (r.sender_name as string) ?? null,
    archivedAt: (r.archived_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

// Has this exact note already been recorded for this chat? Re-running a
// group analysis produces the same critical items again, and without
// this every re-run appended another copy — 79 rows for 52 distinct
// titles by the time anyone noticed.
export async function chatNoteExists(args: {
  chatId: number;
  kind: string;
  title: string;
}): Promise<boolean> {
  if (!hasDb()) return false;
  await ensureSchema();
  const rows = await sql()`
    SELECT 1 FROM chat_notes
    WHERE chat_id = ${args.chatId}
      AND kind = ${args.kind}
      AND title = ${args.title}
    LIMIT 1`;
  return rows.length > 0;
}

export async function addChatNote(args: {
  chatId: number;
  tenantId?: number | null;
  sourceMessageId?: number | null;
  kind: string;
  title?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
  senderName?: string | null;
}): Promise<ChatNote | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_notes (chat_id, tenant_id, source_message_id, kind, title, content, metadata, sender_name)
    VALUES (${args.chatId}, ${args.tenantId ?? null},
            ${args.sourceMessageId ?? null}, ${args.kind},
            ${args.title ?? null}, ${args.content},
            ${args.metadata ? JSON.stringify(args.metadata) : null}::jsonb,
            ${args.senderName ?? null})
    RETURNING id, chat_id, tenant_id, source_message_id, kind, title, content,
              metadata, sender_name, archived_at, created_at`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToChatNote(r) : null;
}

export async function listChatNotes(opts: {
  chatId?: number;
  tenantId?: number | null;
  kind?: string;
  q?: string;
  sinceDays?: number;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ChatNote[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const like = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const sinceDays = opts.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : null;
  const rows = await sql()`
    SELECT id, chat_id, tenant_id, source_message_id, kind, title, content,
           metadata, sender_name, archived_at, created_at
    FROM chat_notes
    WHERE (${opts.chatId ?? null}::bigint IS NULL OR chat_id = ${opts.chatId ?? null})
      AND (${opts.tenantId ?? null}::bigint IS NULL OR tenant_id = ${opts.tenantId ?? null})
      AND (${opts.kind ?? null}::text IS NULL OR kind = ${opts.kind ?? null})
      AND (${opts.includeArchived ?? false}::boolean OR archived_at IS NULL)
      AND (${sinceDays}::int IS NULL OR created_at > NOW() - make_interval(days => ${sinceDays}))
      AND (
        ${like}::text IS NULL
        OR content ILIKE ${like}
        OR COALESCE(title, '') ILIKE ${like}
        OR COALESCE(sender_name, '') ILIKE ${like}
      )
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 200}
    OFFSET ${opts.offset ?? 0}`;
  return (rows as Array<Record<string, unknown>>).map(rowToChatNote);
}

// Distinct list of (kind, count) across the WHOLE table — used by
// the /notes filter chips so we don't recompute from the per-chat
// summary every render.
export async function chatNoteKindCounts(
  tenantId?: number | null,
): Promise<Array<{ kind: string; count: number }>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT kind, COUNT(*)::int AS cnt
    FROM chat_notes
    WHERE archived_at IS NULL
      AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
    GROUP BY kind
    ORDER BY cnt DESC`;
  return (rows as Array<{ kind: string; cnt: number }>).map((r) => ({
    kind: r.kind,
    count: Number(r.cnt),
  }));
}

// Per-chat aggregate counts — used by the /notes index ("X notes from
// chat Y, mostly addresses"). Returns one row per chat with totals.
export async function chatNoteSummaryByChat(
  tenantId?: number | null,
): Promise<Array<{
  chatId: number;
  total: number;
  byKind: Record<string, number>;
  lastNoteAt: Date;
}>> {
  if (!hasDb()) return [];
  await ensureSchema();
  const rows = await sql()`
    SELECT chat_id,
           COUNT(*)::int AS total,
           MAX(created_at) AS last_note_at,
           jsonb_object_agg(kind, kind_count) AS by_kind
    FROM (
      SELECT chat_id, kind, COUNT(*)::int AS kind_count, MAX(created_at) AS created_at
      FROM chat_notes
      WHERE archived_at IS NULL
        AND (${tenantId ?? null}::bigint IS NULL OR tenant_id = ${tenantId ?? null})
      GROUP BY chat_id, kind
    ) g
    GROUP BY chat_id
    ORDER BY last_note_at DESC`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    chatId: Number(r.chat_id),
    total: Number(r.total),
    byKind:
      r.by_kind && typeof r.by_kind === "object"
        ? (Object.fromEntries(
            Object.entries(r.by_kind as Record<string, unknown>).map(
              ([k, v]) => [k, Number(v)],
            ),
          ) as Record<string, number>)
        : {},
    lastNoteAt: r.last_note_at as Date,
  }));
}

export async function deleteChatNote(id: number): Promise<boolean> {
  if (!hasDb()) return false;
  const rows = await sql()`DELETE FROM chat_notes WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function archiveChatNote(
  id: number,
  archived: boolean,
): Promise<void> {
  if (!hasDb()) return;
  await sql()`
    UPDATE chat_notes
    SET archived_at = CASE WHEN ${archived}::boolean THEN NOW() ELSE NULL END
    WHERE id = ${id}`;
}

// --- Follow-up reminders ---

// Set per-chat follow-up settings. Each field is independently
// patchable so the UI can toggle enabled, set threshold, or mark
// the operator's acknowledgement without overwriting siblings.
export async function setChatFollowUp(args: {
  chatId: number;
  enabled?: boolean;
  thresholdHours?: number | null;
  escalateHours?: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (
      chat_id, chat_type, follow_up_enabled, follow_up_threshold_hours,
      follow_up_escalate_hours
    )
    VALUES (
      ${args.chatId}, 'private',
      ${args.enabled ?? true},
      ${args.thresholdHours ?? 2},
      ${args.escalateHours ?? 12}
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      follow_up_enabled = COALESCE(${args.enabled ?? null}::boolean,
                                   chat_rules.follow_up_enabled),
      follow_up_threshold_hours = COALESCE(${args.thresholdHours ?? null}::numeric,
                                           chat_rules.follow_up_threshold_hours),
      follow_up_escalate_hours = COALESCE(${args.escalateHours ?? null}::numeric,
                                          chat_rules.follow_up_escalate_hours),
      updated_at = NOW()`;
}

// Mark this chat as "I'm aware" — bot stops sending more follow-up
// pings until the customer messages again. Stamped by the "متوجه
// شدم" button under each follow-up notice in notes_inbox.
// --- Chat profiles ---

export type ChatProfile = {
  id: number;
  slug: string;
  name: string;
  emoji: string | null;
  description: string | null;
  isDefault: boolean;
  isBuiltin: boolean;
  // Follow-up
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  followUpTranscribeVoices: boolean;
  // General chat behaviour (null = profile doesn't override; chat
  // keeps its own per-chat value).
  mode: string | null;
  vip: boolean | null;
  muted: boolean | null;
  // Auto-summarize (group digests)
  autoSummarizeEnabled: boolean | null;
  autoSummarizeGapMinutes: number | null;
  autoSummarizeSmartTiming: boolean | null;
  // Auto-forward media to storage
  autoForwardVoice: boolean | null;
  autoForwardVideo: boolean | null;
  autoForwardPhoto: boolean | null;
  autoForwardLocation: boolean | null;
  autoExtractNotes: boolean | null;
  // AI process media flags
  aiProcessVoice: boolean | null;
  aiProcessStickers: boolean | null;
  aiProcessGifs: boolean | null;
  aiProcessPhotos: boolean | null;
  aiProcessVideoNotes: boolean | null;
  tenantId: number | null;
  chatCount: number;
};

function nullableBool(v: unknown): boolean | null {
  return v == null ? null : Boolean(v);
}
function nullableNum(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function nullableStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

function rowToProfile(r: Record<string, unknown>): ChatProfile {
  return {
    id: Number(r.id),
    slug: r.slug as string,
    name: r.name as string,
    emoji: (r.emoji as string) ?? null,
    description: (r.description as string) ?? null,
    isDefault: Boolean(r.is_default),
    isBuiltin: Boolean(r.is_builtin),
    followUpEnabled: Boolean(r.follow_up_enabled),
    followUpThresholdHours: Number(r.follow_up_threshold_hours),
    followUpEscalateHours: Number(r.follow_up_escalate_hours),
    followUpTranscribeVoices: Boolean(r.follow_up_transcribe_voices),
    mode: nullableStr(r.mode),
    vip: nullableBool(r.vip),
    muted: nullableBool(r.muted),
    autoSummarizeEnabled: nullableBool(r.auto_summarize_enabled),
    autoSummarizeGapMinutes: nullableNum(r.auto_summarize_gap_minutes),
    autoSummarizeSmartTiming: nullableBool(r.auto_summarize_smart_timing),
    autoForwardVoice: nullableBool(r.auto_forward_voice),
    autoForwardVideo: nullableBool(r.auto_forward_video),
    autoForwardPhoto: nullableBool(r.auto_forward_photo),
    autoForwardLocation: nullableBool(r.auto_forward_location),
    autoExtractNotes: nullableBool(r.auto_extract_notes),
    aiProcessVoice: nullableBool(r.ai_process_voice),
    aiProcessStickers: nullableBool(r.ai_process_stickers),
    aiProcessGifs: nullableBool(r.ai_process_gifs),
    aiProcessPhotos: nullableBool(r.ai_process_photos),
    aiProcessVideoNotes: nullableBool(r.ai_process_video_notes),
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    chatCount: Number(r.chat_count ?? 0),
  };
}

export async function listChatProfiles(args?: {
  tenantId?: number | null;
}): Promise<ChatProfile[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    SELECT p.*,
           CASE
             WHEN p.is_default THEN
               (SELECT COUNT(*)::int FROM chat_rules cr
                 WHERE cr.profile_id = p.id OR cr.profile_id IS NULL)
             ELSE
               (SELECT COUNT(*)::int FROM chat_rules cr
                 WHERE cr.profile_id = p.id)
           END AS chat_count
    FROM chat_profiles p
    WHERE (${tenantId}::bigint IS NULL OR p.tenant_id = ${tenantId})
    ORDER BY p.is_default DESC, p.is_builtin DESC, p.name ASC`;
  return (rows as Array<Record<string, unknown>>).map(rowToProfile);
}

export async function getChatProfile(
  id: number,
): Promise<ChatProfile | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT *,
           CASE
             WHEN is_default THEN
               (SELECT COUNT(*)::int FROM chat_rules cr
                 WHERE cr.profile_id = ${id} OR cr.profile_id IS NULL)
             ELSE
               (SELECT COUNT(*)::int FROM chat_rules cr
                 WHERE cr.profile_id = ${id})
           END AS chat_count
    FROM chat_profiles WHERE id = ${id} LIMIT 1`;
  const r = rows[0] as Record<string, unknown> | undefined;
  return r ? rowToProfile(r) : null;
}

export async function createChatProfile(args: {
  slug: string;
  name: string;
  emoji: string | null;
  description: string | null;
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  followUpTranscribeVoices: boolean;
  tenantId: number | null;
}): Promise<ChatProfile> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO chat_profiles (
      slug, name, emoji, description, is_default, is_builtin,
      follow_up_enabled, follow_up_threshold_hours,
      follow_up_escalate_hours, follow_up_transcribe_voices, tenant_id
    ) VALUES (
      ${args.slug}, ${args.name}, ${args.emoji}, ${args.description},
      FALSE, FALSE, ${args.followUpEnabled},
      ${args.followUpThresholdHours}, ${args.followUpEscalateHours},
      ${args.followUpTranscribeVoices}, ${args.tenantId}
    )
    RETURNING *`;
  return rowToProfile(rows[0] as Record<string, unknown>);
}

export type ChatProfilePatch = {
  name?: string;
  emoji?: string | null;
  description?: string | null;
  followUpEnabled?: boolean;
  followUpThresholdHours?: number;
  followUpEscalateHours?: number;
  followUpTranscribeVoices?: boolean;
  mode?: string | null;
  vip?: boolean | null;
  muted?: boolean | null;
  autoSummarizeEnabled?: boolean | null;
  autoSummarizeGapMinutes?: number | null;
  autoSummarizeSmartTiming?: boolean | null;
  autoForwardVoice?: boolean | null;
  autoForwardVideo?: boolean | null;
  autoForwardPhoto?: boolean | null;
  autoForwardLocation?: boolean | null;
  autoExtractNotes?: boolean | null;
  aiProcessVoice?: boolean | null;
  aiProcessStickers?: boolean | null;
  aiProcessGifs?: boolean | null;
  aiProcessPhotos?: boolean | null;
  aiProcessVideoNotes?: boolean | null;
};

export async function updateChatProfile(args: {
  id: number;
} & ChatProfilePatch): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Sentinel pattern: undefined → keep existing; null → store NULL
  // (= "this profile doesn't override this setting"). Booleans /
  // numbers / strings get stored as-is.
  const u = (v: unknown, key: "set" | "skip") =>
    v === undefined ? "skip" : key;
  // Build the update incrementally — sql() doesn't support dynamic
  // SET lists cleanly, so use a single big COALESCE-with-sentinel
  // approach: pass a flag column alongside the value.
  void u;
  await sql()`
    UPDATE chat_profiles SET
      name = CASE WHEN ${args.name === undefined}::boolean THEN name ELSE ${args.name ?? null}::text END,
      emoji = CASE WHEN ${args.emoji === undefined}::boolean THEN emoji ELSE ${args.emoji ?? null}::text END,
      description = CASE WHEN ${args.description === undefined}::boolean THEN description ELSE ${args.description ?? null}::text END,
      follow_up_enabled = CASE WHEN ${args.followUpEnabled === undefined}::boolean THEN follow_up_enabled ELSE ${args.followUpEnabled ?? null}::boolean END,
      follow_up_threshold_hours = CASE WHEN ${args.followUpThresholdHours === undefined}::boolean THEN follow_up_threshold_hours ELSE ${args.followUpThresholdHours ?? null}::numeric END,
      follow_up_escalate_hours = CASE WHEN ${args.followUpEscalateHours === undefined}::boolean THEN follow_up_escalate_hours ELSE ${args.followUpEscalateHours ?? null}::numeric END,
      follow_up_transcribe_voices = CASE WHEN ${args.followUpTranscribeVoices === undefined}::boolean THEN follow_up_transcribe_voices ELSE ${args.followUpTranscribeVoices ?? null}::boolean END,
      mode = CASE WHEN ${args.mode === undefined}::boolean THEN mode ELSE ${args.mode ?? null}::text END,
      vip = CASE WHEN ${args.vip === undefined}::boolean THEN vip ELSE ${args.vip ?? null}::boolean END,
      muted = CASE WHEN ${args.muted === undefined}::boolean THEN muted ELSE ${args.muted ?? null}::boolean END,
      auto_summarize_enabled = CASE WHEN ${args.autoSummarizeEnabled === undefined}::boolean THEN auto_summarize_enabled ELSE ${args.autoSummarizeEnabled ?? null}::boolean END,
      auto_summarize_gap_minutes = CASE WHEN ${args.autoSummarizeGapMinutes === undefined}::boolean THEN auto_summarize_gap_minutes ELSE ${args.autoSummarizeGapMinutes ?? null}::int END,
      auto_summarize_smart_timing = CASE WHEN ${args.autoSummarizeSmartTiming === undefined}::boolean THEN auto_summarize_smart_timing ELSE ${args.autoSummarizeSmartTiming ?? null}::boolean END,
      auto_forward_voice = CASE WHEN ${args.autoForwardVoice === undefined}::boolean THEN auto_forward_voice ELSE ${args.autoForwardVoice ?? null}::boolean END,
      auto_forward_video = CASE WHEN ${args.autoForwardVideo === undefined}::boolean THEN auto_forward_video ELSE ${args.autoForwardVideo ?? null}::boolean END,
      auto_forward_photo = CASE WHEN ${args.autoForwardPhoto === undefined}::boolean THEN auto_forward_photo ELSE ${args.autoForwardPhoto ?? null}::boolean END,
      auto_forward_location = CASE WHEN ${args.autoForwardLocation === undefined}::boolean THEN auto_forward_location ELSE ${args.autoForwardLocation ?? null}::boolean END,
      auto_extract_notes = CASE WHEN ${args.autoExtractNotes === undefined}::boolean THEN auto_extract_notes ELSE ${args.autoExtractNotes ?? null}::boolean END,
      ai_process_voice = CASE WHEN ${args.aiProcessVoice === undefined}::boolean THEN ai_process_voice ELSE ${args.aiProcessVoice ?? null}::boolean END,
      ai_process_stickers = CASE WHEN ${args.aiProcessStickers === undefined}::boolean THEN ai_process_stickers ELSE ${args.aiProcessStickers ?? null}::boolean END,
      ai_process_gifs = CASE WHEN ${args.aiProcessGifs === undefined}::boolean THEN ai_process_gifs ELSE ${args.aiProcessGifs ?? null}::boolean END,
      ai_process_photos = CASE WHEN ${args.aiProcessPhotos === undefined}::boolean THEN ai_process_photos ELSE ${args.aiProcessPhotos ?? null}::boolean END,
      ai_process_video_notes = CASE WHEN ${args.aiProcessVideoNotes === undefined}::boolean THEN ai_process_video_notes ELSE ${args.aiProcessVideoNotes ?? null}::boolean END,
      updated_at = NOW()
    WHERE id = ${args.id}`;
}

export async function deleteChatProfile(id: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  // Block deleting default / builtin profiles; clear chat assignments
  // first then drop.
  await sql()`UPDATE chat_rules SET profile_id = NULL WHERE profile_id = ${id}`;
  await sql()`DELETE FROM chat_profiles
    WHERE id = ${id} AND is_default = FALSE AND is_builtin = FALSE`;
}

// Resolve "what profile does this chat use" — never returns null
// from the operator's perspective. If chat has no explicit profile_id,
// fall back to the tenant's default profile.
// --- Follow-up AI verdict cache ---

// Cache the AI verdict against the current customer message — so the
// cron doesn't re-spend AI tokens on the same conversation state
// every tick. When a new customer message arrives, the cache becomes
// stale (last_customer_at > follow_up_ai_for_message_at).
export async function setFollowUpAiVerdict(args: {
  chatId: number;
  forMessageAt: Date;
  needsReply: boolean;
  reason: string;
  urgency: "low" | "normal" | "high";
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, follow_up_ai_for_message_at,
      follow_up_ai_verdict_at, follow_up_ai_needs_reply,
      follow_up_ai_reason, follow_up_ai_urgency)
    VALUES (${args.chatId}, 'private',
      ${args.forMessageAt.toISOString()}::timestamptz, NOW(),
      ${args.needsReply}, ${args.reason}, ${args.urgency})
    ON CONFLICT (chat_id) DO UPDATE SET
      follow_up_ai_for_message_at = EXCLUDED.follow_up_ai_for_message_at,
      follow_up_ai_verdict_at = EXCLUDED.follow_up_ai_verdict_at,
      follow_up_ai_needs_reply = EXCLUDED.follow_up_ai_needs_reply,
      follow_up_ai_reason = EXCLUDED.follow_up_ai_reason,
      follow_up_ai_urgency = EXCLUDED.follow_up_ai_urgency,
      updated_at = NOW()`;
}

export async function ackChatFollowUp(chatId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET follow_up_acked_at = NOW(), updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}

export async function recordChatFollowUpPing(args: {
  chatId: number;
  kind: "first" | "escalate";
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules
    SET follow_up_last_ping_at = NOW(),
        follow_up_last_ping_kind = ${args.kind},
        updated_at = NOW()
    WHERE chat_id = ${args.chatId}`;
}

export type FollowUpCandidate = {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  thresholdHours: number;
  escalateHours: number;
  lastPingAt: Date | null;
  lastPingKind: string | null;
  ackedAt: Date | null;
  lastCustomerMessageAt: Date;
  lastCustomerMessageText: string;
  lastOwnerMessageAt: Date | null;
  pendingCustomerMessageCount: number;
  // Effective per the assigned profile (or per-chat fallback).
  transcribeVoices: boolean;
  // Cached AI verdict. Stale when aiForMessageAt < lastCustomerMessageAt.
  aiForMessageAt: Date | null;
  aiVerdictAt: Date | null;
  aiNeedsReply: boolean | null;
  aiReason: string | null;
  aiUrgency: "low" | "normal" | "high" | null;
};

// Scan ALL private chats and return the ones that meet either of:
//   - first ping condition: customer sent something more than
//     threshold hours ago, owner hasn't replied since, AND we
//     haven't already pinged for this stretch.
//   - escalate condition: we already pinged "first" more than
//     escalate hours ago and the owner is STILL silent.
//
// The follow-up cron walks this list each tick and posts to
// notes_inbox.
export async function listFollowUpCandidates(args?: {
  tenantId?: number | null;
}): Promise<FollowUpCandidate[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    WITH msg_per_chat AS (
      SELECT
        m.chat_id,
        MAX(CASE WHEN m.from_owner THEN m.created_at END) AS last_owner_at,
        MAX(CASE WHEN NOT m.from_owner THEN m.created_at END) AS last_customer_at
      FROM messages_log m
      WHERE m.chat_type = 'private'
        AND m.created_at > NOW() - INTERVAL '365 days'
        AND COALESCE(m.skipped_reason, '') <> 'muted'
        AND (${tenantId}::bigint IS NULL OR m.tenant_id = ${tenantId})
      GROUP BY m.chat_id
    ),
    rx_per_chat AS (
      SELECT chat_id, MAX(reacted_at) AS last_reaction_at
      FROM owner_reactions
      WHERE reacted_at > NOW() - INTERVAL '365 days'
        AND (${tenantId}::bigint IS NULL OR tenant_id = ${tenantId})
      GROUP BY chat_id
    ),
    per_chat AS (
      SELECT
        m.chat_id,
        GREATEST(m.last_owner_at, r.last_reaction_at) AS last_owner_at,
        m.last_customer_at
      FROM msg_per_chat m
      LEFT JOIN rx_per_chat r ON r.chat_id = m.chat_id
    ),
    candidate AS (
      SELECT p.chat_id, p.last_owner_at, p.last_customer_at,
             r.first_name, r.last_name, r.nickname, r.chat_title,
             -- Effective follow-up settings: profile wins when chat
             -- is assigned to one; otherwise the per-chat fields.
             COALESCE(prof.follow_up_enabled, r.follow_up_enabled, TRUE) AS follow_up_enabled,
             COALESCE(prof.follow_up_threshold_hours, r.follow_up_threshold_hours, 2) AS follow_up_threshold_hours,
             COALESCE(prof.follow_up_escalate_hours, r.follow_up_escalate_hours, 12) AS follow_up_escalate_hours,
             COALESCE(prof.follow_up_transcribe_voices, r.follow_up_transcribe_voices, FALSE) AS follow_up_transcribe_voices,
             r.follow_up_last_ping_at, r.follow_up_last_ping_kind,
             r.follow_up_acked_at,
             r.follow_up_ai_for_message_at, r.follow_up_ai_verdict_at,
             r.follow_up_ai_needs_reply, r.follow_up_ai_reason,
             r.follow_up_ai_urgency
      FROM per_chat p
      LEFT JOIN chat_rules r ON r.chat_id = p.chat_id
      LEFT JOIN chat_profiles prof ON prof.id = COALESCE(
        r.profile_id,
        (SELECT id FROM chat_profiles WHERE is_default = TRUE
          AND (tenant_id IS NULL OR tenant_id = ${tenantId}) LIMIT 1)
      )
      WHERE p.last_customer_at IS NOT NULL
        AND p.last_owner_at IS NOT NULL
        AND p.last_owner_at < p.last_customer_at
        AND COALESCE(prof.follow_up_enabled, r.follow_up_enabled, TRUE) = TRUE
        AND COALESCE(r.muted, FALSE) = FALSE
        AND COALESCE(r.ignored, FALSE) = FALSE
        AND COALESCE(r.is_bot, FALSE) = FALSE
        AND (
          r.follow_up_acked_at IS NULL
          OR r.follow_up_acked_at < p.last_customer_at
        )
    )
    SELECT c.*,
           EXTRACT(EPOCH FROM (NOW() - c.last_customer_at)) / 3600.0 AS hours_since_customer,
           CASE
             WHEN c.follow_up_last_ping_at IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (NOW() - c.follow_up_last_ping_at)) / 3600.0
           END AS hours_since_ping
    FROM candidate c
    WHERE
      -- First ping not sent yet AND we're past the threshold.
      (
        c.follow_up_last_ping_at IS NULL
        AND EXTRACT(EPOCH FROM (NOW() - c.last_customer_at)) / 3600.0
            >= COALESCE(c.follow_up_threshold_hours, 2)
      )
      OR
      -- First ping sent, owner still silent, escalate threshold elapsed.
      (
        c.follow_up_last_ping_at IS NOT NULL
        AND c.follow_up_last_ping_kind = 'first'
        AND EXTRACT(EPOCH FROM (NOW() - c.follow_up_last_ping_at)) / 3600.0
            >= COALESCE(c.follow_up_escalate_hours, 12)
      )
    ORDER BY c.last_customer_at ASC
    LIMIT 10`;
  const out: FollowUpCandidate[] = [];
  for (const r0 of rows as Array<Record<string, unknown>>) {
    const chatId = Number(r0.chat_id);
    // Pull a quick summary: count of customer messages since the
    // owner's last reply, plus the latest customer text.
    const lastOwnerAt = (r0.last_owner_at as Date) ?? null;
    const summaryRows = await sql()`
      SELECT COUNT(*)::int AS cnt,
             (ARRAY_AGG(message_text ORDER BY created_at DESC))[1] AS last_text
      FROM messages_log
      WHERE chat_id = ${chatId}
        AND from_owner = FALSE
        AND COALESCE(skipped_reason, '') <> 'muted'
        AND created_at > COALESCE(${
          lastOwnerAt ? lastOwnerAt.toISOString() : null
        }::timestamptz, NOW() - INTERVAL '365 days')`;
    const s = summaryRows[0] as
      | { cnt: number; last_text: string | null }
      | undefined;
    const urgencyRaw = (r0.follow_up_ai_urgency as string) ?? null;
    out.push({
      chatId,
      chatTitle: (r0.chat_title as string) ?? null,
      firstName: (r0.first_name as string) ?? null,
      lastName: (r0.last_name as string) ?? null,
      nickname: (r0.nickname as string) ?? null,
      thresholdHours: Number(r0.follow_up_threshold_hours ?? 2),
      escalateHours: Number(r0.follow_up_escalate_hours ?? 12),
      lastPingAt: (r0.follow_up_last_ping_at as Date) ?? null,
      lastPingKind: (r0.follow_up_last_ping_kind as string) ?? null,
      ackedAt: (r0.follow_up_acked_at as Date) ?? null,
      lastCustomerMessageAt: r0.last_customer_at as Date,
      lastCustomerMessageText: (s?.last_text as string) ?? "",
      lastOwnerMessageAt: lastOwnerAt,
      pendingCustomerMessageCount: Number(s?.cnt ?? 1),
      transcribeVoices: Boolean(r0.follow_up_transcribe_voices ?? false),
      aiForMessageAt: (r0.follow_up_ai_for_message_at as Date) ?? null,
      aiVerdictAt: (r0.follow_up_ai_verdict_at as Date) ?? null,
      aiNeedsReply:
        r0.follow_up_ai_needs_reply == null
          ? null
          : Boolean(r0.follow_up_ai_needs_reply),
      aiReason: (r0.follow_up_ai_reason as string) ?? null,
      aiUrgency:
        urgencyRaw === "low" || urgencyRaw === "normal" || urgencyRaw === "high"
          ? urgencyRaw
          : null,
    });
  }
  return out;
}

// Debug-only counterpart to listFollowUpCandidates: returns ALL
// private chats with a "decided" reason describing exactly which
// gate fired (or "would_ping_first" / "would_ping_escalate" when
// the chat is a real candidate). Used by the cron's ?debug=1 mode
// so the operator can see why a specific chat isn't being pinged.
export type FollowUpDebugRow = {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  lastCustomerMessageAt: Date | null;
  // last_owner_at after GREATEST(owner_message, owner_reaction)
  lastOwnerMessageAt: Date | null;
  // Pure message-only last owner message (no reactions). Used to
  // explain whether a chat counted as "replied" due to a reaction.
  lastOwnerMsgOnlyAt: Date | null;
  // Pure reaction-only last owner reaction.
  lastReactionAt: Date | null;
  // Total owner reactions ever recorded for this chat (sanity check —
  // if 0 even after the operator says they reacted, the message_reaction
  // pipeline isn't reaching the bot for this chat).
  reactionsTotal: number;
  // Cached AI follow-up verdict (matches FollowUpCandidate fields).
  aiForMessageAt: Date | null;
  aiVerdictAt: Date | null;
  aiNeedsReply: boolean | null;
  aiReason: string | null;
  aiUrgency: "low" | "normal" | "high" | null;
  // Last ANY message (owner or customer, ignoring from_owner). Helpful
  // when last_customer_at looks stale — if last_any_at is recent, the
  // missing customer rows are being logged as from_owner=TRUE.
  lastAnyMessageAt: Date | null;
  messagesLast24h: number;
  hoursSinceCustomer: number | null;
  followUpEnabled: boolean;
  thresholdHours: number;
  escalateHours: number;
  lastPingAt: Date | null;
  lastPingKind: string | null;
  ackedAt: Date | null;
  muted: boolean;
  ignored: boolean;
  isBot: boolean;
  decided: string;
};

export async function debugFollowUpScan(args?: {
  tenantId?: number | null;
}): Promise<FollowUpDebugRow[]> {
  if (!hasDb()) return [];
  await ensureSchema();
  const tenantId = args?.tenantId ?? null;
  const rows = await sql()`
    WITH msg_per_chat AS (
      SELECT
        m.chat_id,
        MAX(CASE WHEN m.from_owner THEN m.created_at END) AS last_owner_at,
        MAX(CASE WHEN NOT m.from_owner THEN m.created_at END) AS last_customer_at,
        MAX(m.created_at) AS last_any_at,
        COUNT(*) FILTER (
          WHERE m.created_at > NOW() - INTERVAL '24 hours'
        )::int AS msgs_last_24h
      FROM messages_log m
      WHERE m.chat_type = 'private'
        AND m.created_at > NOW() - INTERVAL '365 days'
        AND COALESCE(m.skipped_reason, '') <> 'muted'
        AND (${tenantId}::bigint IS NULL OR m.tenant_id = ${tenantId})
      GROUP BY m.chat_id
    ),
    rx_per_chat AS (
      SELECT chat_id,
             MAX(reacted_at) AS last_reaction_at,
             COUNT(*)::int AS reactions_total
      FROM owner_reactions
      WHERE reacted_at > NOW() - INTERVAL '365 days'
        AND (${tenantId}::bigint IS NULL OR tenant_id = ${tenantId})
      GROUP BY chat_id
    ),
    per_chat AS (
      SELECT
        m.chat_id,
        m.last_owner_at AS last_owner_msg_at,
        r.last_reaction_at,
        COALESCE(r.reactions_total, 0) AS reactions_total,
        GREATEST(m.last_owner_at, r.last_reaction_at) AS last_owner_at,
        m.last_customer_at,
        m.last_any_at,
        m.msgs_last_24h
      FROM msg_per_chat m
      LEFT JOIN rx_per_chat r ON r.chat_id = m.chat_id
    )
    SELECT
      p.chat_id, p.last_owner_at, p.last_owner_msg_at,
      p.last_reaction_at, p.reactions_total, p.last_customer_at, p.last_any_at,
      p.msgs_last_24h,
      r.first_name, r.last_name, r.nickname, r.chat_title,
      COALESCE(r.follow_up_enabled, TRUE) AS follow_up_enabled,
      COALESCE(r.follow_up_threshold_hours, 2) AS threshold_h,
      COALESCE(r.follow_up_escalate_hours, 12) AS escalate_h,
      r.follow_up_last_ping_at, r.follow_up_last_ping_kind,
      r.follow_up_acked_at,
      r.follow_up_ai_for_message_at, r.follow_up_ai_verdict_at,
      r.follow_up_ai_needs_reply, r.follow_up_ai_reason,
      r.follow_up_ai_urgency,
      COALESCE(r.muted, FALSE) AS muted,
      COALESCE(r.ignored, FALSE) AS ignored,
      COALESCE(r.is_bot, FALSE) AS is_bot,
      CASE
        WHEN p.last_customer_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (NOW() - p.last_customer_at)) / 3600.0
      END AS hours_since_customer,
      CASE
        WHEN p.last_customer_at IS NULL THEN 'no_customer_message'
        WHEN p.last_owner_at IS NULL THEN 'never_engaged'
        WHEN p.last_owner_at >= p.last_customer_at THEN 'replied_by_owner'
        WHEN COALESCE(r.follow_up_enabled, TRUE) = FALSE THEN 'follow_up_disabled'
        WHEN COALESCE(r.muted, FALSE) THEN 'chat_muted'
        WHEN COALESCE(r.ignored, FALSE) THEN 'chat_ignored'
        WHEN COALESCE(r.is_bot, FALSE) THEN 'is_bot'
        WHEN r.follow_up_acked_at IS NOT NULL
             AND r.follow_up_acked_at >= p.last_customer_at THEN 'acked'
        WHEN r.follow_up_last_ping_at IS NULL
             AND EXTRACT(EPOCH FROM (NOW() - p.last_customer_at)) / 3600.0
                 < COALESCE(r.follow_up_threshold_hours, 2)
          THEN 'below_threshold'
        -- AI verdict layer: only after threshold + filters pass.
        WHEN r.follow_up_ai_for_message_at IS NULL
             OR r.follow_up_ai_for_message_at < p.last_customer_at
          THEN 'ai_pending'
        WHEN r.follow_up_ai_needs_reply = FALSE THEN 'ai_no_reply_needed'
        WHEN r.follow_up_last_ping_at IS NULL THEN 'would_ping_first'
        WHEN r.follow_up_last_ping_kind = 'first'
             AND EXTRACT(EPOCH FROM (NOW() - r.follow_up_last_ping_at)) / 3600.0
                 < COALESCE(r.follow_up_escalate_hours, 12)
          THEN 'waiting_for_escalate'
        WHEN r.follow_up_last_ping_kind = 'first' THEN 'would_ping_escalate'
        ELSE 'already_pinged_escalate'
      END AS decided
    FROM per_chat p
    LEFT JOIN chat_rules r ON r.chat_id = p.chat_id
    ORDER BY p.last_customer_at DESC NULLS LAST
    LIMIT 300`;
  const out: FollowUpDebugRow[] = [];
  for (const r0 of rows as Array<Record<string, unknown>>) {
    const aiUrgencyRaw = (r0.follow_up_ai_urgency as string) ?? null;
    out.push({
      chatId: Number(r0.chat_id),
      chatTitle: (r0.chat_title as string) ?? null,
      firstName: (r0.first_name as string) ?? null,
      lastName: (r0.last_name as string) ?? null,
      nickname: (r0.nickname as string) ?? null,
      lastCustomerMessageAt: (r0.last_customer_at as Date) ?? null,
      lastOwnerMessageAt: (r0.last_owner_at as Date) ?? null,
      lastOwnerMsgOnlyAt: (r0.last_owner_msg_at as Date) ?? null,
      lastReactionAt: (r0.last_reaction_at as Date) ?? null,
      aiForMessageAt: (r0.follow_up_ai_for_message_at as Date) ?? null,
      aiVerdictAt: (r0.follow_up_ai_verdict_at as Date) ?? null,
      aiNeedsReply:
        r0.follow_up_ai_needs_reply == null
          ? null
          : Boolean(r0.follow_up_ai_needs_reply),
      aiReason: (r0.follow_up_ai_reason as string) ?? null,
      aiUrgency:
        aiUrgencyRaw === "low" ||
        aiUrgencyRaw === "normal" ||
        aiUrgencyRaw === "high"
          ? aiUrgencyRaw
          : null,
      reactionsTotal: Number(r0.reactions_total ?? 0),
      lastAnyMessageAt: (r0.last_any_at as Date) ?? null,
      messagesLast24h: Number(r0.msgs_last_24h ?? 0),
      hoursSinceCustomer:
        r0.hours_since_customer == null
          ? null
          : Number(r0.hours_since_customer),
      followUpEnabled: Boolean(r0.follow_up_enabled),
      thresholdHours: Number(r0.threshold_h),
      escalateHours: Number(r0.escalate_h),
      lastPingAt: (r0.follow_up_last_ping_at as Date) ?? null,
      lastPingKind: (r0.follow_up_last_ping_kind as string) ?? null,
      ackedAt: (r0.follow_up_acked_at as Date) ?? null,
      muted: Boolean(r0.muted),
      ignored: Boolean(r0.ignored),
      isBot: Boolean(r0.is_bot),
      decided: String(r0.decided),
    });
  }
  return out;
}

export async function setChatSummaryIntervalHours(args: {
  chatId: number;
  hours: number | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    INSERT INTO chat_rules (chat_id, chat_type, summary_interval_hours)
    VALUES (${args.chatId}, 'group', ${args.hours})
    ON CONFLICT (chat_id) DO UPDATE SET
      summary_interval_hours = ${args.hours},
      updated_at = NOW()`;
}

export async function getChatSummaryIntervalHours(
  chatId: number,
): Promise<number | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = await sql()`
    SELECT summary_interval_hours FROM chat_rules WHERE chat_id = ${chatId} LIMIT 1`;
  const r = rows[0] as { summary_interval_hours: number | null } | undefined;
  return r?.summary_interval_hours ?? null;
}

export async function markChatSummaryRun(chatId: number): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  await sql()`
    UPDATE chat_rules SET last_summary_run_at = NOW(), updated_at = NOW()
    WHERE chat_id = ${chatId}`;
}
