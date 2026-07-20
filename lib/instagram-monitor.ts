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
  getUserMentions,
  getUserPosts,
  getUserReels,
  getUserStories,
  InstagramTransientError,
  type IGMedia,
} from "./hikerapi";
import { getSettings } from "./settings";
import { getCurrentTenantId } from "./tenant-context";
import { parseChannelMirrors, mirrorTargetsFor } from "./channel-mirror";

export type AccountTarget = {
  chatId: number;
};

export async function resolveTargetChat(): Promise<AccountTarget | null> {
  // Tenant-scoped: pulls the storage/downloader role chat for the
  // currently-active tenant (set via runWithTenant). If no tenant
  // context (legacy callers, tests), falls back to the global pick.
  const tenantId = getCurrentTenantId();
  const storages = await listChatsByFunction("storage", tenantId);
  if (storages[0]) return { chatId: storages[0].chatId };
  const downloaders = await listChatsByFunction("downloader", tenantId);
  if (downloaders[0]) return { chatId: downloaders[0].chatId };
  return null;
}

// Telegram HTML parse_mode only allows a tiny tag set + needs entities
// escaped. We use it for hyperlinks (the "Story" word jumps to the
// permalink, @username jumps to the profile, mentions go to their
// profiles, the swipe-up link is a clickable button-style line).
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type MediaKind = "story" | "post" | "reel" | "mentioned";

export function captionFor(args: {
  account: MonitoredAccount;
  kind: MediaKind;
  media: IGMedia;
}): string {
  const { account, kind, media } = args;
  const kindWord =
    kind === "story"
      ? "Story"
      : kind === "reel"
        ? "Reel"
        : kind === "mentioned"
          ? "Tagged"
          : "Post";
  const kindEmoji =
    kind === "story"
      ? "📸"
      : kind === "reel"
        ? "🎬"
        : kind === "mentioned"
          ? "🏷"
          : "🖼";
  const lines: string[] = [];

  // Full name first, then handle line.
  const fullName = (account.fullName ?? account.username).trim();
  lines.push(`<b>${esc(fullName)}</b>`);
  const profileUrl = `https://instagram.com/${account.username}`;
  const storyLink = media.permalink
    ? `<a href="${esc(media.permalink)}">${kindEmoji} ${kindWord}</a>`
    : `${kindEmoji} ${kindWord}`;
  const handleLink = `<a href="${esc(profileUrl)}">@${esc(account.username)}</a>`;
  lines.push(`${storyLink} · ${handleLink}`);

  if (media.externalLink) {
    lines.push(`🔗 <a href="${esc(media.externalLink)}">link</a>`);
  }
  if (media.mentions && media.mentions.length > 0) {
    const ml = media.mentions
      .slice(0, 10)
      .map(
        (u) =>
          `<a href="https://instagram.com/${esc(u)}">@${esc(u)}</a>`,
      )
      .join(" ");
    lines.push(`👥 ${ml}`);
  }
  if (media.hashtags && media.hashtags.length > 0) {
    const ht = media.hashtags
      .slice(0, 15)
      .map((t) => `#${esc(t)}`)
      .join(" ");
    lines.push(ht);
  }
  if (media.location) {
    lines.push(`📍 ${esc(media.location)}`);
  }
  if (media.textStickers && media.textStickers.length > 0) {
    for (const t of media.textStickers.slice(0, 3)) {
      lines.push(`«${esc(t.slice(0, 200))}»`);
    }
  }
  if (media.caption) {
    const trimmed = media.caption.trim();
    if (trimmed) lines.push("", esc(trimmed.slice(0, 500)));
  }
  // Telegram caption is 1024 chars; trim if our HTML exceeds it. The
  // hard cap matters because Telegram counts HTML markup too.
  let html = lines.join("\n");
  if (html.length > 1024) html = html.slice(0, 1024);
  return html;
}

export async function sendMediaToChat(args: {
  bot: Bot;
  chatId: number;
  media: IGMedia;
  caption: string;
  threadId?: number;
}): Promise<number> {
  const { bot, chatId, media, caption, threadId } = args;
  const HTML = "HTML" as const;
  const thread = threadId ? { message_thread_id: threadId } : {};
  if (media.extra.length > 1) {
    const groupItems = media.extra.slice(0, 10).map((m, i) => ({
      type: m.mediaType === "video" ? ("video" as const) : ("photo" as const),
      media: m.mediaUrl,
      caption: i === 0 ? caption : undefined,
      parse_mode: i === 0 ? HTML : undefined,
    }));
    const sent = await bot.api.sendMediaGroup(chatId, groupItems, thread);
    return sent[0]?.message_id ?? 0;
  }
  if (media.mediaType === "video" && media.mediaUrl) {
    const sent = await bot.api.sendVideo(chatId, media.mediaUrl, {
      caption,
      parse_mode: HTML,
      ...thread,
    });
    return sent.message_id;
  }
  if (media.mediaType === "photo" && media.mediaUrl) {
    const sent = await bot.api.sendPhoto(chatId, media.mediaUrl, {
      caption,
      parse_mode: HTML,
      ...thread,
    });
    return sent.message_id;
  }
  const sent = await bot.api.sendMessage(
    chatId,
    `${caption}\n\n${media.mediaUrl ?? ""}`.slice(0, 4096),
    { parse_mode: HTML, ...thread },
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
  mentionedLimit?: number;
  storiesLimit?: number;
  forceAllKinds?: boolean;
  // When set, ignore the account's check_* flags and use these
  // instead (per-call override from the refresh dialog).
  kindOverrides?: {
    story?: boolean;
    post?: boolean;
    reel?: boolean;
    mentioned?: boolean;
  };
}): Promise<{
  detected: number;
  forwarded: number;
  errors: string[];
  latestSeen: Date | null;
}> {
  const {
    account,
    target,
    bot,
    postsLimit,
    reelsLimit,
    mentionedLimit,
    storiesLimit,
    forceAllKinds,
    kindOverrides,
  } = args;
  const errors: string[] = [];
  let detected = 0;
  let forwarded = 0;
  let latestSeen: Date | null = null;

  const settings = await getSettings();
  const optimize =
    (settings.hikerOptimizeChangeDetection ?? "true").toLowerCase() !== "false";

  // We always need user info for cheap change-detection (and to lazily
  // populate instagramUserId). When `optimize` is on and we already
  // know the user id, this single call lets us decide whether to skip
  // posts/reels/mentioned entirely. When forceAllKinds is set (manual
  // refresh / on-add) we still want everything, so we don't gate.
  let userInfo: { id: string; fullName: string | null; mediaCount: number | null } | null = null;
  const needFreshUserInfo =
    !account.instagramUserId ||
    (optimize && !forceAllKinds);
  if (needFreshUserInfo) {
    try {
      const u = await getUserByUsername(account.username);
      userInfo = { id: u.id, fullName: u.fullName, mediaCount: u.mediaCount };
      if (!account.instagramUserId) {
        await setInstagramUserId(account.id, u.id, u.fullName).catch(() => {});
        account.fullName = u.fullName ?? account.fullName;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`resolve ${account.username}: ${msg.slice(0, 200)}`);
      // Transient upstream (Instagram flaking) — DON'T stamp
      // last_error or the row stays "errored" forever even though
      // the next cron tick would succeed on its own.
      if (err instanceof InstagramTransientError) {
        await markMonitoredChecked({ id: account.id, error: null });
      } else {
        await markMonitoredChecked({ id: account.id, error: msg.slice(0, 500) });
      }
      return { detected, forwarded, errors, latestSeen };
    }
  }
  const userId = userInfo?.id ?? account.instagramUserId;
  if (!userId) {
    errors.push(`resolve ${account.username}: no user id`);
    await markMonitoredChecked({ id: account.id, error: "no user id" });
    return { detected, forwarded, errors, latestSeen };
  }

  // Cheap change-detection: if media_count is unchanged from the last
  // tick AND nothing forces a full refresh, skip the expensive feed
  // pulls. Stories still get checked because IG stories rotate inside
  // a 24h window without changing media_count.
  const newMediaCount = userInfo?.mediaCount ?? null;
  const mediaCountChanged =
    newMediaCount == null ||
    account.lastMediaCount == null ||
    newMediaCount !== account.lastMediaCount;
  const skipFeedFetch = optimize && !forceAllKinds && !mediaCountChanged;

  const want = (key: "story" | "post" | "reel" | "mentioned"): boolean => {
    if (kindOverrides && kindOverrides[key] !== undefined)
      return Boolean(kindOverrides[key]);
    if (forceAllKinds) return true;
    // posts/reels/mentioned only need to run when media_count moved
    // (stories don't bump that counter).
    if (skipFeedFetch && (key === "post" || key === "reel" || key === "mentioned")) {
      return false;
    }
    if (key === "story") return account.checkStories;
    if (key === "post") return account.checkPosts;
    if (key === "reel") return account.checkReels;
    return account.checkMentioned;
  };
  const tasks: Array<{
    kind: MediaKind;
    fn: () => Promise<IGMedia[]>;
    limit?: number;
  }> = [];
  if (want("story"))
    tasks.push({
      kind: "story",
      fn: () => getUserStories(userId!, account.username),
      limit: storiesLimit,
    });
  if (want("post"))
    tasks.push({
      kind: "post",
      fn: () => getUserPosts(userId!, account.username),
      limit: postsLimit,
    });
  if (want("reel"))
    tasks.push({
      kind: "reel",
      fn: () => getUserReels(userId!, account.username),
      limit: reelsLimit,
    });
  if (want("mentioned"))
    tasks.push({
      kind: "mentioned",
      fn: () => getUserMentions(userId!, account.username),
      limit: mentionedLimit,
    });

  for (const task of tasks) {
    let items: IGMedia[];
    try {
      items = await task.fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof InstagramTransientError) {
        // Soft-fail this kind for this tick — next cron picks it up.
        errors.push(
          `${account.username} ${task.kind}: transient (${err.upstreamStatus}), retrying next cron`,
        );
      } else {
        errors.push(`${account.username} ${task.kind}: ${msg.slice(0, 150)}`);
      }
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
        tenantId: getCurrentTenantId(),
      });
      if (!ev) continue;
      detected++;
      try {
        const cap = captionFor({ account, kind: task.kind, media: m });
        const msgId = await sendMediaToChat({
          bot,
          chatId: target.chatId,
          media: m,
          caption: cap,
        });
        await markMonitorEventForwarded({
          id: ev.id,
          chatId: target.chatId,
          messageId: msgId,
        });
        forwarded++;
        // Channel mirror at the write site: the bot never receives its
        // OWN posts back as channel_post, so the incoming-message mirror
        // in bot.ts can't see these. Copy the same media straight into
        // any configured mirror destination for this target channel.
        for (const mr of mirrorTargetsFor(
          parseChannelMirrors(settings.channelMirrors ?? ""),
          target.chatId,
        )) {
          try {
            await sendMediaToChat({
              bot,
              chatId: mr.to,
              media: m,
              caption: cap,
              threadId: mr.threadId,
            });
          } catch (err) {
            const em = err instanceof Error ? err.message : String(err);
            errors.push(
              `mirror ${account.username} ${task.kind} → ${mr.to}: ${em.slice(0, 120)}`,
            );
          }
        }
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
    lastMediaCount: newMediaCount,
  });
  return { detected, forwarded, errors, latestSeen };
}
