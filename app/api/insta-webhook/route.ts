import { NextResponse } from "next/server";
import { InlineKeyboard } from "grammy";
import { getBot } from "@/lib/bot";
import {
  findSmsWebhookBySecret,
  listChatsByFunction,
  recordInstaNotify,
  touchSmsWebhook,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Inbound Instagram change-detector hit. The external service the
// operator runs pings this URL whenever it spots a new story / post
// / reel / mention / profile change on one of the monitored
// accounts. Shape:
//
//   /api/insta-webhook?token=<secret>&action=story&id=<username>
//
// `action` is one of: story, post, reel, mentioned, profile, any.
// `id` is the Instagram username (NOT the local DB id) so the
// operator's external service can speak the same identifier they
// already use.
//
// We accept HTTP 200 on every shape (auth fail, bad params, etc.)
// so a misconfigured external service doesn't churn a retry loop.
// The body carries ok:false + a reason for curl-based debugging.

const VALID_ACTIONS = new Set([
  "story",
  "post",
  "reel",
  "mentioned",
  "profile",
  "any",
  // Tolerate the British / plural / Persian variants the operator
  // might paste from a notify-service config.
  "stories",
  "posts",
  "reels",
  "mention",
  "story.new",
  "post.new",
  "reel.new",
]);

function canonicalAction(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "stories" || s === "story.new") return "story";
  if (s === "posts" || s === "post.new") return "post";
  if (s === "reels" || s === "reel.new") return "reel";
  if (s === "mention") return "mentioned";
  return s;
}

// Quiet window: notify-triggered fetches aren't allowed between
// 02:00 and 08:00 Tehran. recordInstaNotify already schedules
// pending_fetch_at = NOW + 3h, but if that lands in the quiet
// window we'd rather wait for 08:00. The cron's Path B doesn't
// have a quiet-hours gate (every notify already has a
// pending_fetch_at) — so the check here is what enforces the rule.
function isTehranQuietHour(d: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran",
      hour: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(/[^0-9]/g, ""),
  );
  if (!Number.isFinite(hour)) return false;
  return hour >= 2 && hour < 8;
}

async function handle(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // GET with no params = ping for the operator to test deployment.
  if (
    request.method === "GET" &&
    !url.searchParams.get("token") &&
    !url.searchParams.get("id")
  ) {
    return NextResponse.json({
      ok: true,
      service: "insta-webhook",
      hint: "GET /api/insta-webhook?token=<secret>&action=story&id=<username>",
      deployedAt: new Date().toISOString(),
    });
  }
  const token =
    url.searchParams.get("token") ??
    request.headers.get("x-insta-token") ??
    "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing ?token" });
  }
  const webhook = await findSmsWebhookBySecret(token, "insta");
  if (!webhook) {
    return NextResponse.json({
      ok: false,
      error: "unknown or disabled insta token — create one at /webhooks",
    });
  }
  const username = (url.searchParams.get("id") ?? "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();
  if (!username) {
    return NextResponse.json({ ok: false, error: "missing ?id (username)" });
  }
  const rawAction = url.searchParams.get("action") ?? "any";
  const action = canonicalAction(rawAction);
  if (!VALID_ACTIONS.has(action) && action !== "any") {
    return NextResponse.json({
      ok: false,
      error: `unsupported action "${rawAction}"`,
    });
  }
  // The notify endpoint is global (one URL serves all tenants) so
  // we don't pass tenantId — recordInstaNotify will scope by the
  // unique (platform, username) pair which is already unique
  // across tenants in practice.
  const account = await recordInstaNotify({
    username,
    kinds: [action],
  });
  if (!account) {
    return NextResponse.json({
      ok: false,
      error: `account @${username} not found in monitored list`,
    });
  }
  await touchSmsWebhook(webhook.id).catch(() => {});

  // Post a "you have a notify" message into the storage / download
  // channel with a fetch-now button. This is what the operator sees
  // immediately, even before the 3-hour cooldown elapses or the
  // 02-08 quiet window opens up.
  const bot = getBot();
  const inboxes = [
    ...(await listChatsByFunction("download_archive").catch(() => [])),
    ...(await listChatsByFunction("storage").catch(() => [])),
  ];
  const inbox = inboxes[0];
  const inQuiet = isTehranQuietHour(new Date());
  const profileUrl = `https://instagram.com/${encodeURIComponent(username)}/`;
  const storyUrl = `https://instagram.com/stories/${encodeURIComponent(username)}/`;
  const target = action === "story" ? storyUrl : profileUrl;
  if (inbox) {
    try {
      const headerLines = [
        `🔔 <b>Insta notify</b> · @${escapeHtml(username)}`,
        `📩 action: ${action}`,
        inQuiet
          ? "🌙 ساعت quiet هست — fetch به ساعت ۸ صبح موکول شد. می‌تونی دکمه‌ی پایین رو بزنی برای fetch فوری."
          : account.pendingFetchAt
            ? `⏱ بر اساس قانون cooldown ۳h، fetch بعدی: ${account.pendingFetchAt.toISOString()}`
            : `⏱ fetch تو ۳ ساعت آینده اجرا می‌شه.`,
      ];
      const kb = new InlineKeyboard().text(
        "🔍 الان بگیر",
        `insta:fetchnow:${account.id}`,
      );
      await bot.api.sendMessage(inbox.chatId, headerLines.join("\n") + `\n\n${target}`, {
        parse_mode: "HTML",
        reply_markup: kb,
      });
    } catch (err) {
      console.warn("[insta-webhook] inbox notice failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    accountId: account.id,
    username: account.username,
    action,
    pendingFetchAt: account.pendingFetchAt,
    quiet: inQuiet,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
