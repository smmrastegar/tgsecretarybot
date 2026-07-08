import { config } from "./config";
import {
  getEmail,
  getEmailAccount,
  getEmailAccountByRecipientDomain,
  insertEmail,
  listChatsByFunction,
  setEmailTelegramRef,
  type EmailAccount,
  type EmailAttachment,
  type EmailRow,
} from "./db";
import { emailLinkToken } from "./email-link";
import { getSettings } from "./settings";

const RESEND_API = "https://api.resend.com/emails";

function esc(s: string): string {
  return (s ?? "").replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

function appUrl(): string {
  return (config.publicAppUrl ?? "https://tgsecretarybot.vercel.app").replace(/\/$/, "");
}

// Base URL for an account's Telegram button links. Each account can
// have its own public domain (e.g. rateklend.text.bz) so its email
// cards open on that domain instead of the shared app URL.
function accountBaseUrl(account: EmailAccount | null): string {
  const raw = (account?.publicUrl ?? "").trim();
  if (!raw) return appUrl();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/$/, "");
}

// Resolve the API key + from-address to use: an explicit account wins,
// otherwise the global resend* settings (single-account fallback).
async function resolveCreds(
  account: EmailAccount | null,
): Promise<{ apiKey: string; from: string }> {
  if (account && (account.resendApiKey || account.fromEmail)) {
    const s = await getSettings();
    return {
      apiKey: (account.resendApiKey || s.resendApiKey || "").trim(),
      from: (account.fromEmail || s.resendFromEmail || "").trim(),
    };
  }
  const s = await getSettings();
  return { apiKey: (s.resendApiKey ?? "").trim(), from: (s.resendFromEmail ?? "").trim() };
}

// Which Telegram chat an account's mail posts to: the account's own
// channel, else the chat with the email_inbox role, else the global
// emailChannelId setting.
async function resolveChannelId(account: EmailAccount | null): Promise<number | null> {
  if (account?.tgChannelId) return account.tgChannelId;
  const inbox = (await listChatsByFunction("email_inbox").catch(() => []))[0];
  if (inbox) return inbox.chatId;
  const s = await getSettings();
  const explicit = (s.emailChannelId ?? "").trim();
  if (explicit) {
    const n = Number(explicit);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Resolve the account that owns an email: the linked account, else a
// match on the recipient domain (so a card still resolves the right
// account/domain even if the row was never linked).
export async function resolveEmailAccount(
  email: EmailRow,
): Promise<EmailAccount | null> {
  const linked = email.accountId ? await getEmailAccount(email.accountId) : null;
  if (linked) return linked;
  return getEmailAccountByRecipientDomain(email.toEmails);
}

// Build the Telegram card (text + inline keyboard) for an email. When
// `summary` is passed it's appended inline to the SAME card, so the
// 🧠 خلاصه button can edit the card in place instead of posting a
// separate message.
type InlineBtn =
  | { text: string; url: string }
  | { text: string; callback_data: string };

export function buildEmailCard(
  email: EmailRow,
  account: EmailAccount | null,
  opts?: { summary?: string | null },
): { text: string; reply_markup: { inline_keyboard: InlineBtn[][] } } {
  const emailId = email.id;
  const from = email.fromName
    ? `${email.fromName} <${email.fromEmail ?? ""}>`
    : email.fromEmail ?? "?";
  const preview = (email.textBody ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const attachments = email.attachments ?? [];
  const site = accountBaseUrl(account);
  const token = emailLinkToken(emailId);

  const attachmentLines = attachments
    .map((a) => {
      const url = `${site}/api/public/emails/${emailId}/attachment/${a.id}?t=${token}`;
      return `📎 <a href="${esc(url)}">${esc(a.filename || "file")}</a>`;
    })
    .join("\n");

  const summary = (opts?.summary ?? "").trim();
  const text =
    `📧 <b>ایمیل جدید</b>${account ? ` — ${esc(account.name)}` : ""}\n` +
    `از: <b>${esc(from)}</b>\n` +
    (email.toEmails ? `به: ${esc(email.toEmails)}\n` : "") +
    `موضوع: <b>${esc(email.subject ?? "(بدون موضوع)")}</b>\n` +
    (attachmentLines ? `${attachmentLines}\n` : "") +
    `\n${esc(preview)}${preview.length >= 300 ? "…" : ""}` +
    (summary ? `\n\n🧠 <b>خلاصه</b>\n${esc(summary)}` : "");

  const base = `${site}/e/${emailId}?t=${token}`;
  const reply_markup: { inline_keyboard: InlineBtn[][] } = {
    inline_keyboard: [
      [
        { text: "Preview", url: base },
        { text: summary ? "🧠 خلاصه ✓" : "🧠 خلاصه", callback_data: `em:sum:${emailId}` },
      ],
      [
        { text: "Text ↗", url: `${site}/api/public/emails/${emailId}/raw?format=text&t=${token}` },
        { text: "HTML ↗", url: `${site}/api/public/emails/${emailId}/raw?format=html&t=${token}` },
      ],
      [{ text: "↩️ پاسخ", callback_data: `em:reply:${emailId}` }],
    ],
  };
  return { text: text.slice(0, 4096), reply_markup };
}

// Post an incoming email to its account's channel. All the open-in-
// browser links (Preview / Text / HTML / attachments) are PUBLIC:
// they carry a per-email HMAC token (?t=) and open without a dashboard
// login, on the account's own public domain. Summary + Reply are
// CALLBACK buttons so the operator works from Telegram.
export async function postIncomingEmailToChannel(
  emailId: number,
): Promise<{ ok: boolean; chatId: number | null }> {
  const email = await getEmail(emailId);
  if (!email) return { ok: false, chatId: null };
  const account = await resolveEmailAccount(email);
  const chatId = await resolveChannelId(account);
  if (!chatId) return { ok: false, chatId: null };

  const card = buildEmailCard(email, account, { summary: email.summary });
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: card.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: card.reply_markup,
      }),
    },
  );
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id: number };
  };
  if (j.ok && j.result) {
    await setEmailTelegramRef(emailId, chatId, j.result.message_id).catch(() => {});
  }
  return { ok: Boolean(j.ok), chatId };
}

// Core send. `account` selects credentials + records account_id.
export async function sendEmail(args: {
  account: EmailAccount | null;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  replyToEmailId?: number;
}): Promise<{ ok: boolean; id?: string; error?: string; emailRowId: number }> {
  const { apiKey, from } = await resolveCreds(args.account);
  const accountId = args.account?.id ?? null;
  if (!apiKey || !from) {
    const rowId = await insertEmail({
      direction: "out", accountId, toEmails: args.to, subject: args.subject,
      textBody: args.text ?? null, htmlBody: args.html ?? null,
      status: "failed", error: "resend api key / from-email not configured",
    });
    return { ok: false, error: "Resend API key یا from-email تنظیم نشده", emailRowId: rowId };
  }

  let inReplyTo: string | null = null;
  let references: string | null = null;
  let threadKey: string | null = null;
  if (args.replyToEmailId) {
    const orig = await getEmail(args.replyToEmailId);
    if (orig) {
      inReplyTo = orig.messageId ?? null;
      references = orig.messageId ?? null;
      threadKey = orig.threadKey ?? orig.subject ?? null;
    }
  }
  const headers: Record<string, string> = {};
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references) headers["References"] = references;

  const body: Record<string, unknown> = {
    from,
    to: args.to.split(",").map((x) => x.trim()).filter(Boolean),
    subject: args.subject,
  };
  if (args.cc) body.cc = args.cc.split(",").map((x) => x.trim()).filter(Boolean);
  if (args.html) body.html = args.html;
  if (args.text || !args.html) body.text = args.text ?? "";
  if (Object.keys(headers).length) body.headers = headers;

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !j.id) {
      const err = j.message ?? j.name ?? `HTTP ${res.status}`;
      const rowId = await insertEmail({
        direction: "out", accountId, toEmails: args.to, ccEmails: args.cc ?? null,
        subject: args.subject, textBody: args.text ?? null, htmlBody: args.html ?? null,
        inReplyTo, threadKey, status: "failed", error: err,
      });
      return { ok: false, error: err, emailRowId: rowId };
    }
    const rowId = await insertEmail({
      direction: "out", accountId, resendId: j.id, messageId: j.id, inReplyTo, threadKey,
      fromEmail: from, toEmails: args.to, ccEmails: args.cc ?? null, subject: args.subject,
      textBody: args.text ?? null, htmlBody: args.html ?? null, status: "sent",
    });
    return { ok: true, id: j.id, emailRowId: rowId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const rowId = await insertEmail({
      direction: "out", accountId, toEmails: args.to, subject: args.subject,
      status: "failed", error: msg,
    });
    return { ok: false, error: msg, emailRowId: rowId };
  }
}

// Reply to an email (used by dashboard + Telegram). Resolves the
// account from the original email so the reply goes from the same
// address/key.
export async function replyToEmail(
  emailId: number,
  text: string,
  overrides?: { to?: string; subject?: string; html?: string },
): Promise<{ ok: boolean; error?: string }> {
  const orig = await getEmail(emailId);
  if (!orig) return { ok: false, error: "email not found" };
  const account = orig.accountId ? await getEmailAccount(orig.accountId) : null;
  const to = overrides?.to || orig.fromEmail || "";
  if (!to) return { ok: false, error: "گیرنده مشخص نیست" };
  const subject =
    overrides?.subject ||
    (orig.subject ? (/^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`) : "Re:");
  const r = await sendEmail({
    account, to, subject, text, html: overrides?.html, replyToEmailId: orig.id,
  });
  return { ok: r.ok, error: r.error };
}

function normalizeAttachments(v: unknown): EmailAttachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((x) => ({
      id: String(x.id ?? ""),
      filename: (x.filename as string) ?? null,
      contentType: (x.content_type ?? x.contentType ?? null) as string | null,
      size: x.size != null ? Number(x.size) : null,
      contentDisposition: (x.content_disposition ?? x.contentDisposition ?? null) as string | null,
      contentId: (x.content_id ?? x.contentId ?? null) as string | null,
    }))
    .filter((x) => x.id);
}

// Fetch the actual body + attachments of a received email. Resend's
// inbound webhook only carries metadata — text/html/attachments live
// behind the Received Emails API (GET /emails/receiving/{id}).
export async function fetchReceivedEmailBody(
  apiKey: string,
  emailId: string,
): Promise<{
  text: string | null;
  html: string | null;
  attachments: EmailAttachment[];
} | null> {
  if (!apiKey || !emailId) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      text?: string | null;
      html?: string | null;
      attachments?: unknown;
    };
    return {
      text: j.text ?? null,
      html: j.html ?? null,
      attachments: normalizeAttachments(j.attachments),
    };
  } catch {
    return null;
  }
}

// Resolve a short-lived signed download URL for one attachment of a
// received email (GET /emails/receiving/{id}/attachments/{aid}).
export async function fetchReceivedEmailAttachmentUrl(
  apiKey: string,
  emailId: string,
  attachmentId: string,
): Promise<{ url: string; filename: string | null; contentType: string | null } | null> {
  if (!apiKey || !emailId || !attachmentId) return null;
  try {
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${emailId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      download_url?: string;
      filename?: string | null;
      content_type?: string | null;
    };
    if (!j.download_url) return null;
    return {
      url: j.download_url,
      filename: j.filename ?? null,
      contentType: j.content_type ?? null,
    };
  } catch {
    return null;
  }
}

export function parseInboundEmail(payload: unknown): {
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  emailId: string | null;
  attachments: EmailAttachment[];
} {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const d = (p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : p) as Record<string, unknown>;
  const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
  const emailField = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      return v.map((x) => (typeof x === "string" ? x : (x as { email?: string })?.email ?? "")).filter(Boolean).join(", ") || null;
    }
    if (v && typeof v === "object") return (v as { email?: string }).email ?? null;
    return null;
  };
  const fromRaw = d.from ?? d.sender;
  let fromEmail: string | null = null;
  let fromName: string | null = null;
  if (typeof fromRaw === "string") {
    const m = /^(.*?)<([^>]+)>/.exec(fromRaw);
    if (m) { fromName = m[1]?.trim() || null; fromEmail = m[2]?.trim() || null; }
    else fromEmail = fromRaw.trim();
  } else if (fromRaw && typeof fromRaw === "object") {
    const f = fromRaw as { email?: string; name?: string };
    fromEmail = f.email ?? null; fromName = f.name ?? null;
  }
  const headers = (d.headers && typeof d.headers === "object" ? d.headers : {}) as Record<string, unknown>;
  return {
    fromEmail, fromName,
    toEmails: emailField(d.to),
    ccEmails: emailField(d.cc),
    subject: asStr(d.subject),
    text: asStr(d.text) ?? asStr(d.plain),
    html: asStr(d.html),
    messageId: asStr(d.message_id) ?? asStr(headers["message-id"] ?? headers["Message-ID"]),
    inReplyTo: asStr(d.in_reply_to) ?? asStr(headers["in-reply-to"] ?? headers["In-Reply-To"]),
    emailId: asStr(d.email_id) ?? asStr(d.id),
    attachments: normalizeAttachments(d.attachments),
  };
}

export function emailThreadKey(subject: string | null): string {
  return (subject ?? "").replace(/^\s*(re|fwd?|پاسخ|پ):\s*/i, "").trim().toLowerCase().slice(0, 120);
}

export type { EmailRow, EmailAccount };
