import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import {
  findEmailByResendId,
  getEmailAccountByRecipientDomain,
  getEmailAccountByToken,
  hasDb,
  insertEmail,
} from "@/lib/db";
import { reportWarn } from "@/lib/report";
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

  // Prefer a per-account token; else the global secret. FAIL CLOSED:
  // the token must match an account row OR the (non-empty) global
  // secret. Previously a bogus token with an empty global secret fell
  // through and let anyone inject fake emails into the channel.
  const account = token ? await getEmailAccountByToken(token).catch(() => null) : null;
  if (!account) {
    const s = await getSettings().catch(() => null);
    const globalSecret = (s?.resendInboundSecret ?? "").trim();
    if (!globalSecret || token !== globalSecret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  // Resend sends EVERY webhook event to the same endpoint, not just
  // inbound mail: email.sent / delivered / bounced / opened for
  // outgoing mail, contact.* and domain.* events, plus the dashboard's
  // "send test event". None of those are an incoming email, and
  // treating them as one is what produced the empty "از: ? / موضوع:
  // (بدون موضوع)" cards in the channel. Only act on receive events;
  // acknowledge the rest so Resend doesn't retry them forever.
  const eventType =
    payload && typeof payload === "object" && typeof (payload as { type?: unknown }).type === "string"
      ? ((payload as { type: string }).type)
      : null;
  if (eventType && !/(^|\.)(received|inbound)/i.test(eventType)) {
    return NextResponse.json({ ok: true, ignored: "event-type" });
  }

  const e = parseInboundEmail(payload);
  if (!e.fromEmail && !e.subject && !e.text && !e.html && !e.emailId) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  // Same event twice — a Resend retry, or the dashboard's test event
  // (which reuses one fixed id). Already have it; don't post again.
  if (e.emailId) {
    const dupe = await findEmailByResendId(e.emailId, "in").catch(() => null);
    if (dupe) {
      return NextResponse.json({ ok: true, ignored: "duplicate" });
    }
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
    if (!body) {
      reportWarn(
        "email-webhook",
        `body fetch returned nothing for resend id ${e.emailId}` +
          (apiKey ? "" : " (no Resend API key configured)"),
      );
    }
    if (body) {
      if (!text && !html) {
        text = body.text;
        html = body.html;
      }
      if (attachments.length === 0) attachments = body.attachments;
    }
  }
  // Last gate, and the decisive one: an "email" with no sender, no
  // subject and no body is not an email — it's an event we couldn't
  // parse, or an id whose body Resend wouldn't hand back. Posting it
  // yields a card that says nothing. Drop it here rather than
  // guessing upstream, so any future unknown payload shape fails
  // quietly instead of spamming the channel.
  if (!e.fromEmail && !e.subject && !text && !html && attachments.length === 0) {
    reportWarn(
      "email-webhook",
      `dropped an empty inbound payload (resend id ${e.emailId ?? "none"}, type ${eventType ?? "none"})`,
    );
    return NextResponse.json({ ok: true, ignored: "empty" });
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
  await postIncomingEmailToChannel(id).catch(() => ({ ok: false, chatId: null }));
  // Don't echo the account name / posting result: the caller is
  // whoever holds the webhook token, and leaking the matched account
  // name (or whether it posted) is needless disclosure. A flat ok is
  // all Resend needs.
  return NextResponse.json({ ok: true });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "email-webhook", hint: "POST Resend inbound payload with ?token=<account inbound token>" });
}
