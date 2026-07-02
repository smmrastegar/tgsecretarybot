import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { hasDb, insertEmail } from "@/lib/db";
import {
  emailThreadKey,
  parseInboundEmail,
  postIncomingEmailToChannel,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Resend inbound-email webhook. Auth is a shared token in ?token= (or
// the x-webhook-token header) matched against resendInboundSecret so
// nobody can inject fake emails.
export async function POST(request: Request): Promise<NextResponse> {
  const s = await getSettings().catch(() => null);
  const secret = (s?.resendInboundSecret ?? "").trim();
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? request.headers.get("x-webhook-token") ?? "";
  if (secret && token !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) return NextResponse.json({ ok: false, error: "no db" }, { status: 500 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const e = parseInboundEmail(payload);
  // Ignore non-email events (Resend sends delivery/bounce webhooks too).
  if (!e.fromEmail && !e.subject && !e.text && !e.html) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const id = await insertEmail({
    direction: "in",
    messageId: e.messageId,
    inReplyTo: e.inReplyTo,
    threadKey: emailThreadKey(e.subject),
    fromEmail: e.fromEmail,
    fromName: e.fromName,
    toEmails: e.toEmails,
    ccEmails: e.ccEmails,
    subject: e.subject,
    textBody: e.text,
    htmlBody: e.html,
  });
  const posted = await postIncomingEmailToChannel(id).catch(() => ({ ok: false, chatId: null }));
  return NextResponse.json({ ok: true, id, posted });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "email-webhook", hint: "POST Resend inbound payload with ?token=<secret>" });
}
