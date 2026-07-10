import { NextResponse } from "next/server";
import { InlineKeyboard } from "grammy";
import { config } from "@/lib/config";
import { getCurrentSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";

const TRANSCRIBABLE_KINDS = ["voice", "audio", "video_note"] as const;

// On-demand: find recent voice/audio in this chat without transcripts
// and transcribe them. Used only when the follow-up profile/setting
// opts in — it costs an STT call per untranscribed voice.
async function transcribeRecentVoices(
  chatId: number,
  language: string,
  limit = 10,
): Promise<{ done: number; failed: number }> {
  const rows = (await sql()`
    SELECT id, media_file_id
    FROM messages_log
    WHERE chat_id = ${chatId}
      AND media_file_id IS NOT NULL
      AND media_kind = ANY(${TRANSCRIBABLE_KINDS as readonly string[]}::text[])
      AND transcript IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
    LIMIT ${limit}`) as Array<{ id: string; media_file_id: string }>;
  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const result = await transcribeAudio({
        botToken: config.telegramBotToken,
        fileId: r.media_file_id,
        language,
      });
      await saveTranscript(Number(r.id), result.text);
      done++;
    } catch (err) {
      console.warn(`[follow-up] transcribe msg=${r.id} failed:`, err);
      failed++;
    }
  }
  return { done, failed };
}
import {
  captureError,
  debugFollowUpScan,
  hasDb,
  listChatsByFunction,
  listFollowUpCandidates,
  recentConversation,
  recordChatFollowUpPing,
  removeChatFunctionRole,
  saveTranscript,
  setFollowUpAiVerdict,
  sql,
} from "@/lib/db";
import { analyzeFollowUpNeed } from "@/lib/classifier";
import { transcribeAudio } from "@/lib/stt";
import { getSettings } from "@/lib/settings";
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
  if (!secret) return false; // fail closed: unset secret = locked, not open
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
    // 10 oldest-waiting candidates that passed threshold + filters.
    const candidates = await listFollowUpCandidates({ tenantId });
    const bot = getBot();
    let pinged = 0;
    let aiSkipped = 0;
    let aiAnalyzed = 0;
    const errors: Array<{ chatId: number; error: string }> = [];
    for (const c of candidates) {
      // AI verdict: cached against last_customer_message_at. Stale or
      // missing → run AI on the conversation now.
      let needsReply: boolean;
      let aiReason: string;
      let aiUrgency: "low" | "normal" | "high" = "normal";
      const cacheFresh =
        c.aiForMessageAt != null &&
        c.aiNeedsReply != null &&
        c.aiForMessageAt.getTime() >= c.lastCustomerMessageAt.getTime();
      if (cacheFresh) {
        needsReply = c.aiNeedsReply === true;
        aiReason = c.aiReason ?? "(cached)";
        aiUrgency = c.aiUrgency ?? "normal";
      } else {
        // Optionally transcribe untranscribed recent voices in this
        // chat before we hand the conversation to the AI judge.
        if (c.transcribeVoices) {
          const settings = await getSettings();
          const lang = settings.sttLanguage || "fa";
          const { done, failed } = await transcribeRecentVoices(
            c.chatId,
            lang,
            10,
          );
          if (done > 0 || failed > 0) {
            console.log(
              `[follow-up] transcribed chat=${c.chatId} done=${done} failed=${failed}`,
            );
          }
        }
        const conversation = await recentConversation(c.chatId, 30).catch(
          () => [],
        );
        const verdict = await analyzeFollowUpNeed({
          chatId: c.chatId,
          contactName: displayName(c),
          messages: conversation.map((m) => ({
            fromOwner: m.from === "owner",
            senderName: m.senderName,
            text: m.text,
            at: m.at,
          })),
        });
        if (!verdict) {
          // AI failed — fall back to "needs reply" (better to nudge
          // than silently drop).
          needsReply = true;
          aiReason = "(تحلیل AI شکست خورد — fallback به needs_reply)";
        } else {
          needsReply = verdict.needsReply;
          aiReason = verdict.reason;
          aiUrgency = verdict.urgency;
          await setFollowUpAiVerdict({
            chatId: c.chatId,
            forMessageAt: c.lastCustomerMessageAt,
            needsReply: verdict.needsReply,
            reason: verdict.reason,
            urgency: verdict.urgency,
          }).catch((err) =>
            console.warn(`[follow-up] cache verdict failed:`, err),
          );
        }
        aiAnalyzed++;
      }
      if (!needsReply) {
        aiSkipped++;
        console.log(
          `[follow-up] ai_skip chat=${c.chatId} reason="${aiReason}"`,
        );
        continue;
      }
      const kind: "first" | "escalate" =
        c.lastPingAt == null ? "first" : "escalate";
      const hoursSince =
        (Date.now() - c.lastCustomerMessageAt.getTime()) / 3600_000;
      const urgencyEmoji =
        aiUrgency === "high" ? "🔥" : aiUrgency === "low" ? "🟢" : "🟡";
      const headerEmoji = kind === "escalate" ? "🚨" : "⏰";
      const headerLabel =
        kind === "escalate"
          ? `بیش از ${c.escalateHours.toFixed(0)} ساعت دیگه گذشته`
          : `جواب می‌خواد`;
      const preview =
        c.lastCustomerMessageText.slice(0, 220).replace(/\s+/g, " ") ||
        "(پیام بدون متن)";
      const nameLink = `<a href="tg://user?id=${c.chatId}">${escHtml(displayName(c))}</a>`;
      const text =
        `${headerEmoji} <b>${headerLabel}</b> ${urgencyEmoji}\n` +
        `👤 <b>${nameLink}</b>` +
        ` · ${c.pendingCustomerMessageCount} پیام منتظر\n` +
        `⏱ ${Math.round(hoursSince)} ساعت پیش\n\n` +
        `🤖 ${escHtml(aiReason)}\n\n` +
        `💬 «${escHtml(preview)}»`;
      const kb = new InlineKeyboard().text(
        "✅ متوجه شدم",
        `fu:ack:${c.chatId}`,
      );
      try {
        await bot.api.sendMessage(inbox.chatId, text.slice(0, 4096), {
          parse_mode: "HTML",
          reply_markup: kb,
        });
        await recordChatFollowUpPing({ chatId: c.chatId, kind });
        pinged++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[follow-up] notice send failed chat=${c.chatId}:`, err);
        errors.push({ chatId: c.chatId, error: msg.slice(0, 300) });

        // Detect inbox-level failures (bot can't post to notes_inbox
        // at all). Catching this FIRST avoids spamming a per-chat
        // error log when the real issue is a misconfigured inbox.
        const inboxBroken =
          /bot can't initiate conversation/i.test(msg) ||
          /bot was blocked by the user/i.test(msg) ||
          /chat not found/i.test(msg) ||
          /not enough rights/i.test(msg) ||
          /forbidden/i.test(msg);

        if (inboxBroken) {
          // One-shot self-heal: drop the broken inbox's notes_inbox
          // role so subsequent ticks don't re-spam the system log.
          // Operator gets a SINGLE persistent warning pointing them
          // at how to reconfigure (channel/group + admin bot).
          // Logged at "warn" level — the system handled it without
          // losing data; the only thing the operator needs to do is
          // pick a real channel.
          const removed = await removeChatFunctionRole(
            inbox.chatId,
            "notes_inbox",
          ).catch(() => 0);
          await captureError({
            source: "cron:follow-up",
            level: "warn",
            error: new Error(
              `notes_inbox chat ${inbox.chatId} not reachable — auto-removed from notes_inbox role (${removed} rows). Remaining ${candidates.length - pinged - errors.length} candidates skipped this tick. Original error: ${msg}`,
            ),
            scope: `tenant=${tenantId}`,
            details: {
              inboxChatId: inbox.chatId,
              autoRemoved: removed > 0,
              hint: "channel/group بساز، bot رو توش admin کن، بعد توی /functions اون چت رو به‌عنوان notes_inbox ست کن.",
            },
          });
          break;
        }

        // Real per-chat failure (chat-specific permission, rate
        // limit, ...) — log it so the operator can investigate the
        // individual chat without the noise of inbox-level errors.
        await captureError({
          source: "cron:follow-up",
          error: err,
          scope: `chat=${c.chatId}`,
          details: {
            inboxChatId: inbox.chatId,
            kind,
            aiReason,
          },
        });
      }
    }
    return {
      tenantId,
      pinged,
      candidates: candidates.length,
      aiAnalyzed,
      aiSkipped,
      ...(errors.length > 0 ? { errors } : {}),
    };
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
          lastOwnerMsgOnlyAt: r.lastOwnerMsgOnlyAt,
          lastReactionAt: r.lastReactionAt,
          reactionsTotal: r.reactionsTotal,
          lastAnyMessageAt: r.lastAnyMessageAt,
          messagesLast24h: r.messagesLast24h,
          lastPingAt: r.lastPingAt,
          lastPingKind: r.lastPingKind,
          ackedAt: r.ackedAt,
          aiForMessageAt: r.aiForMessageAt,
          aiVerdictAt: r.aiVerdictAt,
          aiNeedsReply: r.aiNeedsReply,
          aiReason: r.aiReason,
          aiUrgency: r.aiUrgency,
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
      void captureError({
        source: "cron:follow-up",
        error: err,
        scope: `tenant=${t.id}`,
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
