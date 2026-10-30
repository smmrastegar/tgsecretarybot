// "Continue with Telegram" in the player app. The owner (an account connected to the bot, or the owner's notify chat) lands on the Main link.
// Anyone else is a sign-up request: nothing is shown until the owner approves it in the bot (✅ whole library / ❌) or in the dashboard Links
// card (where they also choose what that person sees). The person is told in Telegram when it is decided.
import { createTgLink, findLinkByTgUser, getAllSettings, getPlayerLink, isAllowedUser, updatePlayerLink } from "./db";
import { getLegacyToken, getMainScope, isLegacyActive, newLinkToken } from "./music-token";
import { getSettings } from "./settings";
import { getBot } from "./bot/core";
import { InlineKeyboard } from "grammy";
import type { LoginUser } from "./db/login-requests";

export type TgPlayerLogin =
  | { ok: true; owner: boolean; token: string }
  | { ok: false; reason: "off" | "closed" | "approval" | "denied"; created?: boolean };

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
    if (have.approval === "pending") return { ok: false, reason: "approval" };
    if (have.approval === "denied") return { ok: false, reason: "denied" };
    return have.active ? { ok: true, owner: false, token: have.token } : { ok: false, reason: "off" };
  }
  if ((await getAllSettings()).musicTgSignup === "0") return { ok: false, reason: "closed" }; // the owner stopped taking requests
  const scope = await getMainScope();
  const name = label(u) + (u.username && !label(u).startsWith("@") ? ` (@${u.username})` : "");
  const { link, created } = await createTgLink(u.userId, name, newLinkToken(), { canLike: false, accountIds: scope?.ids ?? [], accountsMode: scope?.mode ?? "any" });
  if (created) void notifyOwner(link.id, name).catch(() => {});
  return { ok: false, reason: "approval", created };
}

async function notifyOwner(linkId: number, name: string): Promise<void> {
  const chat = (await getSettings().catch(() => null))?.ownerNotifyChatId;
  if (!chat) return;
  await getBot().api.sendMessage(chat,
    `🎵 درخواست ورود به پلیر\n\n${name} با تلگرام آمد و می‌خواد وارد My Music بشه. تا تأیید نکنی هیچی نمی‌بینه.\n\n` +
    `• «کل کتابخانه»: همین الان کل آهنگ‌ها رو می‌بینه (ویرایش و لایک اسپاتیفای خاموش).\n` +
    `• یا از داشبورد انتخاب کن چی ببینه و همون‌جا تأیید کن:\n${baseUrl()}/music — «لینک‌های خصوصی پلیر»`,
    { reply_markup: new InlineKeyboard().text("✅ کل کتابخانه", `plink:ok:${linkId}`).text("❌ رد", `plink:no:${linkId}`) });
}

/** Owner's decision (bot button or dashboard). `all` = approve with the whole library; otherwise whatever was already chosen for the link stands. */
export async function decidePlayerLink(id: number, approve: boolean, all = false): Promise<boolean> {
  const link = await getPlayerLink(id);
  if (!link || link.tgUserId == null) return false;
  await updatePlayerLink(id, { approval: approve ? "approved" : "denied", ...(approve && all ? { allLibrary: true } : {}) });
  try {
    await getBot().api.sendMessage(link.tgUserId, approve
      ? "✅ ورودت به My Music تأیید شد. توی برنامه دوباره «Continue with Telegram» رو بزن."
      : "درخواست ورودت به My Music تأیید نشد.");
  } catch { /* they blocked the bot: nothing to do */ }
  return true;
}
