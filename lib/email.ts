import { config } from "./config";
import {
  getEmail,
  getEmailAccount,
  insertEmail,
  listChatsByFunction,
  setEmailTelegramRef,
  type EmailAccount,
  type EmailRow,
} from "./db";
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

// Post an incoming email to its account's channel with buttons.
// Preview / Text / HTML open the dashboard (URL buttons); Summary +
// Reply are CALLBACK buttons so the operator can work from Telegram.
export async function postIncomingEmailToChannel(
  emailId: number,
): Promise<{ ok: boolean; chatId: number | null }> {
  const email = await getEmail(emailId);
  if (!email) return { ok: false, chatId: null };
  const account = email.accountId ? await getEmailAccount(email.accountId) : null;
  const chatId = await resolveChannelId(account);
  if (!chatId) return { ok: false, chatId: null };

  const from = email.fromName
    ? `${email.fromName} <${email.fromEmail ?? ""}>`
    : email.fromEmail ?? "?";
  const preview = (email.textBody ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const text =
    `📧 <b>ایمیل جدید</b>${account ? ` — ${esc(account.name)}` : ""}\n` +
    `از: <b>${esc(from)}</b>\n` +
    (email.toEmails ? `به: ${esc(email.toEmails)}\n` : "") +
    `موضوع: <b>${esc(email.subject ?? "(بدون موضوع)")}</b>\n\n` +
    `${esc(preview)}${preview.length >= 300 ? "…" : ""}`;

  const base = `${appUrl()}/emails/${emailId}`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Preview", url: base },
        { text: "🧠 خلاصه", callback_data: `em:sum:${emailId}` },
      ],
      [
        { text: "Text ↗", url: `${appUrl()}/api/emails/${emailId}/raw?format=text` },
        { text: "HTML ↗", url: `${appUrl()}/api/emails/${emailId}/raw?format=html` },
      ],
      [{ text: "↩️ پاسخ", callback_data: `em:reply:${emailId}` }],
    ],
  };
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: keyboard,
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
  };
}

export function emailThreadKey(subject: string | null): string {
  return (subject ?? "").replace(/^\s*(re|fwd?|پاسخ|پ):\s*/i, "").trim().toLowerCase().slice(0, 120);
}

export type { EmailRow, EmailAccount };
