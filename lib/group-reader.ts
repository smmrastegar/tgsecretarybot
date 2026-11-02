// A second bot that only READS: it sits in groups / channels and every message people write there is recorded in the same log the dashboard
// already shows (Messages, Groups, summaries). It never replies, reacts or runs rules — it only calls getUpdates. Token: setting tgReaderToken.
// Telegram only shows a bot all group messages when its privacy mode is off (BotFather → /setprivacy → Disable, then add the bot to the group
// again) or when it is an admin there; otherwise it sees commands, mentions and replies to it.
import type { Message } from "grammy/types";
import { getAllSettings, isChatIgnored, logMessage, setSetting } from "./db";
import { describeMessage } from "./bot/core";
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
      const ups = await tg<Array<{ update_id: number; message?: Message; channel_post?: Message }>>(token, "getUpdates", { offset: offset || undefined, limit: 100, timeout: 0, allowed_updates: ["message", "channel_post"] });
      if (ups.length === 0) break;
      for (const u of ups) {
        offset = u.update_id + 1;
        const m = u.message ?? u.channel_post;
        if (!m || m.chat.type === "private") continue; // groups, supergroups and channels only
        if (await isChatIgnored(m.chat.id).catch(() => false)) continue;
        const text = describeMessage(m);
        if (!text || !text.trim()) continue;
        const title = "title" in m.chat && typeof m.chat.title === "string" ? m.chat.title : null;
        const sender = m.sender_chat?.title ?? ([m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ").trim() || m.from?.username || "—");
        await logMessage({
          businessConnectionId: null, ownerUserId: null, chatId: m.chat.id, chatType: m.chat.type, chatTitle: title,
          senderId: m.from?.id ?? null, senderUsername: m.from?.username ?? null, senderName: sender, messageId: m.message_id,
          messageText: text, importance: 0, urgent: false, concernsOwner: false, reason: "read by the reader bot (log only)",
          alerted: false, autoReplied: false, fromOwner: false, source: "reader", messageThreadId: m.message_thread_id ?? null,
        }).then(() => { logged++; chats.add(m.chat.id); }).catch((err) => reportWarn("reader", "log failed:", err));
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
