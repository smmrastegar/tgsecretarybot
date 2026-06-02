// Shared "fetch + forward" pipeline used by both the periodic cron
// and the on-add endpoints. The cron processes due accounts in bulk;
// the add endpoints kick this off for a single newly-inserted account
// so the owner sees the latest stories + last few posts immediately
// instead of waiting for the next cron tick.

import { Bot } from "grammy";
import {
  listChatsByFunction,
  markMonitorEventForwarded,
  markMonitoredChecked,
  recordMonitorEvent,
  setInstagramUserId,
  type MonitoredAccount,
} from "./db";
import {
  getUserByUsername,
  getUserPosts,
  getUserReels,
  getUserStories,
  type IGMedia,
} from "./hikerapi";

export type AccountTarget = {
  chatId: number;
};

export async function resolveTargetChat(): Promise<AccountTarget | null> {
  const storages = await listChatsByFunction("storage");
  if (storages[0]) return { chatId: storages[0].chatId };
  const downloaders = await listChatsByFunction("downloader");
  if (downloaders[0]) return { chatId: downloaders[0].chatId };
  return null;
}

export function captionFor(args: {
  account: MonitoredAccount;
  kind: "story" | "post" | "reel";
  media: IGMedia;
}): string {
  const { account, kind, media } = args;
  const kindLabel =
    kind === "story" ? "📸 Story" : kind === "reel" ? "🎬 Reel" : "🖼 Post";
  const lines: string[] = [
    `${kindLabel} · @${account.username}`,
    media.takenAt.toLocaleString(),
  ];
  if (media.caption) {
    const trimmed = media.caption.trim();
    if (trimmed) lines.push("", trimmed.slice(0, 700));
  }
  if (media.permalink) lines.push("", media.permalink);
  return lines.join("\n").slice(0, 1024);
}

export async function sendMediaToChat(args: {
  bot: Bot;
  chatId: number;
  media: IGMedia;
  caption: string;
}): Promise<number> {
  const { bot, chatId, media, caption } = args;
  if (media.extra.length > 1) {
    const groupItems = media.extra.slice(0, 10).map((m, i) => ({
      type: m.mediaType === "video" ? ("video" as const) : ("photo" as const),
      media: m.mediaUrl,
      caption: i === 0 ? caption : undefined,
    }));
    const sent = await bot.api.sendMediaGroup(chatId, groupItems);
    return sent[0]?.message_id ?? 0;
  }
  if (media.mediaType === "video" && media.mediaUrl) {
    const sent = await bot.api.sendVideo(chatId, media.mediaUrl, { caption });
    return sent.message_id;
  }
  if (media.mediaType === "photo" && media.mediaUrl) {
    const sent = await bot.api.sendPhoto(chatId, media.mediaUrl, { caption });
    return sent.message_id;
  }
  const sent = await bot.api.sendMessage(
    chatId,
    `${caption}\n\n${media.mediaUrl ?? ""}`.slice(0, 4096),
  );
  return sent.message_id;
}

// Run the full pipeline for a single account. Returns counts so the
// caller can surface them (e.g. "3 posts forwarded" after a manual
// add). Wraps errors per-kind so a transient HikerAPI failure for
// reels doesn't prevent the stories from going through.
export async function processAccount(args: {
  account: MonitoredAccount;
  target: AccountTarget;
  bot: Bot;
  // Optional caps used by the immediate-after-add path so we don't
  // flood the storage channel with someone's entire feed history.
  postsLimit?: number;
  reelsLimit?: number;
  forceAllKinds?: boolean;
}): Promise<{
  detected: number;
  forwarded: number;
  errors: string[];
  latestSeen: Date | null;
}> {
  const { account, target, bot, postsLimit, reelsLimit, forceAllKinds } = args;
  const errors: string[] = [];
  let detected = 0;
  let forwarded = 0;
  let latestSeen: Date | null = null;

  let userId = account.instagramUserId;
  if (!userId) {
    try {
      const u = await getUserByUsername(account.username);
      userId = u.id;
      await setInstagramUserId(account.id, userId).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`resolve ${account.username}: ${msg.slice(0, 200)}`);
      await markMonitoredChecked({ id: account.id, error: msg.slice(0, 500) });
      return { detected, forwarded, errors, latestSeen };
    }
  }

  const tasks: Array<{
    kind: "story" | "post" | "reel";
    fn: () => Promise<IGMedia[]>;
    limit?: number;
  }> = [];
  if (forceAllKinds || account.checkStories)
    tasks.push({
      kind: "story",
      fn: () => getUserStories(userId!, account.username),
    });
  if (forceAllKinds || account.checkPosts)
    tasks.push({
      kind: "post",
      fn: () => getUserPosts(userId!, account.username),
      limit: postsLimit,
    });
  if (forceAllKinds || account.checkReels)
    tasks.push({
      kind: "reel",
      fn: () => getUserReels(userId!, account.username),
      limit: reelsLimit,
    });

  for (const task of tasks) {
    let items: IGMedia[];
    try {
      items = await task.fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${account.username} ${task.kind}: ${msg.slice(0, 150)}`);
      continue;
    }
    if (task.limit) items = items.slice(0, task.limit);
    for (const m of items) {
      if (!latestSeen || m.takenAt > latestSeen) latestSeen = m.takenAt;
      const ev = await recordMonitorEvent({
        accountId: account.id,
        storyId: `${task.kind}:${m.id}`,
        storyUrl: m.permalink ?? m.mediaUrl,
        kind: task.kind,
        caption: captionFor({ account, kind: task.kind, media: m }),
        mediaType: m.mediaType,
      });
      if (!ev) continue;
      detected++;
      try {
        const msgId = await sendMediaToChat({
          bot,
          chatId: target.chatId,
          media: m,
          caption: captionFor({ account, kind: task.kind, media: m }),
        });
        await markMonitorEventForwarded({
          id: ev.id,
          chatId: target.chatId,
          messageId: msgId,
        });
        forwarded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(
          `forward ${account.username} ${task.kind}: ${msg.slice(0, 150)}`,
        );
      }
    }
  }

  await markMonitoredChecked({
    id: account.id,
    lastStoryAt: latestSeen,
    error: null,
  });
  return { detected, forwarded, errors, latestSeen };
}
