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

  alertWebhookUrl: optional("ALERT_WEBHOOK_URL"),
  alertWebhookMethod: (optional("ALERT_WEBHOOK_METHOD") ?? "POST").toUpperCase(),
  alertWebhookHeaders: optional("ALERT_WEBHOOK_HEADERS"),

  ownerName: optional("OWNER_NAME") ?? "the owner",
  ownerContext: optional("OWNER_CONTEXT") ?? "",

  importanceThreshold: Number(optional("IMPORTANCE_THRESHOLD") ?? "7"),
  ownerNotifyChatId: optional("OWNER_NOTIFY_CHAT_ID"),
} as const;
