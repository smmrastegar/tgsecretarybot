import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import {
  getEmailAccountByToken,
  hasDb,
  insertEmail,
} from "@/lib/db";
import {
  emailThreadKey,
  parseInboundEmail,
  postIncomingEmailToChannel,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Resend inbound-email webhook. The ?token= (or x-webhook-token) routes
// to a specific email account (each account has its own inbound_token)
// AND authorises the request. Falls back to the global
// resendInboundSecret for single-account setups.
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDb()) return NextResponse.json({ ok: false, error: "no db" }, { status: 500 });
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? request.headers.get("x-webhook-token") ?? "";

  // Prefer a per-account token; else the global secret.
  const account = token ? await getEmailAccountByToken(token).catch(() => null) : null;
  if (!account) {
    const s = await getSettings().catch(() => null);
    const globalSecret = (s?.resendInboundSecret ?? "").trim();
    if (globalSecret && token !== globalSecret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (!globalSecret && !token) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const e = parseInboundEmail(payload);
  if (!e.fromEmail && !e.subject && !e.text && !e.html) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const id = await insertEmail({
    direction: "in",
    accountId: account?.id ?? null,
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
  return NextResponse.json({ ok: true, id, account: account?.name ?? null, posted });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "email-webhook", hint: "POST Resend inbound payload with ?token=<account inbound token>" });
}
