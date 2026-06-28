import { createHash } from "node:crypto";
import { config } from "./config";
import {
  listChatsByFunction,
  recordSiteMonitorRun,
  type SiteMonitor,
} from "./db";
import { analyzeSiteChange } from "./classifier";

// Minimal cookie jar over fetch — enough for a classic form-login that
// hands back a session cookie. Captures Set-Cookie on every hop and
// replays the latest value per cookie name.
class Jar {
  private store = new Map<string, string>();
  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res: Response): void {
    // Node fetch exposes combined Set-Cookie via getSetCookie() (undici).
    const raw =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    for (const line of raw) {
      const first = line.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq > 0) this.store.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  get size(): number {
    return this.store.size;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Pull hidden inputs (CSRF tokens etc.) out of the login page so we can
// replay them in the POST — many frameworks reject logins without them.
function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const name = /name=["']([^"']+)["']/i.exec(tag)?.[1];
    const value = /value=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (name) out[name] = value;
  }
  return out;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export type SiteCheckResult = {
  status: "ok" | "login_failed" | "fetch_failed" | "error";
  error: string | null;
  text: string;
  contentHash: string | null;
  analysis: Awaited<ReturnType<typeof analyzeSiteChange>>;
  loginInfo: string;
};

// Log in (if creds present), then GET the check URL and return its text.
export async function fetchMonitoredPage(
  m: SiteMonitor,
): Promise<Omit<SiteCheckResult, "analysis">> {
  const jar = new Jar();
  let loginInfo = "no-login";
  try {
    if (m.username && m.loginUrl) {
      // 1) GET the login page for cookies + hidden fields.
      const pre = await fetch(m.loginUrl, {
        headers: { "User-Agent": UA },
        redirect: "manual",
      });
      jar.absorb(pre);
      const preHtml = await pre.text().catch(() => "");
      const hidden = hiddenFields(preHtml);
      // 2) POST credentials as a form.
      const form = new URLSearchParams();
      form.set(m.usernameField || "username", m.username);
      form.set(m.passwordField || "password", m.password ?? "");
      for (const [k, v] of Object.entries(hidden)) form.set(k, v);
      if (m.extraFieldsJson) {
        try {
          const extra = JSON.parse(m.extraFieldsJson) as Record<string, string>;
          for (const [k, v] of Object.entries(extra)) form.set(k, String(v));
        } catch {}
      }
      const post = await fetch(m.loginUrl, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: jar.header(),
          Referer: m.loginUrl,
        },
        body: form.toString(),
        redirect: "manual",
      });
      jar.absorb(post);
      // Follow one redirect hop (common post-login 302).
      const loc = post.headers.get("location");
      if (loc && (post.status === 301 || post.status === 302 || post.status === 303)) {
        const next = new URL(loc, m.loginUrl).toString();
        const r2 = await fetch(next, {
          headers: { "User-Agent": UA, Cookie: jar.header() },
          redirect: "manual",
        });
        jar.absorb(r2);
      }
      loginInfo = `login status=${post.status} cookies=${jar.size}`;
      if (jar.size === 0) {
        return {
          status: "login_failed",
          error: `لاگین کوکی برنگردوند (status=${post.status}). نام فیلدهای فرم رو چک کن.`,
          text: "",
          contentHash: null,
          loginInfo,
        };
      }
    }
    // 3) GET the target page with the session cookies.
    const res = await fetch(m.checkUrl, {
      headers: { "User-Agent": UA, Cookie: jar.header() },
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        status: "fetch_failed",
        error: `صفحه‌ی هدف status=${res.status} برگردوند`,
        text: "",
        contentHash: null,
        loginInfo,
      };
    }
    const html = await res.text();
    const text = htmlToText(html);
    const contentHash = createHash("sha256").update(text).digest("hex").slice(0, 32);
    return { status: "ok", error: null, text, contentHash, loginInfo };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      text: "",
      contentHash: null,
      loginInfo,
    };
  }
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

async function postToNotesInbox(text: string): Promise<boolean> {
  const inbox = (await listChatsByFunction("notes_inbox").catch(() => []))[0];
  if (!inbox) return false;
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: inbox.chatId,
        text: text.slice(0, 4096),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return Boolean(j.ok);
}

// Run a full check: fetch → analyze → decide → (maybe) notify → record.
// `slot` is the Tehran 'YYYY-MM-DD:HH' bucket this run belongs to.
export async function runSiteMonitor(
  m: SiteMonitor,
  slot: string,
): Promise<{ status: string; notified: boolean; summary: string }> {
  const page = await fetchMonitoredPage(m);
  if (page.status !== "ok") {
    await recordSiteMonitorRun(m.id, {
      slot,
      status: page.status,
      error: page.error,
      contentHash: null,
      content: null,
      summary: null,
    });
    // Surface hard failures (login/fetch) to the inbox once per slot so
    // the operator notices a broken monitor instead of silent gaps.
    await postToNotesInbox(
      `⚠️ <b>مانیتور سایت «${esc(m.name)}» خطا خورد</b>\n${esc(page.error ?? page.status)}\n<code>${esc(page.loginInfo)}</code>`,
    ).catch(() => {});
    return { status: page.status, notified: true, summary: page.error ?? "" };
  }

  const analysis = await analyzeSiteChange({
    monitorName: m.name,
    url: m.checkUrl,
    text: page.text,
  });

  const changed = page.contentHash !== m.lastContentHash;
  let shouldNotify = false;
  if (m.notifyOn === "always") shouldNotify = true;
  else if (m.notifyOn === "nonempty") shouldNotify = Boolean(analysis?.hasResult);
  else shouldNotify = changed && Boolean(analysis?.hasResult); // 'change'

  const summary = analysis?.summary ?? "";
  let notified = false;
  if (shouldNotify && analysis) {
    const kv = analysis.keyValues.length
      ? "\n\n" + analysis.keyValues.map((v) => `• <code>${esc(v)}</code>`).join("\n")
      : "";
    const body =
      `🔔 <b>${esc(analysis.headline || m.name)}</b>\n` +
      `🌐 ${esc(m.name)}\n\n` +
      `${esc(analysis.summary)}${kv}\n\n` +
      `<a href="${esc(m.checkUrl)}">باز کردن صفحه</a>`;
    notified = await postToNotesInbox(body).catch(() => false);
  }

  await recordSiteMonitorRun(m.id, {
    slot,
    status: "ok",
    error: null,
    contentHash: page.contentHash,
    content: page.text.slice(0, 8000),
    summary,
  });
  return { status: "ok", notified, summary };
}

// ── Tehran-time scheduling helpers ──────────────────────────────
// Tehran is UTC+03:30 (no DST since 2022).
export function tehranNow(now: Date): { y: number; mo: number; d: number; h: number; dow: number; slot: string } {
  const t = new Date(now.getTime() + 3.5 * 3600_000);
  const y = t.getUTCFullYear();
  const mo = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const h = t.getUTCHours();
  const dow = t.getUTCDay(); // 0=Sun..6=Sat (Tehran local)
  const slot = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}:${String(h).padStart(2, "0")}`;
  return { y, mo, d, h, dow, slot };
}

export function isMonitorDue(
  m: SiteMonitor,
  now: Date,
): { due: boolean; slot: string; reason: string } {
  const t = tehranNow(now);
  if (!m.enabled) return { due: false, slot: t.slot, reason: "disabled" };
  const skip = m.skipWeekdays
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
  if (skip.includes(t.dow)) return { due: false, slot: t.slot, reason: "skip-weekday" };
  const hours = m.checkHoursTehran
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
  if (!hours.includes(t.h)) return { due: false, slot: t.slot, reason: "not-this-hour" };
  if (m.lastRunSlot === t.slot) return { due: false, slot: t.slot, reason: "already-ran-this-slot" };
  return { due: true, slot: t.slot, reason: "due" };
}
