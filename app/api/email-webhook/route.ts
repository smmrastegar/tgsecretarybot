import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import {
  getEmailAccountByRecipientDomain,
  getEmailAccountByToken,
  hasDb,
  insertEmail,
} from "@/lib/db";
import {
  emailThreadKey,
  fetchReceivedEmailBody,
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
  if (!e.fromEmail && !e.subject && !e.text && !e.html && !e.emailId) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  // If the webhook wasn't scoped by a per-account token, link the mail
  // to an account by its recipient domain (e.g. admin@rateklend.ir →
  // the RatekLend account) so its card opens on that account's domain.
  const matchedAccount =
    account ?? (await getEmailAccountByRecipientDomain(e.toEmails).catch(() => null));
  // Resend's inbound webhook is metadata-only — the body lives behind
  // the Received Emails API. Fetch it with the account's (or global)
  // Resend key.
  let text = e.text;
  let html = e.html;
  let attachments = e.attachments;
  if ((!text && !html || attachments.length === 0) && e.emailId) {
    const s = await getSettings().catch(() => null);
    const apiKey = (matchedAccount?.resendApiKey || s?.resendApiKey || "").trim();
    const body = await fetchReceivedEmailBody(apiKey, e.emailId);
    if (body) {
      if (!text && !html) {
        text = body.text;
        html = body.html;
      }
      if (attachments.length === 0) attachments = body.attachments;
    }
  }
  const id = await insertEmail({
    direction: "in",
    accountId: matchedAccount?.id ?? null,
    resendId: e.emailId,
    messageId: e.messageId,
    inReplyTo: e.inReplyTo,
    threadKey: emailThreadKey(e.subject),
    fromEmail: e.fromEmail,
    fromName: e.fromName,
    toEmails: e.toEmails,
    ccEmails: e.ccEmails,
    subject: e.subject,
    textBody: text,
    htmlBody: html,
    attachments,
  });
  const posted = await postIncomingEmailToChannel(id).catch(() => ({ ok: false, chatId: null }));
  return NextResponse.json({ ok: true, id, account: matchedAccount?.name ?? null, posted });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "email-webhook", hint: "POST Resend inbound payload with ?token=<account inbound token>" });
}
