// Resend account plumbing for an email account: is the sending domain
// verified, is receiving set up, does an email.received webhook point
// at our inbound URL — and create that webhook when asked. Uses the
// account's own stored API key server-side, so the operator (or an
// agent over MCP) never has to handle the key.
import { config } from "./config";
import type { EmailAccount } from "./db";
import { getSettings } from "./settings";

const API = "https://api.resend.com";

type DomainRow = {
  id: string;
  name: string;
  status: string;
  region?: string;
  created_at?: string;
};
type DomainRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
  priority?: number;
  ttl?: string;
};
type WebhookRow = {
  id: string;
  endpoint: string;
  events: string[];
  status?: string;
};

async function call<T>(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : text.slice(0, 200)) || `http ${res.status}`;
    return { ok: false, status: res.status, data: null, error: msg };
  }
  return { ok: true, status: res.status, data: data as T };
}

export type ResendCheckReport = {
  accountId: number;
  accountName: string;
  fromEmail: string | null;
  inboundUrl: string;
  apiKey: "account" | "global" | "missing";
  domain: {
    wanted: string | null;
    found: boolean;
    id?: string;
    status?: string;
    region?: string;
    records: Array<{ record: string; type: string; name: string; value: string; status?: string }>;
    unverified: number;
  };
  webhook: {
    listed: boolean;
    found: boolean;
    id?: string;
    endpoint?: string;
    events?: string[];
    created?: boolean;
    signingSecret?: string;
    error?: string;
  };
  problems: string[];
};

function inboundUrlFor(account: EmailAccount): string {
  const base = (config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "");
  return `${base}/api/email-webhook?token=${account.inboundToken ?? ""}`;
}

function primaryDomain(account: EmailAccount): string | null {
  const first = (account.inboundDomains ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)[0];
  if (first) return first;
  const m = /@([a-z0-9.-]+)/i.exec(account.fromEmail ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

export async function checkAccountResend(
  account: EmailAccount,
  opts?: { createWebhook?: boolean },
): Promise<ResendCheckReport> {
  const s = await getSettings().catch(() => null);
  const apiKey = (account.resendApiKey || s?.resendApiKey || "").trim();
  const report: ResendCheckReport = {
    accountId: account.id,
    accountName: account.name,
    fromEmail: account.fromEmail,
    inboundUrl: inboundUrlFor(account),
    apiKey: account.resendApiKey ? "account" : apiKey ? "global" : "missing",
    domain: { wanted: primaryDomain(account), found: false, records: [], unverified: 0 },
    webhook: { listed: false, found: false },
    problems: [],
  };
  if (!apiKey) {
    report.problems.push("کلید Resend برای این اکانت (و به‌صورت سراسری) تنظیم نشده");
    return report;
  }
  if (!account.inboundToken) report.problems.push("inbound token ندارد — وب‌هوک قابل ساخت نیست");
  if (!account.fromEmail) report.problems.push("from-email خالی است — پاسخ‌ها ارسال نمی‌شوند");
  if (!account.tgChannelId) report.problems.push("چت تلگرام مقصد تنظیم نشده");

  // --- domain ---
  const domains = await call<{ data: DomainRow[] }>(apiKey, "GET", "/domains");
  if (!domains.ok) {
    report.problems.push(`Resend /domains: ${domains.error}`);
  } else if (report.domain.wanted) {
    const want = report.domain.wanted;
    const hit = (domains.data?.data ?? []).find(
      (d) => d.name.toLowerCase() === want || want.endsWith(`.${d.name.toLowerCase()}`),
    );
    if (!hit) {
      report.problems.push(`دومین ${want} در این اکانت Resend ثبت نشده`);
    } else {
      report.domain.found = true;
      report.domain.id = hit.id;
      report.domain.status = hit.status;
      report.domain.region = hit.region;
      const detail = await call<{ records?: DomainRecord[]; status?: string }>(
        apiKey,
        "GET",
        `/domains/${hit.id}`,
      );
      if (detail.ok) {
        const recs = detail.data?.records ?? [];
        report.domain.records = recs.map((r) => ({
          record: r.record,
          type: r.type,
          name: r.name,
          value: r.value,
          status: r.status,
        }));
        report.domain.unverified = recs.filter(
          (r) => r.status && !/verified/i.test(r.status),
        ).length;
        if (detail.data?.status) report.domain.status = detail.data.status;
      }
      if (report.domain.status && !/verified/i.test(report.domain.status)) {
        report.problems.push(
          `دومین ${want} در Resend وضعیت «${report.domain.status}» دارد — رکوردهای DNS را چک کن`,
        );
      }
    }
  }

  // --- webhook ---
  const hooks = await call<{ data: WebhookRow[] }>(apiKey, "GET", "/webhooks");
  const wantEndpoint = report.inboundUrl;
  if (hooks.ok) {
    report.webhook.listed = true;
    const list = hooks.data?.data ?? [];
    const hit =
      list.find((w) => w.endpoint === wantEndpoint) ??
      list.find(
        (w) =>
          account.inboundToken != null &&
          w.endpoint.includes(`token=${account.inboundToken}`),
      );
    if (hit) {
      report.webhook.found = true;
      report.webhook.id = hit.id;
      report.webhook.endpoint = hit.endpoint;
      report.webhook.events = hit.events;
      if (!hit.events.includes("email.received")) {
        report.problems.push("وب‌هوک هست ولی رویداد email.received را ندارد");
      }
    }
  } else {
    report.webhook.error = hooks.error;
  }
  if (!report.webhook.found && opts?.createWebhook && account.inboundToken) {
    const created = await call<{ id: string; signing_secret?: string }>(apiKey, "POST", "/webhooks", {
      endpoint: wantEndpoint,
      events: ["email.received"],
    });
    if (created.ok && created.data) {
      report.webhook.found = true;
      report.webhook.created = true;
      report.webhook.id = created.data.id;
      report.webhook.endpoint = wantEndpoint;
      report.webhook.events = ["email.received"];
      report.webhook.signingSecret = created.data.signing_secret;
    } else {
      report.webhook.error = created.error;
      report.problems.push(`ساخت وب‌هوک ناموفق: ${created.error}`);
    }
  } else if (!report.webhook.found) {
    report.problems.push(
      report.webhook.listed
        ? "وب‌هوک email.received به آدرس ورودی این اکانت وجود ندارد"
        : `لیست وب‌هوک‌ها خوانده نشد (${report.webhook.error ?? "?"}) — در داشبورد Resend چک کن`,
    );
  }
  return report;
}
