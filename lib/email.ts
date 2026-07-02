import { config } from "./config";
import {
  getEmail,
  insertEmail,
  listChatsByFunction,
  setEmailTelegramRef,
  type EmailRow,
} from "./db";
import { getSettings } from "./settings";

const RESEND_API = "https://api.resend.com/emails";

function esc(s: string): string {
  return (s ?? "").replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

// Where incoming emails go: explicit settings.emailChannelId wins,
// otherwise the chat marked with the email_inbox function role.
export async function resolveEmailChannelId(): Promise<number | null> {
  const s = await getSettings();
  const explicit = (s.emailChannelId ?? "").trim();
  if (explicit) {
    const n = Number(explicit);
    if (Number.isFinite(n)) return n;
  }
  const inbox = (await listChatsByFunction("email_inbox").catch(() => []))[0];
  return inbox ? inbox.chatId : null;
}

function appUrl(): string {
  return (config.publicAppUrl ?? "https://tgsecretarybot.vercel.app").replace(/\/$/, "");
}

// Post an incoming email to the email channel with the four inline
// buttons: Preview / Summary (open dashboard pages) and Text / HTML
// (open the raw views, hence the ↗).
export async function postIncomingEmailToChannel(
  emailId: number,
): Promise<{ ok: boolean; chatId: number | null }> {
  const email = await getEmail(emailId);
  if (!email) return { ok: false, chatId: null };
  const chatId = await resolveEmailChannelId();
  if (!chatId) return { ok: false, chatId: null };

  const from = email.fromName
    ? `${email.fromName} <${email.fromEmail ?? ""}>`
    : email.fromEmail ?? "?";
  const preview = (email.textBody ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const text =
    `📧 <b>ایمیل جدید</b>\n` +
    `از: <b>${esc(from)}</b>\n` +
    (email.toEmails ? `به: ${esc(email.toEmails)}\n` : "") +
    `موضوع: <b>${esc(email.subject ?? "(بدون موضوع)")}</b>\n\n` +
    `${esc(preview)}${preview.length >= 300 ? "…" : ""}`;

  const base = `${appUrl()}/emails/${emailId}`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Preview", url: base },
        { text: "Summary", url: `${base}?tab=summary` },
      ],
      [
        { text: "Text ↗", url: `${appUrl()}/api/emails/${emailId}/raw?format=text` },
        { text: "HTML ↗", url: `${appUrl()}/api/emails/${emailId}/raw?format=html` },
      ],
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

// Send an email through Resend. Records an 'out' row (status sent/failed).
export async function sendEmail(args: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  replyToEmailId?: number; // when replying, thread + In-Reply-To
}): Promise<{ ok: boolean; id?: string; error?: string; emailRowId: number }> {
  const s = await getSettings();
  const apiKey = (s.resendApiKey ?? "").trim();
  const from = (s.resendFromEmail ?? "").trim();
  if (!apiKey || !from) {
    const rowId = await insertEmail({
      direction: "out",
      toEmails: args.to,
      subject: args.subject,
      textBody: args.text ?? null,
      htmlBody: args.html ?? null,
      status: "failed",
      error: "resend api key / from-email not configured",
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
  if (args.text) body.text = args.text;
  if (!args.html && !args.text) body.text = "";
  if (Object.keys(headers).length) body.headers = headers;

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!res.ok || !j.id) {
      const err = j.message ?? j.name ?? `HTTP ${res.status}`;
      const rowId = await insertEmail({
        direction: "out",
        toEmails: args.to,
        ccEmails: args.cc ?? null,
        subject: args.subject,
        textBody: args.text ?? null,
        htmlBody: args.html ?? null,
        inReplyTo,
        threadKey,
        status: "failed",
        error: err,
      });
      return { ok: false, error: err, emailRowId: rowId };
    }
    const rowId = await insertEmail({
      direction: "out",
      resendId: j.id,
      messageId: j.id,
      inReplyTo,
      threadKey,
      fromEmail: from,
      toEmails: args.to,
      ccEmails: args.cc ?? null,
      subject: args.subject,
      textBody: args.text ?? null,
      htmlBody: args.html ?? null,
      status: "sent",
    });
    return { ok: true, id: j.id, emailRowId: rowId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const rowId = await insertEmail({
      direction: "out",
      toEmails: args.to,
      subject: args.subject,
      status: "failed",
      error: msg,
    });
    return { ok: false, error: msg, emailRowId: rowId };
  }
}

// Parse the many shapes Resend's inbound webhook might send into a flat
// record we can store. Defensive — supports {type,data:{...}} envelope.
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
      return v
        .map((x) =>
          typeof x === "string" ? x : (x as { email?: string })?.email ?? "",
        )
        .filter(Boolean)
        .join(", ") || null;
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
    fromEmail,
    fromName,
    toEmails: emailField(d.to),
    ccEmails: emailField(d.cc),
    subject: asStr(d.subject),
    text: asStr(d.text) ?? asStr(d.plain),
    html: asStr(d.html),
    messageId: asStr(d.message_id) ?? asStr((headers["message-id"] ?? headers["Message-ID"])),
    inReplyTo: asStr(d.in_reply_to) ?? asStr((headers["in-reply-to"] ?? headers["In-Reply-To"])),
  };
}

export function emailThreadKey(subject: string | null): string {
  return (subject ?? "")
    .replace(/^\s*(re|fwd?|پاسخ|پ):\s*/i, "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

export type { EmailRow };
