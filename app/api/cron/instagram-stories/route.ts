import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  dueMonitoredAccounts,
  hasDb,
  listChatsByFunction,
  markMonitorEventForwarded,
  markMonitoredChecked,
  recordMonitorEvent,
  setInstagramUserId,
  type MonitoredAccount,
} from "@/lib/db";
import {
  getUserByUsername,
  getUserPosts,
  getUserReels,
  getUserStories,
  type IGMedia,
} from "@/lib/hikerapi";
import { getBot } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}

function captionFor(args: {
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

async function sendOne(args: {
  bot: ReturnType<typeof getBot>;
  chatId: number;
  media: IGMedia;
  caption: string;
}): Promise<number> {
  const { bot, chatId, media, caption } = args;
  // Carousel posts: send the first item with caption, rest follow.
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

async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  if (!config.hikerApiKey) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured" },
      { status: 503 },
    );
  }
  // Storage chat is the FIRST priority — that's where downloaded
  // media should land. Downloader (legacy) is a fallback.
  const storages = await listChatsByFunction("storage");
  const downloaders = await listChatsByFunction("downloader");
  const target = storages[0] ?? downloaders[0] ?? null;
  if (!target) {
    return NextResponse.json(
      {
        error:
          "No chat tagged as 'storage' or 'downloader'. Set one on /chats/[id] → Function role.",
      },
      { status: 412 },
    );
  }

  const due = await dueMonitoredAccounts(30);
  const bot = getBot();
  let checked = 0;
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];

  for (const acc of due) {
    checked++;
    try {
      // Resolve user id once and cache.
      let userId = acc.instagramUserId;
      if (!userId) {
        const u = await getUserByUsername(acc.username);
        userId = u.id;
        await setInstagramUserId(acc.id, userId).catch(() => {});
      }

      const tasks: Array<{ kind: "story" | "post" | "reel"; fn: () => Promise<IGMedia[]> }> = [];
      if (acc.checkStories)
        tasks.push({
          kind: "story",
          fn: () => getUserStories(userId!, acc.username),
        });
      if (acc.checkPosts)
        tasks.push({
          kind: "post",
          fn: () => getUserPosts(userId!, acc.username),
        });
      if (acc.checkReels)
        tasks.push({
          kind: "reel",
          fn: () => getUserReels(userId!, acc.username),
        });

      let latestSeen: Date | null = null;
      for (const task of tasks) {
        let items: IGMedia[];
        try {
          items = await task.fn();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${acc.username} ${task.kind}: ${msg.slice(0, 150)}`);
          continue;
        }
        for (const m of items) {
          if (!latestSeen || m.takenAt > latestSeen) latestSeen = m.takenAt;
          const eventKey = `${task.kind}:${m.id}`;
          const caption = captionFor({ account: acc, kind: task.kind, media: m });
          const ev = await recordMonitorEvent({
            accountId: acc.id,
            storyId: eventKey,
            storyUrl: m.permalink ?? m.mediaUrl,
            kind: task.kind,
            caption,
            mediaType: m.mediaType,
          });
          if (!ev) continue;
          detected++;
          try {
            const msgId = await sendOne({
              bot,
              chatId: target.chatId,
              media: m,
              caption,
            });
            await markMonitorEventForwarded({
              id: ev.id,
              chatId: target.chatId,
              messageId: msgId,
            });
            forwarded++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`forward ${acc.username} ${task.kind}: ${msg.slice(0, 150)}`);
          }
        }
      }

      await markMonitoredChecked({
        id: acc.id,
        lastStoryAt: latestSeen,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${acc.username}: ${msg.slice(0, 200)}`);
      await markMonitoredChecked({ id: acc.id, error: msg.slice(0, 500) });
    }
  }

  return NextResponse.json({
    ok: true,
    checked,
    detected,
    forwarded,
    target: target.chatId,
    errors: errors.slice(0, 20),
  });
}
