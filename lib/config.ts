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
    optional("OPENROUTER_MODEL") ?? "google/gemini-2.0-flash-lite-001",
  openrouterAppName: optional("OPENROUTER_APP_NAME") ?? "tgsecretarybot",
  openrouterAppUrl: optional("OPENROUTER_APP_URL"),

  groqApiKey: optional("GROQ_API_KEY"),

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
} as const;

export const DEFAULT_SETTINGS = {
  ownerName: "the owner",
  ownerDisplayName: "",
  ownerContext: "",
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
} as const satisfies Record<string, string>;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

const ENV_OVERRIDES: Record<SettingKey, string | undefined> = {
  ownerName: optional("OWNER_NAME"),
  ownerDisplayName: optional("OWNER_DISPLAY_NAME"),
  ownerContext: optional("OWNER_CONTEXT"),
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
};

export function envOverride(key: SettingKey): string | undefined {
  return ENV_OVERRIDES[key];
}
