// Chat defaults — settings the operator configures globally that get
// applied to every NEW chat the bot sees. The chat detail page also
// uses these to pre-fill the form when no chat_rules row exists yet,
// so the operator doesn't stare at all-default columns from the DB
// schema (which are different from what they actually want).

import {
  ensureSchema,
  hasDb,
  RELATIONSHIPS,
  sql,
  type ChatMode,
  type Relationship,
} from "./db";
import { CHAT_MODES } from "./db";
import { getSettings } from "./settings";

export type ChatDefaults = {
  mode: ChatMode;
  relationship: Relationship | null;
  autoForwardVoice: boolean;
  autoForwardVideo: boolean;
  autoForwardPhoto: boolean;
  autoForwardLocation: boolean;
  autoExtractNotes: boolean;
  autoSummarizeEnabled: boolean;
  autoSummarizeGapMinutes: number;
  autoSummarizeSmartTiming: boolean;
  aiProcessVoice: boolean;
  aiProcessStickers: boolean;
  aiProcessGifs: boolean;
  aiProcessPhotos: boolean;
  aiProcessVideoNotes: boolean;
};

function asBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const t = v.toLowerCase();
  return t === "true" || t === "1" || t === "on";
}

export async function getChatDefaults(): Promise<ChatDefaults> {
  const s = await getSettings();
  const mode = (CHAT_MODES as readonly string[]).includes(s.chatDefaultMode)
    ? (s.chatDefaultMode as ChatMode)
    : "off";
  const rel = (RELATIONSHIPS as readonly string[]).includes(
    s.chatDefaultRelationship,
  )
    ? (s.chatDefaultRelationship as Relationship)
    : null;
  const gap = Math.max(1, Math.min(Number(s.chatDefaultAutoSummarizeGapMinutes) || 5, 240));
  return {
    mode,
    relationship: rel,
    autoForwardVoice: asBool(s.chatDefaultAutoForwardVoice, false),
    autoForwardVideo: asBool(s.chatDefaultAutoForwardVideo, false),
    autoForwardPhoto: asBool(s.chatDefaultAutoForwardPhoto, false),
    autoForwardLocation: asBool(s.chatDefaultAutoForwardLocation, false),
    autoExtractNotes: asBool(s.chatDefaultAutoExtractNotes, false),
    autoSummarizeEnabled: asBool(s.chatDefaultAutoSummarizeEnabled, false),
    autoSummarizeGapMinutes: gap,
    autoSummarizeSmartTiming: asBool(s.chatDefaultAutoSummarizeSmartTiming, true),
    aiProcessVoice: asBool(s.chatDefaultAiProcessVoice, false),
    aiProcessStickers: asBool(s.chatDefaultAiProcessStickers, false),
    aiProcessGifs: asBool(s.chatDefaultAiProcessGifs, false),
    aiProcessPhotos: asBool(s.chatDefaultAiProcessPhotos, false),
    aiProcessVideoNotes: asBool(s.chatDefaultAiProcessVideoNotes, false),
  };
}

// Upsert a chat_rules row using current global defaults — but ONLY
// if the row doesn't exist yet. Existing rules are left alone so
// per-chat overrides aren't clobbered. Called fire-and-forget right
// after a NEW chat first messages the bot.
export async function ensureChatRuleWithDefaults(args: {
  chatId: number;
  chatType: string;
  chatTitle?: string | null;
}): Promise<void> {
  if (!hasDb()) return;
  await ensureSchema();
  const existing = await sql()`SELECT 1 FROM chat_rules WHERE chat_id = ${args.chatId} LIMIT 1`;
  if ((existing as unknown[]).length > 0) return;
  const d = await getChatDefaults();
  await sql()`
    INSERT INTO chat_rules (
      chat_id, chat_type, chat_title, mode, mode_changed_at,
      relationship,
      auto_forward_voice, auto_forward_video, auto_forward_photo,
      auto_forward_location, auto_extract_notes,
      auto_summarize_enabled, auto_summarize_gap_minutes,
      auto_summarize_smart_timing,
      ai_process_voice, ai_process_stickers, ai_process_gifs, ai_process_photos,
      ai_process_video_notes,
      updated_at
    )
    VALUES (
      ${args.chatId}, ${args.chatType}, ${args.chatTitle ?? null},
      ${d.mode}, NOW(),
      ${d.relationship},
      ${d.autoForwardVoice}, ${d.autoForwardVideo}, ${d.autoForwardPhoto},
      ${d.autoForwardLocation}, ${d.autoExtractNotes},
      ${d.autoSummarizeEnabled}, ${d.autoSummarizeGapMinutes},
      ${d.autoSummarizeSmartTiming},
      ${d.aiProcessVoice}, ${d.aiProcessStickers}, ${d.aiProcessGifs}, ${d.aiProcessPhotos},
      ${d.aiProcessVideoNotes},
      NOW()
    )
    ON CONFLICT (chat_id) DO NOTHING`;
}
