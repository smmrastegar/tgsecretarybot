// A second bot that only READS: it sits in groups / channels and every message people write there is recorded in the same log the dashboard
// already shows (Messages, Groups, summaries). It never replies, reacts or runs rules — it only calls getUpdates. Token: setting tgReaderToken.
// Telegram only shows a bot all group messages when its privacy mode is off (BotFather → /setprivacy → Disable, then add the bot to the group
// again) or when it is an admin there; otherwise it sees commands, mentions and replies to it.
import type { Message } from "grammy/types";
import { addRuleRecipient, createMessageRule, getAllSettings, isChatIgnored, logMessage, setSetting, updateMessageRule } from "./db";
import { describeMessage, getBot } from "./bot/core";
import { maybeApplyMessageRules } from "./bot/rules-apply";
import { reportWarn } from "./report";

const API = "https://api.telegram.org";
export type ReaderInfo = { username: string; canReadAll: boolean; at: number; error: string | null; groups: number; lastMessageAt: number | null };

async function tg<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${API}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

/** Check a token and remember who it is. */
export async function readerCheck(token: string): Promise<{ username: string; canReadAll: boolean }> {
  const me = await tg<{ username?: string; can_read_all_group_messages?: boolean }>(token, "getMe");
  return { username: me.username ?? "?", canReadAll: me.can_read_all_group_messages === true };
}

export async function readerInfo(): Promise<ReaderInfo | null> {
  try { const j = JSON.parse((await getAllSettings()).tgReaderInfo || "null") as ReaderInfo | null; return j; } catch { return null; }
}

/** Groups the reader bot has been seen in, and the forwarding rule made for each (if any). */
export type ReaderChat = { title: string | null; type: string; seenAt: number; ruleId: number | null };
export async function readerChats(): Promise<Record<string, ReaderChat>> {
  try { return JSON.parse((await getAllSettings()).tgReaderChats || "{}") as Record<string, ReaderChat>; } catch { return {}; }
}
const saveChats = (c: Record<string, ReaderChat>) => setSetting("tgReaderChats", JSON.stringify(Object.fromEntries(Object.entries(c).sort((a, b) => b[1].seenAt - a[1].seenAt).slice(0, 60))));

/** Forward everything the reader hears in a group to a recipient chat (the ticket-routing bot) with a header naming where it came from and where it goes. */
export async function createReaderRoute(chatId: number, title: string | null, dest: string, recipientChatId: number): Promise<number> {
  const info = await readerInfo();
  const from = info?.username ? `@${info.username}` : "reader";
  const rule = await createMessageRule({ name: `Reader: ${title ?? chatId} → ${dest}`, description: `هر پیامی که ربات خواننده در گروه «${title ?? chatId}» می‌بیند، با سربرگ تیکت و مقصد «${dest}» فوروارد می‌شود.` });
  await updateMessageRule(rule.id, { sourceChatIds: String(chatId), matchAllFromSource: true, showRulePrefix: false, forwardHeader: `🎫 درخواست تیک جدید داریم\nاز ${from} ← مقصد: {dest} · {time}` });
  await addRuleRecipient({ ruleId: rule.id, recipientChatId, recipientLabel: dest });
  return rule.id;
}

/** A group the bot was added to or spoke in: remember it, and if the owner asked for "route the next group I add", set that up. */
export async function setReaderChatRule(chatId: number, ruleId: number | null): Promise<void> {
  const chats = await readerChats();
  if (chats[String(chatId)]) { chats[String(chatId)]!.ruleId = ruleId; await saveChats(chats); }
}

async function noteChat(m: { id: number; title: string | null; type: string }): Promise<void> {
  const chats = await readerChats();
  const key = String(m.id);
  const known = chats[key];
  if (known && Date.now() - known.seenAt < 5 * 60_000) return; // already known and recent: no write per message
  chats[key] = { title: m.title, type: m.type, seenAt: Date.now(), ruleId: known?.ruleId ?? null };
  if (!known) {
    try {
      const auto = JSON.parse((await getAllSettings()).tgReaderAuto || "null") as { dest: string; recipient: number } | null;
      if (auto?.dest && auto.recipient) {
        chats[key]!.ruleId = await createReaderRoute(m.id, m.title, auto.dest, auto.recipient);
        await setSetting("tgReaderAuto", ""); // one group only: it was asked for "this group"
        const to = (await getAllSettings()).ownerNotifyChatId;
        if (to) await getBot().api.sendMessage(to, `✅ گروه «${m.title ?? m.id}» به ربات تیکت وصل شد: هر پیامش با «مقصد: ${auto.dest}» فوروارد می‌شود.`).catch(() => {});
      }
    } catch (e) { reportWarn("reader", "auto route failed:", e); }
  }
  await saveChats(chats);
}

let busy = false, lastInfoAt = 0;

/** Cron step (every minute): fetch what was written since last time and log it. Never throws. Returns how many messages were logged. */
export async function readerStep(): Promise<number> {
  if (busy) return 0;
  busy = true;
  let logged = 0;
  try {
    const s = await getAllSettings();
    const token = (s.tgReaderToken ?? "").trim();
    if (!token) return 0;
    const info = await readerInfo();
    if (!info || Date.now() - lastInfoAt > 10 * 60_000) {
      lastInfoAt = Date.now();
      try { const c = await readerCheck(token); await setSetting("tgReaderInfo", JSON.stringify({ ...(info ?? { groups: 0, lastMessageAt: null }), ...c, at: Date.now(), error: null } satisfies ReaderInfo)); }
      catch (e) { await setSetting("tgReaderInfo", JSON.stringify({ ...(info ?? { username: "?", canReadAll: false, groups: 0, lastMessageAt: null }), at: Date.now(), error: String(e).slice(0, 200) })); return 0; }
    }
    let offset = Number(s.tgReaderOffset || 0);
    const chats = new Set<number>();
    for (let round = 0; round < 5; round++) { // up to 500 updates per tick
      const ups = await tg<Array<{ update_id: number; message?: Message; channel_post?: Message; my_chat_member?: { chat: { id: number; type: string; title?: string }; new_chat_member: { status: string } } }>>(token, "getUpdates", { offset: offset || undefined, limit: 100, timeout: 0, allowed_updates: ["message", "channel_post", "my_chat_member"] });
      if (ups.length === 0) break;
      for (const u of ups) {
        offset = u.update_id + 1;
        const mc = u.my_chat_member;
        if (mc && mc.chat.type !== "private" && ["member", "administrator"].includes(mc.new_chat_member.status)) await noteChat({ id: mc.chat.id, title: mc.chat.title ?? null, type: mc.chat.type }).catch(() => {});
        const m = u.message ?? u.channel_post;
        if (!m || m.chat.type === "private") continue; // groups, supergroups and channels only
        if (await isChatIgnored(m.chat.id).catch(() => false)) continue;
        const text = describeMessage(m);
        if (!text || !text.trim()) continue;
        const title = "title" in m.chat && typeof m.chat.title === "string" ? m.chat.title : null;
        const sender = m.sender_chat?.title ?? ([m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ").trim() || m.from?.username || "—");
        const logId = await logMessage({
          businessConnectionId: null, ownerUserId: null, chatId: m.chat.id, chatType: m.chat.type, chatTitle: title,
          senderId: m.from?.id ?? null, senderUsername: m.from?.username ?? null, senderName: sender, messageId: m.message_id,
          messageText: text, importance: 0, urgent: false, concernsOwner: false, reason: "read by the reader bot (log only)",
          alerted: false, autoReplied: false, fromOwner: false, source: "reader", messageThreadId: m.message_thread_id ?? null,
        }).then((id) => { logged++; chats.add(m.chat.id); return id; }).catch((err) => { reportWarn("reader", "log failed:", err); return 0; });
        if (!logId) continue;
        await noteChat({ id: m.chat.id, title, type: m.chat.type }).catch(() => {});
        // Rules that name THIS group as their source (e.g. "forward everything to the ticket bot") run on it; the "any chat" rules never do.
        await maybeApplyMessageRules({ logId, chatId: m.chat.id, chatTitle: title, messageThreadId: m.message_thread_id ?? null, senderName: sender, messageText: text, businessConnectionId: null, fromOwner: false, bot: getBot(), scopedOnly: true })
          .catch((err) => reportWarn("reader", "rules failed:", err));
      }
      await setSetting("tgReaderOffset", String(offset)); // saved after every batch: a crash never re-reads or loses a batch
      if (ups.length < 100) break;
    }
    if (logged > 0) {
      const cur = await readerInfo();
      if (cur) await setSetting("tgReaderInfo", JSON.stringify({ ...cur, lastMessageAt: Date.now(), groups: Math.max(cur.groups, chats.size) }));
    }
  } catch (err) {
    reportWarn("reader", "step failed:", err);
  } finally { busy = false; }
  return logged;
}
