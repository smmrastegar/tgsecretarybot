import { config } from "./config.js";

export type AlertPayload = {
  text: string;
  sender: string;
  chat: string;
  importance: number;
  reason: string;
  timestamp: string;
};

export async function fireAlert(payload: AlertPayload): Promise<void> {
  if (!config.alertWebhookUrl) {
    console.log("[alert] ALERT_WEBHOOK_URL not set; would have fired:", payload);
    return;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.alertWebhookHeaders) {
    try {
      const extra = JSON.parse(config.alertWebhookHeaders) as Record<string, string>;
      Object.assign(headers, extra);
    } catch (err) {
      console.error("[alert] ALERT_WEBHOOK_HEADERS is not valid JSON:", err);
    }
  }

  const res = await fetch(config.alertWebhookUrl, {
    method: config.alertWebhookMethod,
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alert webhook ${res.status}: ${body.slice(0, 300)}`);
  }
}
