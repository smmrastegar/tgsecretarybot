// "Continue with Telegram" in the player app. The owner (an account connected to the bot, or the owner's notify chat) lands on the Main link.
// Anyone else is a sign-up request: nothing is shown until the owner approves it in the bot (✅ whole library / ❌) or in the dashboard Links
// card (where they also choose what that person sees). The person is told in Telegram when it is decided.
import { createTgLink, findLinkByTgUser, getAllSettings, getPlayerLink, isAllowedUser, updatePlayerLink } from "./db";
import { getLegacyToken, isLegacyActive, newLinkToken } from "./music-token";
import { DIRECT_ACCOUNT } from "./music-scope";
import { getSettings } from "./settings";
import { getBot } from "./bot/core";
import { InlineKeyboard } from "grammy";
import type { LoginUser } from "./db/login-requests";

export type TgPlayerLogin =
  | { ok: true; owner: boolean; token: string }
  | { ok: false; reason: "off" | "closed" | "denied"; created?: boolean }
  | { ok: false; reason: "approval"; token: string; created?: boolean }; // token: the app waits on it (it works once approved) and signs in by itself

const label = (u: LoginUser) => [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || (u.username ? `@${u.username}` : `tg:${u.userId}`);
const baseUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://chatbot.bz").replace(/\/$/, "");

export async function isMusicOwner(userId: number): Promise<boolean> {
  if (await isAllowedUser(userId).catch(() => false)) return true;
  const notify = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  return !!notify && String(notify) === String(userId);
}

export async function playerLinkForTelegram(u: LoginUser): Promise<TgPlayerLogin> {
  if (await isMusicOwner(u.userId)) {
    if (!(await isLegacyActive())) return { ok: false, reason: "off" };
    return { ok: true, owner: true, token: await getLegacyToken() };
  }
  const have = await findLinkByTgUser(u.userId);
  if (have) {
    if (have.approval === "pending") return { ok: false, reason: "approval", token: have.token };
    if (have.approval === "denied") return { ok: false, reason: "denied" };
    return have.active ? { ok: true, owner: false, token: have.token } : { ok: false, reason: "off" };
  }
  if ((await getAllSettings()).musicTgSignup === "0") return { ok: false, reason: "closed" }; // the owner stopped taking requests
  const name = label(u) + (u.username && !label(u).startsWith("@") ? ` (@${u.username})` : "");
  const { link, created } = await createTgLink(u.userId, name, newLinkToken(), { canLike: false, accountIds: [DIRECT_ACCOUNT.id], accountsMode: "any" }); // a new person starts with only the Direct songs
  if (created) void notifyOwner(link.id, name).catch(() => {});
  return { ok: false, reason: "approval", token: link.token, created };
}

async function notifyOwner(linkId: number, name: string): Promise<void> {
  const chat = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  if (!chat) return;
  await getBot().api.sendMessage(chat,
    `🎵 درخواست ورود به پلیر\n\n${name} با تلگرام آمد و می‌خواد وارد My Music بشه. تا تأیید نکنی هیچی نمی‌بینه.\n\n` +
    `• «فقط Direct»: فقط آهنگ‌های Direct (آهنگ‌های بدون حساب اسپاتیفای) رو می‌بینه و خودکار وارد می‌شه.\n` +
    `• «کل کتابخانه»: همه‌ی آهنگ‌ها.\n` +
    `• یا از داشبورد انتخاب کن چی ببینه و همون‌جا تأیید کن:\n${baseUrl()}/music — «لینک‌های خصوصی پلیر»`,
    { reply_markup: new InlineKeyboard().text("✅ فقط Direct", `plink:ok:${linkId}`).text("📚 کل کتابخانه", `plink:all:${linkId}`).text("❌ رد", `plink:no:${linkId}`) });
}

/** Owner's decision (bot button or dashboard). "direct" = only the Direct songs, "all" = the whole library, "keep" = whatever was already chosen for the link stands. */
export async function decidePlayerLink(id: number, approve: boolean, what: "direct" | "all" | "keep" = "keep"): Promise<boolean> {
  const link = await getPlayerLink(id);
  if (!link || link.tgUserId == null) return false;
  await updatePlayerLink(id, { approval: approve ? "approved" : "denied", ...(approve && what === "direct" ? { allLibrary: true, accountIds: [DIRECT_ACCOUNT.id], accountsMode: "any" as const } : {}), ...(approve && what === "all" ? { allLibrary: true, accountIds: [] } : {}) });
  try {
    await getBot().api.sendMessage(link.tgUserId, approve
      ? "✅ ورودت به My Music تأیید شد. برنامه خودش وارد می‌شه؛ اگه بسته بود بازش کن."
      : "درخواست ورودت به My Music تأیید نشد.");
  } catch { /* they blocked the bot: nothing to do */ }
  return true;
}
