import { get, getSettings } from "./settings";

export type AlertPayload = {
  text: string;
  sender: string;
  chat: string;
  importance: number;
  reason: string;
  timestamp: string;
};

export async function fireAlert(payload: AlertPayload): Promise<boolean> {
  const s = await getSettings();
  const url = s.alertWebhookUrl;
  if (!url) {
    console.log("[alert] no webhook configured; would have fired:", payload);
    return false;
  }

  const method = (s.alertWebhookMethod || "POST").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (s.alertWebhookHeaders) {
    try {
      Object.assign(
        headers,
        JSON.parse(s.alertWebhookHeaders) as Record<string, string>,
      );
    } catch (err) {
      console.error("[alert] invalid alertWebhookHeaders JSON:", err);
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alert webhook ${res.status}: ${body.slice(0, 300)}`);
  }
  return true;
}

export async function alertConfigured(): Promise<boolean> {
  return Boolean((await get("alertWebhookUrl")).trim());
}
