import { NextResponse } from "next/server";
import { getBot, maybeApplyNoteWatch } from "@/lib/bot";
import {
  findSmsWebhookBySecret,
  hasDb,
  logMessage,
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
    console.warn(`[sms-webhook] no token in request from ${request.headers.get("user-agent") ?? "?"}`);
    return NextResponse.json({
      ok: false,
      error: "missing ?token query param",
    });
  }
  const webhook = await findSmsWebhookBySecret(token);
  if (!webhook) {
    console.warn(`[sms-webhook] token "${token.slice(0, 6)}…" not found or webhook disabled`);
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
    console.warn(
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
      console.error("[sms-webhook] log failed:", err);
    }
  }
  await touchSmsWebhook(webhook.id).catch(() => {});

  const bot = getBot();
  try {
    await routeSmsForward({
      bot,
      sourceChatId: chatId,
      sourceMessageId: logId || 0,
      text,
      // Webhook name is the operator-chosen label for THIS source
      // (e.g. "📱 پیامک مرضیه"). Used in the forward header when
      // findOwnerOfPhone can't resolve the actual contact.
      sourceLabel: webhook.name,
      // The text arrived through THIS SMS channel, so even when it
      // doesn't carry a ☎️/📱 prefix we still want it routed into
      // the sms_inbox — that's the whole point of the webhook.
      allowNoHeader: true,
    });
  } catch (err) {
    console.warn("[sms-webhook] route failed:", err);
  }
  if (logId) {
    try {
      const { extractOtpCodeAi } = await import("@/lib/rules");
      const { saveOtpCode } = await import("@/lib/db");
      const code = await extractOtpCodeAi(text);
      if (code) await saveOtpCode(logId, code);
    } catch (err) {
      console.warn("[sms-webhook] otp extract failed:", err);
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
      console.warn("[sms-webhook] watchlist scan failed:", err);
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
