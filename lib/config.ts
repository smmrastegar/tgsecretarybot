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
  autoExtractEnabled: "true",
  autoExtractMinImportance: "4",
  monitorDefaultIntervalMinutes: "30",
  monitorDefaultCheckStories: "true",
  monitorDefaultCheckPosts: "false",
  monitorDefaultCheckReels: "false",
  monitorDefaultCheckProfile: "false",
  monitorDefaultCheckMentioned: "false",
  // HikerAPI logical budget — we don't know the actual remaining
  // dollars from HikerAPI's API, so we track every call locally and
  // gate spending against a total (default $50 = the user's pre-pay)
  // with periodic approval checkpoints (default every $10).
  hikerBudgetUsd: "50",
  hikerApprovalStepUsd: "10",
  hikerApprovedUsd: "10",
  hikerCostPerCallUsd: "0.005",
  hikerOptimizeChangeDetection: "true",
  // Optional UI-settable override for HIKER_API_KEY. When non-empty
  // this wins over the env var so the owner can rotate the key
  // without a Vercel redeploy.
  hikerApiKeyOverride: "",
  // Human-readable label for the active key (e.g. "smmr"). Purely
  // for display.
  hikerApiKeyName: "",
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
  autoExtractEnabled: optional("AUTO_EXTRACT_ENABLED"),
  autoExtractMinImportance: optional("AUTO_EXTRACT_MIN_IMPORTANCE"),
  monitorDefaultIntervalMinutes: optional("MONITOR_DEFAULT_INTERVAL_MINUTES"),
  monitorDefaultCheckStories: optional("MONITOR_DEFAULT_CHECK_STORIES"),
  monitorDefaultCheckPosts: optional("MONITOR_DEFAULT_CHECK_POSTS"),
  monitorDefaultCheckReels: optional("MONITOR_DEFAULT_CHECK_REELS"),
  monitorDefaultCheckProfile: optional("MONITOR_DEFAULT_CHECK_PROFILE"),
  monitorDefaultCheckMentioned: optional("MONITOR_DEFAULT_CHECK_MENTIONED"),
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
};

export function envOverride(key: SettingKey): string | undefined {
  return ENV_OVERRIDES[key];
}
