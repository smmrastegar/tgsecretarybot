import { createHmac, timingSafeEqual } from "node:crypto";

// Telegram Mini Apps: the page receives `initData`, a query string signed with a key derived from the bot token.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export type TgWebAppUser = { id: number; first_name?: string; last_name?: string; username?: string };

export function verifyInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600, now = Date.now()): TgWebAppUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(check).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== calc.length || !timingSafeEqual(given, calc)) return null;
  const at = Number(params.get("auth_date"));
  if (!Number.isFinite(at) || now / 1000 - at > maxAgeSec || at - now / 1000 > 300) return null;
  try {
    const u = JSON.parse(params.get("user") ?? "null") as TgWebAppUser | null;
    return u && typeof u.id === "number" ? u : null;
  } catch { return null; }
}
