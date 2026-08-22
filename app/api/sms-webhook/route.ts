import { NextResponse } from "next/server";
import { reportError, reportWarn } from "@/lib/report";
import { getBot, maybeApplyNoteWatch } from "@/lib/bot";
import { classifyPrivateSms } from "@/lib/classifier";
import {
  findSmsWebhookBySecret,
  hasDb,
  logMessage,
  markMessagePrivate,
  recentSmsLogId,
  touchSmsWebhook,
} from "@/lib/db";
import { detectSmsForward, routeSmsForward } from "@/lib/sms-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Drop-in webhook for the SMS-Forwarder Android app — multi-source
// edition. Each row in sms_webhooks owns its own secret token and
// display name; the URL the operator pastes into the app's "Webhook
// URL" field embeds the token. The webhook's `name` becomes the
// chat_title on every logged message so /messages shows them as a
// coherent per-source stream ("📱 Mahdi's SIM 1" / "📱 Office line"
// / etc.).
//
// We refuse 401 when the token doesn't resolve to an enabled
// webhook — never run as an open relay.
async function handle(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // Diagnostic ping: GET /api/sms-webhook (no token, no body) returns
  // a 200 echo so the operator can sanity-check that the route is
  // deployed before pointing the Android app at it.
  if (
    request.method === "GET" &&
    !url.searchParams.get("token") &&
    !url.searchParams.get("text")
  ) {
    return NextResponse.json({
      ok: true,
      service: "sms-webhook",
      // Bump on intentional behaviour changes so the operator can
      // tell from a curl whether the latest commit is actually live.
      version: 2,
      hint: "POST with ?token=<secret> + {text, chat_id} body. Manage tokens at /webhooks.",
      deployedAt: new Date().toISOString(),
    });
  }
  const token =
    url.searchParams.get("token") ??
    request.headers.get("x-sms-token") ??
    "";
  // Return 200 (not 401) for every auth/validation failure so the
  // Android SMS-Forwarder app — which interprets any 4xx as a fatal
  // error and chains 10-retry loops — doesn't spin on a misconfig
  // we can fix in the dashboard. The body carries ok:false + a
  // reason so curl-based debugging still sees the problem.
  if (!token) {
    reportWarn("sms-webhook", `[sms-webhook] no token in request from ${request.headers.get("user-agent") ?? "?"}`);
    return NextResponse.json({
      ok: false,
      error: "missing ?token query param",
    });
  }
  const webhook = await findSmsWebhookBySecret(token);
  if (!webhook) {
    reportWarn("sms-webhook", `[sms-webhook] token "${token.slice(0, 6)}…" not found or webhook disabled`);
    return NextResponse.json({
      ok: false,
      error: "unknown or disabled token — create one at /webhooks",
    });
  }

  let body: Record<string, unknown> = {};
  const ctype = request.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("application/json")) {
      body = (await request.json()) as Record<string, unknown>;
    } else if (ctype.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      body = Object.fromEntries(form);
    } else {
      const raw = await request.text();
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = { text: raw };
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" });
  }

  const text =
    typeof body.text === "string"
      ? body.text
      : typeof body.message === "string"
        ? (body.message as string)
        : typeof body.payload === "string"
          ? (body.payload as string)
          : "";
  if (!text.trim()) {
    reportWarn("sms-webhook", 
      `[sms-webhook] webhook=${webhook.name} got empty text; body keys=${Object.keys(body).join(",")}`,
    );
    return NextResponse.json({ ok: false, error: "missing 'text' field" });
  }
  const payloadChatId =
    typeof body.chat_id === "string"
      ? Number(body.chat_id)
      : typeof body.chat_id === "number"
        ? body.chat_id
        : NaN;
  const chatId = Number.isFinite(payloadChatId) ? payloadChatId : 0;
  const chatTitle = webhook.name;

  const parsed = detectSmsForward(text);
  const senderName = parsed ? parsed.phone : "SMS";

  // Dedupe: the SMS-Forwarder app retries on slow/failed responses and
  // some carriers re-deliver the same SMS, so a single user-visible
  // message can hit this webhook 2-4 times within seconds. logMessage's
  // own dedup keys off (chat_id, message_id) and we mint a fresh
  // message_id per call — so it never catches these. Here we check for
  // an identical body from the same webhook chat in the last 2 minutes
  // and short-circuit if so (returning 200+duplicate so the app stops
  // retrying).
  if (hasDb()) {
    const dupId = await recentSmsLogId({
      chatId,
      text,
      sourceLike: `sms_webhook:${webhook.id}`,
      withinSeconds: 120,
    }).catch(() => 0);
    if (dupId) {
      await touchSmsWebhook(webhook.id).catch(() => {});
      return NextResponse.json({
        ok: true,
        duplicate: true,
        logId: dupId,
        webhook: { id: webhook.id, name: webhook.name },
      });
    }
  }

  let logId = 0;
  if (hasDb()) {
    try {
      logId = await logMessage({
        businessConnectionId: null,
        ownerUserId: null,
        chatId,
        chatType: "private",
        chatTitle,
        senderId: null,
        senderUsername: null,
        senderName,
        messageId: Date.now() & 0x7fffffff,
        messageText: text,
        importance: 0,
        urgent: false,
        concernsOwner: false,
        reason: `sms_webhook:${webhook.id}`,
        alerted: false,
        autoReplied: false,
        fromOwner: false,
        source: "sms_webhook",
      });
    } catch (err) {
      reportError("sms-webhook", "[sms-webhook] log failed:", err);
    }
  }
  await touchSmsWebhook(webhook.id).catch(() => {});

  // Privacy classifier (only when the webhook has opted in). Runs
  // BEFORE forwarding so the inbox copy starts redacted and the
  // dashboard row knows to hide the body too.
  let isPrivate = false;
  let privacyReason = "";
  if (webhook.redactPrivate && logId) {
    const phoneForGate = parsed?.phone ?? senderName;
    const verdict = await classifyPrivateSms({
      phone: phoneForGate,
      body: text,
    }).catch(() => null);
    if (verdict?.isPrivate) {
      isPrivate = true;
      privacyReason = verdict.reason;
      await markMessagePrivate(logId).catch(() => {});
    }
  }

  const bot = getBot();
  try {
    await routeSmsForward({
      bot,
      sourceChatId: chatId,
      sourceMessageId: logId || 0,
      text,
      sourceLabel: webhook.name,
      allowNoHeader: true,
      privateConversation: isPrivate ? { logId, reason: privacyReason } : null,
    });
  } catch (err) {
    reportWarn("sms-webhook", "[sms-webhook] route failed:", err);
  }
  if (logId) {
    try {
      const { extractOtpCodeAi } = await import("@/lib/rules");
      const { saveOtpCode } = await import("@/lib/db");
      const code = await extractOtpCodeAi(text);
      if (code) await saveOtpCode(logId, code);
    } catch (err) {
      reportWarn("sms-webhook", "[sms-webhook] otp extract failed:", err);
    }
    // Watchlist scan on the SMS body too — concepts like "بانک
    // ملت" / "اعلام رفع تعهد" / etc. now trigger the same
    // chat_notes + notes_inbox forwarding the operator gets on
    // Telegram messages. Awaited for the same reason as in bot.ts
    // — Vercel kills void-dispatched promises before the LLM call
    // returns.
    try {
      await maybeApplyNoteWatch({
        logId,
        text,
        chatId,
        chatTitle,
        senderName,
        messageId: Date.now() & 0x7fffffff,
        businessConnectionId: null,
        bot,
      });
    } catch (err) {
      reportWarn("sms-webhook", "[sms-webhook] watchlist scan failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    logId,
    parsed,
    webhook: { id: webhook.id, name: webhook.name },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
