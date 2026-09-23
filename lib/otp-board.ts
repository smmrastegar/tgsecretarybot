// Data for the OTP board (/otp): every verification code that reached
// the operator recently, from both places SMS lands:
//   * sms_dedup — what the SMS router posted to the sms_inbox channel
//     (the bot's own posts are not in messages_log, this table is);
//   * messages_log — chats the code feeds watch (a phone forwarding
//     straight into a group).
// Codes are extracted with the same rules as the token feeds
// (lib/code-feed.ts), so the board and the feeds never disagree.
import { extractCodes } from "./code-feed";
import { hasDb, listChatsByFunction, listCodeFeeds, sql } from "./db";

export type OtpItem = {
  id: string;
  code: string;
  codes: string[];
  sender: string | null;
  text: string;
  at: string;
  source: "sms" | "feed";
};

type Row = Record<string, unknown>;

export async function recentOtpItems(hours = 24, limit = 100): Promise<OtpItem[]> {
  if (!hasDb()) return [];
  const h = Math.min(168, Math.max(1, Math.round(hours)));
  const out: OtpItem[] = [];

  const inboxes = await listChatsByFunction("sms_inbox").catch(() => []);
  if (inboxes.length > 0) {
    const ids = inboxes.map((c) => c.chatId);
    const rows = (await sql()`
      SELECT id, sender, body_preview, to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
        FROM sms_dedup
       WHERE inbox_chat_id = ANY(${ids}::bigint[])
         AND last_seen_at > NOW() - (${h} || ' hours')::INTERVAL
       ORDER BY last_seen_at DESC
       LIMIT ${limit}`) as Row[];
    for (const r of rows) {
      const text = String(r.body_preview ?? "");
      const codes = extractCodes(text);
      if (codes.length === 0) continue;
      out.push({
        id: `sms:${r.id}`,
        code: codes[0]!,
        codes,
        sender: r.sender == null ? null : String(r.sender),
        text,
        at: String(r.at),
        source: "sms",
      });
    }
  }

  const feeds = await listCodeFeeds().catch(() => []);
  const feedChats = [...new Set(feeds.filter((f) => f.enabled).map((f) => f.chatId))];
  if (feedChats.length > 0) {
    const rows = (await sql()`
      SELECT id, chat_id, sender_name,
             COALESCE(NULLIF(message_text, ''), transcript, '') AS text,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
        FROM messages_log
       WHERE chat_id = ANY(${feedChats}::bigint[])
         AND created_at > NOW() - (${h} || ' hours')::INTERVAL
       ORDER BY created_at DESC
       LIMIT ${limit}`) as Row[];
    for (const r of rows) {
      const text = String(r.text ?? "");
      const codes = extractCodes(text);
      if (codes.length === 0) continue;
      // A phone header line ("☎️+9810002361") is the sender when present.
      const m = /(?:☎️|📨|📱)\s*([^\n]+)/.exec(text);
      out.push({
        id: `feed:${r.id}`,
        code: codes[0]!,
        codes,
        sender: m ? m[1]!.trim() : r.sender_name == null ? null : String(r.sender_name),
        text,
        at: String(r.at),
        source: "feed",
      });
    }
  }

  // The same SMS often reaches both sources (forwarded to the inbox AND
  // seen in the feed group); keep the first occurrence of a code within
  // a few minutes.
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const seen = new Map<string, number>();
  const deduped: OtpItem[] = [];
  for (const it of out) {
    const t = Date.parse(it.at);
    const prev = seen.get(it.code);
    if (prev != null && Math.abs(prev - t) < 10 * 60 * 1000) continue;
    seen.set(it.code, t);
    deduped.push(it);
  }
  return deduped.slice(0, limit);
}
