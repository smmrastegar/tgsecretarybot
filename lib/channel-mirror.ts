// Shared channel-mirror config parsing. Used by:
//   - lib/bot.ts       — mirrors INCOMING channel/DM messages the bot
//                        receives (channel_post / business_message).
//   - lib/instagram-monitor.ts — mirrors posts the APP ITSELF writes
//                        into a source channel (the bot never receives
//                        its own posts back as channel_post, so those
//                        must be mirrored at the write site instead).
//
// Config format (the `channelMirrors` setting), one rule per line:
//   "<fromChatId> > <toChatId>"                — into the channel root
//   "<fromChatId> > <toChatId> > <threadId>"   — into a forum topic
// Blank lines and lines starting with # are ignored.

export type MirrorRule = { from: number; to: number; threadId?: number };

export function parseChannelMirrors(raw: string): MirrorRule[] {
  const out: MirrorRule[] = [];
  for (const line of (raw ?? "").split(/\n+/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(">").map((p) => p.trim());
    const from = Number(parts[0]);
    const to = Number(parts[1]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0 || to === 0) {
      continue;
    }
    const threadNum = parts[2] ? Number(parts[2]) : NaN;
    out.push({
      from,
      to,
      threadId: Number.isFinite(threadNum) && threadNum > 0 ? threadNum : undefined,
    });
  }
  return out;
}

// Destinations to copy a message from `sourceChatId` into. Loop-guarded:
// a chat that is any rule's destination is never used as a source, so
// A→B can't ping-pong. Self-routes (to === source) are dropped.
export function mirrorTargetsFor(
  rules: MirrorRule[],
  sourceChatId: number,
): MirrorRule[] {
  if (rules.length === 0) return [];
  const destinations = new Set(rules.map((r) => r.to));
  if (destinations.has(sourceChatId)) return [];
  return rules.filter((r) => r.from === sourceChatId && r.to !== sourceChatId);
}
