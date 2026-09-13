// Telegram Rich Messages (Bot API 10.2+): headings, lists, tables,
// block quotes, collapsible <details>, footers — sent with
// sendRichMessage / edited with editMessageText { rich_message }.
//
// Content is passed as rich HTML (the escaping we already do for the
// classic HTML parse_mode stays valid) or as rich Markdown for text we
// compose ourselves. Every call falls back to a classic HTML
// sendMessage with the block tags flattened, so a client or API hiccup
// degrades to today's look instead of dropping the message.
//
// grammy's typed API predates rich messages, so this talks to the Bot
// API directly, like the MCP route does.
import { config } from "./config";
import { reportWarn } from "./report";

export type RichContent = { html: string } | { markdown: string };

export type RichSendOptions = RichContent & {
  chatId: number | string;
  messageThreadId?: number | null;
  replyToMessageId?: number | null;
  replyMarkup?: unknown;
  silent?: boolean;
  /** Telegram ephemeral message: shown only to this user (groups). */
  receiverUserId?: number | null;
  businessConnectionId?: string | null;
  /** Default true — the product is Persian. */
  isRtl?: boolean;
  /** Skip the classic-HTML fallback (e.g. when the caller has its own). */
  noFallback?: boolean;
};

export type RichSendResult = {
  message_id: number;
  ephemeral_message_id?: number;
  /** true when the rich send failed and the classic fallback was used */
  fallback: boolean;
};

type TgResponse<T> = { ok: boolean; result?: T; description?: string };

async function call<T>(method: string, body: Record<string, unknown>): Promise<TgResponse<T>> {
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return (await res.json().catch(() => ({ ok: false, description: `http ${res.status}` }))) as TgResponse<T>;
}

function richMessage(c: RichContent, isRtl: boolean): Record<string, unknown> {
  return "html" in c
    ? { html: c.html, is_rtl: isRtl }
    : { markdown: c.markdown, is_rtl: isRtl };
}

const NL = "\n";

/**
 * Flatten rich HTML to the classic parse_mode=HTML subset: headings →
 * bold lines, lists → bullets, tables → pipe rows, quotes kept, block
 * containers dropped. Good enough that the fallback reads like the
 * pre-rich version of the same message.
 */
export function richHtmlToClassic(html: string): string {
  let s = html;
  s = s.replace(/<h[1-6][^>]*>/gi, "<b>").replace(/<\/h[1-6]>/gi, `</b>${NL}`);
  s = s.replace(/<br\s*\/?>/gi, NL);
  s = s.replace(/<hr\s*\/?>/gi, `${NL}———${NL}`);
  s = s.replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, NL);
  s = s.replace(/<li[^>]*>\s*<input[^>]*checked[^>]*>/gi, "☑ ");
  s = s.replace(/<li[^>]*>\s*<input[^>]*>/gi, "☐ ");
  s = s.replace(/<li[^>]*>/gi, "• ").replace(/<\/li>/gi, NL);
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, NL);
  s = s.replace(/<caption[^>]*>/gi, "<b>").replace(/<\/caption>/gi, `</b>${NL}`);
  s = s.replace(/<\/t[hd]>\s*<t[hd][^>]*>/gi, " | ");
  s = s.replace(/<t[hd][^>]*>/gi, "").replace(/<\/t[hd]>/gi, "");
  s = s.replace(/<tr[^>]*>/gi, "").replace(/<\/tr>/gi, NL);
  s = s.replace(/<\/?table[^>]*>/gi, NL);
  s = s.replace(/<summary[^>]*>/gi, "<b>").replace(/<\/summary>/gi, `</b>${NL}`);
  s = s.replace(/<\/?details[^>]*>/gi, NL);
  s = s.replace(/<footer[^>]*>/gi, "<i>").replace(/<\/footer>/gi, `</i>${NL}`);
  s = s.replace(/<aside[^>]*>/gi, "<i>").replace(/<\/aside>/gi, `</i>${NL}`);
  s = s.replace(/<cite[^>]*>/gi, " — ").replace(/<\/cite>/gi, "");
  s = s.replace(/<mark[^>]*>/gi, "<u>").replace(/<\/mark>/gi, "</u>");
  s = s.replace(/<\/?(sub|sup|strong|em|ins|del|strike)[^>]*>/gi, (t) => {
    const close = t.startsWith("</");
    const tag = t.replace(/[<>/]/g, "").split(/\s/)[0]!.toLowerCase();
    const map: Record<string, string> = { strong: "b", em: "i", ins: "u", del: "s", strike: "s" };
    const to = map[tag];
    return to ? `<${close ? "/" : ""}${to}>` : "";
  });
  s = s.replace(/<blockquote[^>]*>/gi, "<blockquote>");
  s = s.replace(/<tg-[a-z-]+[^>]*>[\s\S]*?<\/tg-[a-z-]+>/gi, "");
  s = s.replace(/<tg-[a-z-]+[^>]*\/?>/gi, "");
  s = s.replace(/<(img|video|audio|figure|figcaption)[^>]*>/gi, "").replace(/<\/(figure|figcaption|video|audio)>/gi, "");
  s = s.replace(/\n{3,}/g, `${NL}${NL}`).trim();
  return s.slice(0, 4096);
}

/** Markdown → plain text for the fallback path. */
export function richMarkdownToClassic(md: string): string {
  let s = md;
  s = s.replace(/^#{1,6}\s+(.*)$/gm, "$1");
  s = s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  s = s.replace(/~~(.+?)~~/g, "$1").replace(/==(.+?)==/g, "$1");
  s = s.replace(/^\s*[-*+]\s+\[[ x]\]\s+/gm, "• ").replace(/^\s*[-*+]\s+/gm, "• ");
  s = s.replace(/^\s*>\s?/gm, "");
  s = s.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "");
  s = s.replace(/^---+$/gm, "———");
  s = s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return s.replace(/\n{3,}/g, "\n\n").trim().slice(0, 4096);
}

export function classicFallbackText(c: RichContent): string {
  return "html" in c ? richHtmlToClassic(c.html) : richMarkdownToClassic(c.markdown);
}

export async function sendRichMessage(o: RichSendOptions): Promise<RichSendResult> {
  const content: RichContent = "html" in o ? { html: o.html } : { markdown: o.markdown };
  const body: Record<string, unknown> = {
    chat_id: o.chatId,
    rich_message: richMessage(content, o.isRtl ?? true),
  };
  if (o.messageThreadId != null) body.message_thread_id = o.messageThreadId;
  if (o.replyToMessageId != null) {
    body.reply_parameters = {
      message_id: o.replyToMessageId,
      allow_sending_without_reply: true,
    };
  }
  if (o.replyMarkup != null) body.reply_markup = o.replyMarkup;
  if (o.silent) body.disable_notification = true;
  if (o.receiverUserId != null) {
    body.ephemeral_message_parameters = { receiver_user_id: o.receiverUserId };
  }
  if (o.businessConnectionId) body.business_connection_id = o.businessConnectionId;

  const r = await call<{ message_id: number; ephemeral_message_id?: number }>(
    "sendRichMessage",
    body,
  );
  if (r.ok && r.result) {
    return {
      message_id: r.result.message_id,
      ephemeral_message_id: r.result.ephemeral_message_id,
      fallback: false,
    };
  }
  const why = r.description ?? "sendRichMessage failed";
  if (o.noFallback) throw new Error(`telegram: ${why}`);
  reportWarn("telegram-rich", `sendRichMessage failed (${why}); falling back to HTML`);

  const fb: Record<string, unknown> = {
    chat_id: o.chatId,
    text: classicFallbackText(content),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (o.messageThreadId != null) fb.message_thread_id = o.messageThreadId;
  if (body.reply_parameters) fb.reply_parameters = body.reply_parameters;
  if (o.replyMarkup != null) fb.reply_markup = o.replyMarkup;
  if (o.silent) fb.disable_notification = true;
  if (body.ephemeral_message_parameters) {
    fb.ephemeral_message_parameters = body.ephemeral_message_parameters;
  }
  if (o.businessConnectionId) fb.business_connection_id = o.businessConnectionId;
  const r2 = await call<{ message_id: number; ephemeral_message_id?: number }>(
    "sendMessage",
    fb,
  );
  if (!r2.ok || !r2.result) {
    throw new Error(`telegram: ${r2.description ?? "send failed"} (rich: ${why})`);
  }
  return {
    message_id: r2.result.message_id,
    ephemeral_message_id: r2.result.ephemeral_message_id,
    fallback: true,
  };
}

export async function editRichMessage(o: {
  chatId: number | string;
  messageId: number;
  content: RichContent;
  replyMarkup?: unknown;
  isRtl?: boolean;
}): Promise<{ fallback: boolean }> {
  const body: Record<string, unknown> = {
    chat_id: o.chatId,
    message_id: o.messageId,
    rich_message: richMessage(o.content, o.isRtl ?? true),
  };
  if (o.replyMarkup != null) body.reply_markup = o.replyMarkup;
  const r = await call("editMessageText", body);
  if (r.ok) return { fallback: false };
  const why = r.description ?? "edit failed";
  // "message is not modified" is a no-op, not a failure.
  if (/not modified/i.test(why)) return { fallback: false };
  reportWarn("telegram-rich", `rich edit failed (${why}); falling back to HTML`);
  const r2 = await call("editMessageText", {
    chat_id: o.chatId,
    message_id: o.messageId,
    text: classicFallbackText(o.content),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(o.replyMarkup != null ? { reply_markup: o.replyMarkup } : {}),
  });
  if (!r2.ok && !/not modified/i.test(r2.description ?? "")) {
    throw new Error(`telegram: ${r2.description ?? "edit failed"} (rich: ${why})`);
  }
  return { fallback: true };
}

export function escRich(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Persian digits for numbers shown inside rich HTML we compose. */
export function faNum(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
}
