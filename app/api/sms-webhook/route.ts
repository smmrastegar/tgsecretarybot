import { NextResponse } from "next/server";
import { getBot } from "@/lib/bot";
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
  const token =
    url.searchParams.get("token") ??
    request.headers.get("x-sms-token") ??
    "";
  if (!token) {
    return NextResponse.json({ error: "missing ?token" }, { status: 401 });
  }
  const webhook = await findSmsWebhookBySecret(token);
  if (!webhook) {
    return NextResponse.json(
      { error: "unknown or disabled token" },
      { status: 401 },
    );
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
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
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
    return NextResponse.json(
      { error: "missing 'text' field" },
      { status: 400 },
    );
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
