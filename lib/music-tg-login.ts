// "Continue with Telegram" in the player app. The owner (an account connected to the bot, or the owner's notify chat) lands on the Main link;
// anyone else gets a link of their own the first time — a copy of the Main link's whole library, with editing switched off — and the owner is
// told so they can trim it in the dashboard (Links card). Signing in again returns the same link.
import { createTgLink, findLinkByTgUser, getAllSettings, isAllowedUser } from "./db";
import { getLegacyToken, getMainScope, isLegacyActive, newLinkToken } from "./music-token";
import { getSettings } from "./settings";
import { getBot } from "./bot/core";
import type { LoginUser } from "./db/login-requests";

export type TgPlayerLogin =
  | { ok: true; owner: boolean; token: string; created: boolean }
  | { ok: false; reason: "off" | "closed" };

const label = (u: LoginUser) => [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || (u.username ? `@${u.username}` : `tg:${u.userId}`);

export async function isMusicOwner(userId: number): Promise<boolean> {
  if (await isAllowedUser(userId).catch(() => false)) return true;
  const notify = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  return !!notify && String(notify) === String(userId);
}

export async function playerLinkForTelegram(u: LoginUser): Promise<TgPlayerLogin> {
  if (await isMusicOwner(u.userId)) {
    if (!(await isLegacyActive())) return { ok: false, reason: "off" };
    return { ok: true, owner: true, token: await getLegacyToken(), created: false };
  }
  const have = await findLinkByTgUser(u.userId);
  if (have) return have.active ? { ok: true, owner: false, token: have.token, created: false } : { ok: false, reason: "off" };
  if ((await getAllSettings()).musicTgSignup === "0") return { ok: false, reason: "closed" }; // the owner can stop new people from getting a link
  const scope = await getMainScope();
  const name = label(u) + (u.username && !label(u).startsWith("@") ? ` (@${u.username})` : "");
  const { link, created } = await createTgLink(u.userId, name, newLinkToken(), { canLike: false, accountIds: scope?.ids ?? [], accountsMode: scope?.mode ?? "any" });
  if (created) void notifyOwner(name).catch(() => {});
  return link.active ? { ok: true, owner: false, token: link.token, created } : { ok: false, reason: "off" };
}

async function notifyOwner(name: string): Promise<void> {
  const chat = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  if (!chat) return;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://chatbot.bz").replace(/\/$/, "");
  await getBot().api.sendMessage(chat,
    `🎵 ${name} با تلگرام وارد پلیر شد.\n\n` +
    `یک لینک مخصوص خودش گرفت: کپی لینک اصلی (کل کتابخانه)، با «ویرایش و آپلود» و «لایک در اسپاتیفای» خاموش.\n` +
    `اگه باید چیزی کمش کنی (پلی‌لیست‌ها، آهنگ‌های کدام حساب، غیرفعال کردن)، از اینجا تنظیمش کن:\n${base}/music — «لینک‌های خصوصی پلیر»`);
}
