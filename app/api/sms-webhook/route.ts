import { NextResponse } from "next/server";
import { getBot } from "@/lib/bot";
import { hasDb, logMessage } from "@/lib/db";
import { detectSmsForward, routeSmsForward } from "@/lib/sms-router";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Drop-in webhook for the SMS-Forwarder Android app. The operator
// only changes the "Webhook URL" field in the app — chat_id / text /
// payload template / headers all stay as-is. We accept their JSON,
// extract the SMS body (which already starts with "☎️+PHONE\n…"
// thanks to their template), log it into messages_log so it shows
// up in /messages, and run the same routing pipeline used for
// channel-post SMS — LLM gate + owner lookup + forward to every
// chat tagged sms_inbox.
//
// Auth: ?token=<smsWebhookSecret> (set in /settings/edit). If the
// secret isn't configured we refuse — never run as an open relay.
async function handle(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const settings = await getSettings();
  const secret = (settings.smsWebhookSecret ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "smsWebhookSecret not configured — set it in /settings/edit first",
      },
      { status: 503 },
    );
  }
  const provided =
    url.searchParams.get("token") ??
    request.headers.get("x-sms-token") ??
    "";
  if (provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Read the payload as JSON. Fall back to form-encoded or raw text
  // because not every SMS-forwarder build sends JSON cleanly.
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
  // chat_id from the payload (or anything we can coerce to a number)
  // is used as the synthetic source chat_id so /messages and /chats
  // can show these forwards as a coherent stream. The app's default
  // is the operator's own user id, which works fine — it just means
  // the forwards show up "in" Mahdi's own DM in the dashboard.
  const payloadChatId =
    typeof body.chat_id === "string"
      ? Number(body.chat_id)
      : typeof body.chat_id === "number"
        ? body.chat_id
        : NaN;
  const chatId = Number.isFinite(payloadChatId) ? payloadChatId : 0;
  const chatTitle =
    settings.smsWebhookChatTitle?.trim() || "📱 SMS Forwarder";

  // Pre-parse the SMS so we can stamp the sender name with the
  // resolved phone — improves the /messages listing UX even before
  // routing fires.
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
        // We don't get a stable per-SMS id from the forwarder — use
        // the current millisecond as a monotonic placeholder. The
        // (chatId, messageId) pair on messages_log only dedupes
        // within the same request anyway.
        messageId: Date.now() & 0x7fffffff,
        messageText: text,
        importance: 0,
        urgent: false,
        concernsOwner: false,
        reason: "sms webhook",
        alerted: false,
        autoReplied: false,
        fromOwner: false,
        source: "sms_webhook",
      });
    } catch (err) {
      console.error("[sms-webhook] log failed:", err);
    }
  }

  // Run the same downstream as channel/group SMS — gate via LLM,
  // resolve owner, forward to sms_inbox, extract OTP for tap-to-copy
  // chip, evaluate rules.
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

  return NextResponse.json({ ok: true, logId, parsed });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
