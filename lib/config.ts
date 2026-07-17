import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),

  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openrouterModel:
    optional("OPENROUTER_MODEL") ?? "google/gemini-2.5-flash-lite",
  openrouterAppName: optional("OPENROUTER_APP_NAME") ?? "tgsecretarybot",
  openrouterAppUrl: optional("OPENROUTER_APP_URL"),

  groqApiKey: optional("GROQ_API_KEY"),

  // HikerAPI (Instagram via https://hikerapi.com). Without this the
  // /api/cron/instagram-stories cron is a no-op.
  hikerApiKey: optional("HIKER_API_KEY"),
  hikerBaseUrl: optional("HIKER_BASE_URL") ?? "https://api.hikerapi.com",

  webhookSecretToken: optional("WEBHOOK_SECRET_TOKEN"),
  setupSecret: optional("SETUP_SECRET"),
  cronSecret: optional("CRON_SECRET"),
  // Bearer token for the MCP endpoint (/api/mcp). When unset the
  // endpoint refuses every request. Set a long random value in Vercel
  // env and paste the same into your MCP client config.
  mcpSecret: optional("MCP_SECRET"),
  // Shared secret the external browser scraper (GitHub Action) uses to
  // POST scraped page text to /api/site-monitors/ingest.
  siteMonitorIngestSecret: optional("SITE_MONITOR_INGEST_SECRET"),

  databaseUrl:
    optional("DATABASE_URL") ??
    optional("POSTGRES_URL") ??
    optional("NEON_DATABASE_URL"),

  sessionSecret:
    optional("SESSION_SECRET") ??
    optional("WEBHOOK_SECRET_TOKEN") ??
    "dev-session-secret-change-me",

  publicAppUrl: optional("NEXT_PUBLIC_APP_URL"),

  // Multi-tenant bootstrap. Comma-separated Telegram user IDs that
  // are seeded into admin_users on first run. Required for the
  // initial admin to log in — after that admins can be added /
  // removed via the /admin UI.
  adminUserIdsCsv: optional("ADMIN_USER_IDS") ?? "",
} as const;

export const DEFAULT_SETTINGS = {
  ownerName: "the owner",
  ownerDisplayName: "",
  ownerContext: "",
  ownerAliasesCsv: "",
  ownerJobDescription: "",
  groupPriorityKeywordsCsv: "",
  importanceThreshold: "7",
  ownerNotifyChatId: "",
  alertWebhookUrl: "",
  alertWebhookMethod: "POST",
  alertWebhookHeaders: "{}",
  autoReplyEnabled: "true",
  autoReplyText:
    "در حال حاضر قادر به پاسخ‌گویی نیستم. به محض اینکه بتوانم پاسخ می‌دهم.",
  autoReplyCooldownMinutes: "60",
  groupAnalysisEnabled: "true",
  groupSummaryHourUTC: "3",
  dmActiveGraceMinutes: "5",
  groupActiveGraceMinutes: "30",
  secretaryEnabled: "false",
  secretaryUserId: "",
  secretaryDisplayName: "",
  secretarySessionMinutes: "120",
  secretarySuppressAutoReply: "true",
  secretaryAutoTranscribe: "true",
  secretariesJson: "",
  aiModelsCsv: "",
  aiChatModelsCsv: "",
  sttLanguage: "fa",
  markMessagesAsRead: "true",
  // Drop-in webhook that accepts the SMS-Forwarder Android app's
  // exact JSON shape ({chat_id, text}) so the operator only has to
  // change the URL field. Token is a shared secret in the query
  // string. Chat title is the label these forwards appear under in
  // /messages.
  smsWebhookSecret: "",
  smsWebhookChatTitle: "📱 SMS Forwarder",
  // Sender-name / body substrings whose forwarded SMS should be posted
  // to the inbox SILENTLY (disable_notification: true) — no ping. One
  // pattern per line (or comma-separated). Matching is case-insensitive
  // and normalizes Arabic ي/ك → Persian ی/ک, so "مانیتورینگ" catches
  // the "سرويس مانيتورينگ ليمومي" monitoring alerts regardless of the
  // varying body. Empty = every SMS pings as usual.
  smsSilentSenderPatterns: "مانیتورینگ\nmonitoring",
  // Optional destination for a copy of every SILENT SMS — a group id
  // (and optional forum-topic thread id). Use it to keep a running log
  // of monitoring alerts in a dedicated topic. Empty = no copy.
  smsSilentCopyChatId: "",
  smsSilentCopyThreadId: "",
  autoExtractEnabled: "true",
  autoExtractMinImportance: "4",
  monitorDefaultIntervalMinutes: "720",
  monitorDefaultCheckStories: "true",
  monitorDefaultCheckPosts: "false",
  monitorDefaultCheckReels: "false",
  monitorDefaultCheckProfile: "false",
  monitorDefaultCheckMentioned: "false",
  // External "change detector" — an upstream service that polls
  // Instagram cheaply on its own and webhooks us when something
  // actually changes. We do the expensive Hiker fetch only on
  // those pings. See docs/EXTERNAL_MONITOR_API.md for the contract.
  // External Notify service is deprecated — the cron now polls
  // HikerAPI directly on a per-account interval. Forced to "false"
  // so /api/monitored/notify won't accept inbound webhooks even if
  // the operator forgot to flip it off.
  monitorExternalEnabled: "false",
  monitorExternalBaseUrl: "",
  monitorExternalSecret: "",
  // Defaults applied to NEW chats — first time the bot sees a chat it
  // upserts a chat_rules row with these values, and the chat detail
  // page pre-fills the form with them for any chat that doesn't yet
  // have a rule. Owner can override on per-chat basis afterwards.
  chatDefaultMode: "off",
  chatDefaultRelationship: "",
  chatDefaultAutoForwardVoice: "false",
  chatDefaultAutoForwardVideo: "false",
  chatDefaultAutoForwardPhoto: "false",
  chatDefaultAutoForwardLocation: "false",
  chatDefaultAutoExtractNotes: "false",
  chatDefaultAutoSummarizeEnabled: "false",
  chatDefaultAutoSummarizeGapMinutes: "5",
  chatDefaultAutoSummarizeSmartTiming: "true",
  chatDefaultAiProcessVoice: "false",
  chatDefaultAiProcessStickers: "false",
  chatDefaultAiProcessGifs: "false",
  chatDefaultAiProcessPhotos: "false",
  chatDefaultAiProcessVideoNotes: "false",
  chatDefaultAiGeneratePhoto: "false",
  // URL of the operator's reference photo. When ai_generate_photo is
  // on for a chat and the user asks for a photo, we feed this URL to
  // an image-gen model as the visual anchor. Anywhere public-readable
  // works — Telegram file URLs, imgur, vercel blob, etc.
  ownerPhotoUrl: "",
  // HikerAPI logical budget — we don't know the actual remaining
  // dollars from HikerAPI's API, so we track every call locally and
  // gate spending against a total (default $50 = the user's pre-pay)
  // with periodic approval checkpoints (default every $10).
  hikerBudgetUsd: "50",
  hikerApprovalStepUsd: "10",
  hikerApprovedUsd: "10",
  hikerCostPerCallUsd: "0.005",
  hikerOptimizeChangeDetection: "true",
  // --- Notes / Watchlist global settings ---
  // Master switch for the AI watchlist scanner. When OFF the bot
  // skips watchlist scanning entirely for every incoming message.
  notesWatchlistEnabled: "true",
  // When ON, every watchlist match is also forwarded to the chat
  // whose function role is notes_inbox. Per-concept override exists
  // on note_watch_items.forward_to_inbox.
  notesWatchlistForwardToInbox: "true",
  // Minimum minutes between two matches of the SAME concept from
  // the SAME chat. Stops one busy chat from spamming the inbox.
  // Per-concept override lives on note_watch_items.cooldown_override_minutes.
  // Default 0 = no cooldown (every match fires). Set this higher
  // (e.g. 30) on chats where one concept can fire many times per hour.
  notesWatchlistCooldownMinutes: "0",
  // Skip scanning messages shorter than this. Saves LLM cost on
  // "ok" / "👍" / etc.
  notesWatchlistMinMessageLength: "8",
  // Auto-archive notes older than N days. 0 = never auto-archive.
  // Applied by a background sweep so old kanban / address notes
  // don't pile up.
  notesAutoArchiveDays: "0",
  // Daily digest: when ON, post a one-shot summary of the previous
  // 24h of watchlist matches into the notes_inbox channel at the
  // configured UTC hour.
  notesDailyDigestEnabled: "false",
  notesDailyDigestHourUTC: "8",
  // Optional UI-settable override for HIKER_API_KEY. When non-empty
  // this wins over the env var so the owner can rotate the key
  // without a Vercel redeploy.
  hikerApiKeyOverride: "",
  // Human-readable label for the active key (e.g. "smmr"). Purely
  // for display.
  hikerApiKeyName: "",
  // --- Email (Resend) ---
  // API key for https://resend.com — used to SEND emails (reply /
  // compose). Sensitive.
  resendApiKey: "",
  // Verified from-address, e.g. "Secretary <mail@yourdomain.com>".
  resendFromEmail: "",
  // Shared secret the inbound-email webhook must present (?token= or
  // Svix signature). Sensitive.
  resendInboundSecret: "",
  // Telegram channel/chat id incoming emails are posted to. If empty,
  // falls back to the chat marked with the email_inbox function role.
  emailChannelId: "",
} as const satisfies Record<string, string>;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

const ENV_OVERRIDES: Record<SettingKey, string | undefined> = {
  ownerName: optional("OWNER_NAME"),
  ownerDisplayName: optional("OWNER_DISPLAY_NAME"),
  ownerContext: optional("OWNER_CONTEXT"),
  ownerAliasesCsv: optional("OWNER_ALIASES_CSV"),
  ownerJobDescription: optional("OWNER_JOB_DESCRIPTION"),
  groupPriorityKeywordsCsv: optional("GROUP_PRIORITY_KEYWORDS_CSV"),
  importanceThreshold: optional("IMPORTANCE_THRESHOLD"),
  ownerNotifyChatId: optional("OWNER_NOTIFY_CHAT_ID"),
  alertWebhookUrl: optional("ALERT_WEBHOOK_URL"),
  alertWebhookMethod: optional("ALERT_WEBHOOK_METHOD"),
  alertWebhookHeaders: optional("ALERT_WEBHOOK_HEADERS"),
  autoReplyEnabled: optional("AUTO_REPLY_ENABLED"),
  autoReplyText: optional("AUTO_REPLY_TEXT"),
  autoReplyCooldownMinutes: optional("AUTO_REPLY_COOLDOWN_MINUTES"),
  groupAnalysisEnabled: optional("GROUP_ANALYSIS_ENABLED"),
  groupSummaryHourUTC: optional("GROUP_SUMMARY_HOUR_UTC"),
  dmActiveGraceMinutes: optional("DM_ACTIVE_GRACE_MINUTES"),
  groupActiveGraceMinutes: optional("GROUP_ACTIVE_GRACE_MINUTES"),
  secretaryEnabled: optional("SECRETARY_ENABLED"),
  secretaryUserId: optional("SECRETARY_USER_ID"),
  secretaryDisplayName: optional("SECRETARY_DISPLAY_NAME"),
  secretarySessionMinutes: optional("SECRETARY_SESSION_MINUTES"),
  secretarySuppressAutoReply: optional("SECRETARY_SUPPRESS_AUTO_REPLY"),
  secretaryAutoTranscribe: optional("SECRETARY_AUTO_TRANSCRIBE"),
  secretariesJson: optional("SECRETARIES_JSON"),
  aiModelsCsv: optional("AI_MODELS_CSV"),
  aiChatModelsCsv: optional("AI_CHAT_MODELS_CSV"),
  sttLanguage: optional("STT_LANGUAGE"),
  markMessagesAsRead: optional("MARK_MESSAGES_AS_READ"),
  smsWebhookSecret: optional("SMS_WEBHOOK_SECRET"),
  smsWebhookChatTitle: optional("SMS_WEBHOOK_CHAT_TITLE"),
  smsSilentSenderPatterns: optional("SMS_SILENT_SENDER_PATTERNS"),
  smsSilentCopyChatId: optional("SMS_SILENT_COPY_CHAT_ID"),
  smsSilentCopyThreadId: optional("SMS_SILENT_COPY_THREAD_ID"),
  autoExtractEnabled: optional("AUTO_EXTRACT_ENABLED"),
  autoExtractMinImportance: optional("AUTO_EXTRACT_MIN_IMPORTANCE"),
  monitorDefaultIntervalMinutes: optional("MONITOR_DEFAULT_INTERVAL_MINUTES"),
  monitorDefaultCheckStories: optional("MONITOR_DEFAULT_CHECK_STORIES"),
  monitorDefaultCheckPosts: optional("MONITOR_DEFAULT_CHECK_POSTS"),
  monitorDefaultCheckReels: optional("MONITOR_DEFAULT_CHECK_REELS"),
  monitorDefaultCheckProfile: optional("MONITOR_DEFAULT_CHECK_PROFILE"),
  monitorDefaultCheckMentioned: optional("MONITOR_DEFAULT_CHECK_MENTIONED"),
  monitorExternalEnabled: optional("MONITOR_EXTERNAL_ENABLED"),
  monitorExternalBaseUrl: optional("MONITOR_EXTERNAL_BASE_URL"),
  monitorExternalSecret: optional("MONITOR_EXTERNAL_SECRET"),
  chatDefaultMode: optional("CHAT_DEFAULT_MODE"),
  chatDefaultRelationship: optional("CHAT_DEFAULT_RELATIONSHIP"),
  chatDefaultAutoForwardVoice: optional("CHAT_DEFAULT_AUTO_FORWARD_VOICE"),
  chatDefaultAutoForwardVideo: optional("CHAT_DEFAULT_AUTO_FORWARD_VIDEO"),
  chatDefaultAutoForwardPhoto: optional("CHAT_DEFAULT_AUTO_FORWARD_PHOTO"),
  chatDefaultAutoForwardLocation: optional("CHAT_DEFAULT_AUTO_FORWARD_LOCATION"),
  chatDefaultAutoExtractNotes: optional("CHAT_DEFAULT_AUTO_EXTRACT_NOTES"),
  chatDefaultAutoSummarizeEnabled: optional("CHAT_DEFAULT_AUTO_SUMMARIZE_ENABLED"),
  chatDefaultAutoSummarizeGapMinutes: optional("CHAT_DEFAULT_AUTO_SUMMARIZE_GAP_MINUTES"),
  chatDefaultAutoSummarizeSmartTiming: optional("CHAT_DEFAULT_AUTO_SUMMARIZE_SMART_TIMING"),
  chatDefaultAiProcessVoice: optional("CHAT_DEFAULT_AI_PROCESS_VOICE"),
  chatDefaultAiProcessStickers: optional("CHAT_DEFAULT_AI_PROCESS_STICKERS"),
  chatDefaultAiProcessGifs: optional("CHAT_DEFAULT_AI_PROCESS_GIFS"),
  chatDefaultAiProcessPhotos: optional("CHAT_DEFAULT_AI_PROCESS_PHOTOS"),
  chatDefaultAiProcessVideoNotes: optional("CHAT_DEFAULT_AI_PROCESS_VIDEO_NOTES"),
  chatDefaultAiGeneratePhoto: optional("CHAT_DEFAULT_AI_GENERATE_PHOTO"),
  ownerPhotoUrl: optional("OWNER_PHOTO_URL"),
  hikerBudgetUsd: optional("HIKER_BUDGET_USD"),
  hikerApprovalStepUsd: optional("HIKER_APPROVAL_STEP_USD"),
  hikerApprovedUsd: optional("HIKER_APPROVED_USD"),
  hikerCostPerCallUsd: optional("HIKER_COST_PER_CALL_USD"),
  hikerOptimizeChangeDetection: optional("HIKER_OPTIMIZE_CHANGE_DETECTION"),
  // Intentionally NOT overridden by env — env is the legacy
  // HIKER_API_KEY path. The override lives only in DB so the UI
  // can set it without redeploying.
  hikerApiKeyOverride: undefined,
  hikerApiKeyName: optional("HIKER_API_KEY_NAME"),
  notesWatchlistEnabled: optional("NOTES_WATCHLIST_ENABLED"),
  notesWatchlistForwardToInbox: optional("NOTES_WATCHLIST_FORWARD_TO_INBOX"),
  notesWatchlistCooldownMinutes: optional("NOTES_WATCHLIST_COOLDOWN_MINUTES"),
  notesWatchlistMinMessageLength: optional("NOTES_WATCHLIST_MIN_MESSAGE_LENGTH"),
  notesAutoArchiveDays: optional("NOTES_AUTO_ARCHIVE_DAYS"),
  notesDailyDigestEnabled: optional("NOTES_DAILY_DIGEST_ENABLED"),
  notesDailyDigestHourUTC: optional("NOTES_DAILY_DIGEST_HOUR_UTC"),
  resendApiKey: optional("RESEND_API_KEY"),
  resendFromEmail: optional("RESEND_FROM_EMAIL"),
  resendInboundSecret: optional("RESEND_INBOUND_SECRET"),
  emailChannelId: optional("EMAIL_CHANNEL_ID"),
};

export function envOverride(key: SettingKey): string | undefined {
  return ENV_OVERRIDES[key];
}
