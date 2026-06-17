import { NextResponse } from "next/server";
import { InlineKeyboard } from "grammy";
import { config } from "@/lib/config";
import { getCurrentSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import {
  debugFollowUpScan,
  hasDb,
  listChatsByFunction,
  listFollowUpCandidates,
  recordChatFollowUpPing,
} from "@/lib/db";
import { listTenants } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron handler: scan every tenant's private chats for "you didn't
// reply to this person in X hours" and post a notice into the
// tenant's notes_inbox channel. Runs alongside the same auth
// model as the other cron routes — Bearer secret OR session.
async function authorized(request: Request): Promise<boolean> {
  const session = await getCurrentSession().catch(() => null);
  if (session) return true;
  const secret = config.cronSecret;
  if (!secret) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

function displayName(c: {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  chatTitle: string | null;
  chatId: number;
}): string {
  return (
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.nickname ||
    c.chatTitle ||
    `chat ${c.chatId}`
  );
}

async function processTenant(tenantId: number) {
  return runWithTenant(tenantId, async () => {
    const inboxes = await listChatsByFunction("notes_inbox", tenantId).catch(
      () => [],
    );
    const inbox = inboxes[0];
    if (!inbox) return { tenantId, pinged: 0, skipped: "no notes_inbox" };
    const candidates = await listFollowUpCandidates({ tenantId });
    const bot = getBot();
    let pinged = 0;
    for (const c of candidates) {
      const kind: "first" | "escalate" =
        c.lastPingAt == null ? "first" : "escalate";
      const hoursSince =
        (Date.now() - c.lastCustomerMessageAt.getTime()) / 3600_000;
      const headerEmoji = kind === "escalate" ? "🚨" : "⏰";
      const headerLabel =
        kind === "escalate"
          ? `بیش از ${c.escalateHours.toFixed(0)} ساعت دیگه گذشته و هنوز جواب ندادی`
          : `بیش از ${c.thresholdHours.toFixed(0)} ساعت هست جواب ندادی`;
      const preview =
        c.lastCustomerMessageText.slice(0, 220).replace(/\s+/g, " ") ||
        "(پیام بدون متن)";
      const text =
        `${headerEmoji} <b>${headerLabel}</b>\n` +
        `👤 <b>${escHtml(displayName(c))}</b>` +
        ` · ${c.pendingCustomerMessageCount} پیام منتظر جواب` +
        `\n⏱ ${Math.round(hoursSince)} ساعت پیش\n\n` +
        `💬 «${escHtml(preview)}»`;
      const kb = new InlineKeyboard()
        .url("📨 پیام", `tg://user?id=${c.chatId}`)
        .text("✅ متوجه شدم", `fu:ack:${c.chatId}`);
      try {
        await bot.api.sendMessage(inbox.chatId, text.slice(0, 4096), {
          parse_mode: "HTML",
          reply_markup: kb,
        });
        await recordChatFollowUpPing({ chatId: c.chatId, kind });
        pinged++;
      } catch (err) {
        console.warn(
          `[follow-up] notice send failed chat=${c.chatId}:`,
          err,
        );
      }
    }
    return { tenantId, pinged, candidates: candidates.length };
  });
}

async function run(request: Request): Promise<NextResponse> {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";
  const tenants = (await listTenants()).filter((t) => t.isEnabled);
  if (debug) {
    const out: unknown[] = [];
    for (const t of tenants) {
      const rows = await runWithTenant(t.id, () =>
        debugFollowUpScan({ tenantId: t.id }),
      );
      const buckets: Record<string, number> = {};
      for (const r of rows) buckets[r.decided] = (buckets[r.decided] ?? 0) + 1;
      out.push({
        tenantId: t.id,
        totalChats: rows.length,
        buckets,
        chats: rows.map((r) => ({
          chatId: r.chatId,
          name:
            [r.firstName, r.lastName].filter(Boolean).join(" ").trim() ||
            r.nickname ||
            r.chatTitle ||
            null,
          decided: r.decided,
          hoursSinceCustomer:
            r.hoursSinceCustomer == null
              ? null
              : Number(r.hoursSinceCustomer.toFixed(2)),
          thresholdHours: r.thresholdHours,
          escalateHours: r.escalateHours,
          followUpEnabled: r.followUpEnabled,
          muted: r.muted,
          ignored: r.ignored,
          isBot: r.isBot,
          lastCustomerMessageAt: r.lastCustomerMessageAt,
          lastOwnerMessageAt: r.lastOwnerMessageAt,
          lastPingAt: r.lastPingAt,
          lastPingKind: r.lastPingKind,
          ackedAt: r.ackedAt,
        })),
      });
    }
    return NextResponse.json({ ok: true, debug: true, tenants: out });
  }
  const results = [];
  for (const t of tenants) {
    try {
      results.push(await processTenant(t.id));
    } catch (err) {
      results.push({
        tenantId: t.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return NextResponse.json({ ok: true, tenants: results });
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
