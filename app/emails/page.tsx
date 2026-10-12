"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageTitle, Badge } from "@/components/Card";
import Section from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import { ErrorBox, Field, LoadingBox, Segmented, btnDanger, btnGhost, btnPrimary, cardCls, fa, inputCls } from "@/components/tool-pages/Controls";

type Email = {
  id: number;
  direction: "in" | "out";
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  subject: string | null;
  textBody: string | null;
  status: string | null;
  createdAt: string;
};

export default function EmailsPage() {
  const [tab, setTab] = useState<"in" | "out">("in");
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [compose, setCompose] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch(`/api/emails?direction=${tab}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { emails: Email[] };
      setEmails(j.emails ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell>
      <div dir="rtl" className="max-w-2xl mx-auto">
        <PageTitle
          title="📧 Email (Resend)"
          subtitle="دریافت و ارسال ایمیل. ورودی‌ها توی کانال ایمیل هم پست می‌شن."
          actions={<button onClick={() => setCompose(true)} className={btnPrimary}>✉️ ایمیل جدید</button>}
        />

        <Section icon="⚙️" title="تنظیمات Resend" summary="اکانت‌ها، API key و وب‌هوک ورودی">
          <AccountsManager origin={origin} />
          <ResendSettings origin={origin} />
        </Section>

        <div className="mb-3">
          <Segmented value={tab} onChange={setTab} options={[{ id: "in", label: "📥 دریافتی" }, { id: "out", label: "📤 ارسالی" }]} />
        </div>

        {loading ? (
          <LoadingBox />
        ) : error ? (
          <ErrorBox text="دریافت ایمیل‌ها ناموفق بود." onRetry={load} />
        ) : emails.length === 0 ? (
          <EmptyState icon={tab === "in" ? "📥" : "📤"} title="ایمیلی نیست." hint={tab === "in" ? "ایمیل‌های ورودی همین‌جا فهرست می‌شوند." : "هنوز ایمیلی نفرستاده‌ای."}
            action={<button onClick={() => setCompose(true)} className={btnPrimary}>✉️ ایمیل جدید</button>} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {emails.map((e) => (
              <Link key={e.id} href={`/emails/${e.id}`} className={`${cardCls} block min-h-[72px] !px-4 !py-3 active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]`}>
                <div dir="auto" className="font-semibold text-sm truncate">{e.subject || "(بدون موضوع)"}</div>
                <div className="mt-0.5 text-xs text-[var(--color-text-dim)] truncate">
                  {e.direction === "in" ? "از: " : "به: "}
                  <bdi dir="ltr">{e.direction === "in" ? `${e.fromName ? e.fromName + " " : ""}${e.fromEmail ?? "?"}` : (e.toEmails ?? "?")}</bdi>
                </div>
                {e.textBody && (
                  <div dir="auto" className="mt-1 text-xs leading-5 text-[var(--color-text-dim)] line-clamp-2">{e.textBody}</div>
                )}
                <div className="mt-1.5 flex items-center justify-center gap-2 flex-wrap">
                  {e.status === "failed" && <Badge tone="danger">ناموفق</Badge>}
                  {e.status === "sent" && <Badge tone="success">ارسال شد</Badge>}
                  <span className="text-xs text-[var(--color-text-dim)]">{new Date(e.createdAt).toLocaleString("fa-IR")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {compose && <ComposeModal onClose={() => setCompose(false)} onSent={load} />}
    </Shell>
  );
}

type Account = {
  id: number;
  name: string;
  fromEmail: string | null;
  inboundToken: string | null;
  tgChannelId: number | null;
  publicUrl: string | null;
  inboundDomains: string | null;
  enabled: boolean;
  hasApiKey: boolean;
};

const BLANK_ACCOUNT = { name: "", resendApiKey: "", fromEmail: "", inboundToken: "", tgChannelId: "", publicUrl: "", inboundDomains: "" };

function AccountsManager({ origin }: { origin: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ ...BLANK_ACCOUNT });
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await fetch("/api/email-accounts");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { accounts: Account[] };
      setAccounts(j.accounts ?? []);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const genToken = () => setForm((f) => ({ ...f, inboundToken: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) }));
  const create = async () => {
    if (!form.name) return;
    await fetch("/api/email-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ ...BLANK_ACCOUNT });
    await load();
  };
  const patch = async (id: number, body: Record<string, string>) => {
    await fetch(`/api/email-accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load();
  };
  const del = async (id: number) => {
    if (!(await confirmDialog("این اکانت حذف بشه؟", { danger: true, confirmLabel: "حذف" }))) return;
    await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
    await load();
  };
  const set = (k: keyof typeof BLANK_ACCOUNT) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Section icon="📮" title="اکانت‌های ایمیل" summary={`${fa(accounts.length)} اکانت`} className="!mb-3">
      <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3 text-center">
        هر اکانت API key و آدرس و کانال تلگرام خودش رو داره. ایمیل ورودی هر اکانت توی کانال خودش پست می‌شه و از همونجا می‌تونی ریپلای بدی.
      </p>
      {failed && <div className="mb-3"><ErrorBox text="دریافت اکانت‌ها ناموفق بود." onRetry={load} /></div>}
      {accounts.length > 0 && (
        <div className="flex flex-col gap-2.5 mb-3">
          {accounts.map((a) => (
            <div key={a.id} className="p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 text-center">
              <div className="text-sm font-semibold">{a.name}</div>
              <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                {a.enabled ? <Badge tone="success">فعال</Badge> : <Badge tone="neutral">خاموش</Badge>}
                {!a.hasApiKey && <Badge tone="warn">بدون API key</Badge>}
              </div>
              <div dir="ltr" className="mt-2 text-xs text-[var(--color-text-dim)] break-all">
                {a.fromEmail ?? "—"} · channel {a.tgChannelId ?? "—"}
              </div>
              {a.inboundToken && (
                <code dir="ltr" className="mt-1.5 block text-xs text-[var(--color-text-dim)] break-all">
                  {origin}/api/email-webhook?token={a.inboundToken}
                </code>
              )}
              <div className="mt-3 flex flex-col gap-3">
                <InlineField label="🔗 دومین دکمه‌ها" value={a.publicUrl} placeholder="rateklend.text.bz" onSave={(u) => patch(a.id, { publicUrl: u })} />
                <InlineField label="📥 دومین‌های ورودی" value={a.inboundDomains} placeholder="rateklend.ir, mail.rateklend.ir" onSave={(u) => patch(a.id, { inboundDomains: u })} />
              </div>
              <ResendCheck accountId={a.id} />
              <div className="mt-3 flex">
                <button onClick={() => del(a.id)} className={btnDanger}>🗑 حذف اکانت</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Section icon="➕" title="افزودن اکانت" defaultOpen={accounts.length === 0 && !failed} className="!mb-0">
        <div className="flex flex-col gap-3 text-start">
          <Field label="نام اکانت"><input dir="ltr" value={form.name} onChange={set("name")} placeholder="نام اکانت (مثلاً Sales)" className={inputCls} /></Field>
          <Field label="From"><input dir="ltr" value={form.fromEmail} onChange={set("fromEmail")} placeholder="From: Sales <sales@domain.com>" className={inputCls} /></Field>
          <Field label="Resend API key"><input dir="ltr" value={form.resendApiKey} onChange={set("resendApiKey")} placeholder="Resend API key (re_...)" className={inputCls} /></Field>
          <Field label="Channel ID تلگرام"><input dir="ltr" value={form.tgChannelId} onChange={set("tgChannelId")} placeholder="Channel ID تلگرام (-100...)" className={inputCls} /></Field>
          <Field label="دومین دکمه‌ها"><input dir="ltr" value={form.publicUrl} onChange={set("publicUrl")} placeholder="دومین دکمه‌ها (مثلاً rateklend.text.bz)" className={inputCls} /></Field>
          <Field label="دومین‌های ورودی"><input dir="ltr" value={form.inboundDomains} onChange={set("inboundDomains")} placeholder="دومین‌های ورودی (مثلاً rateklend.ir)" className={inputCls} /></Field>
          <Field label="Inbound token (برای وب‌هوک ورودی)">
            <div className="flex gap-2">
              <input dir="ltr" value={form.inboundToken} onChange={set("inboundToken")} placeholder="Inbound token (برای وب‌هوک ورودی)" className={`${inputCls} flex-1 min-w-0`} />
              <button type="button" onClick={genToken} className={`${btnGhost} shrink-0`}>🎲 ساخت</button>
            </div>
          </Field>
          <div className="flex">
            <button onClick={create} disabled={!form.name} className={btnPrimary}>+ افزودن اکانت</button>
          </div>
        </div>
      </Section>
    </Section>
  );
}

function InlineField({ label, value, placeholder, onSave }: { label: string; value: string | null; placeholder: string; onSave: (u: string) => Promise<void> }) {
  const [v, setV] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = (v.trim() || null) !== (value || null);
  useEffect(() => { setV(value ?? ""); }, [value]);
  const save = async () => {
    setSaving(true);
    try { await onSave(v.trim()); } finally { setSaving(false); }
  };
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input dir="ltr" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className={`${inputCls} flex-1 min-w-0`} />
        {dirty && (
          <button type="button" onClick={save} disabled={saving} className="min-h-11 px-4 rounded-xl border border-[var(--color-accent)] text-[var(--color-accent)] text-sm shrink-0 disabled:opacity-40">
            {saving ? "…" : "ذخیره"}
          </button>
        )}
      </div>
    </Field>
  );
}

function ResendSettings({ origin }: { origin: string }) {
  const [v, setV] = useState({ resendApiKey: "", resendFromEmail: "", resendInboundSecret: "", emailChannelId: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { values: Record<string, string> }) => {
        setV({
          resendApiKey: d.values.resendApiKey ?? "",
          resendFromEmail: d.values.resendFromEmail ?? "",
          resendInboundSecret: d.values.resendInboundSecret ?? "",
          emailChannelId: d.values.emailChannelId ?? "",
        });
      })
      .catch(() => {});
  }, []);
  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const inboundUrl = `${origin}/api/email-webhook?token=${v.resendInboundSecret && v.resendInboundSecret !== "********" ? v.resendInboundSecret : "<INBOUND_SECRET>"}`;
  const field = (label: string, key: keyof typeof v, ph = "") => (
    <Field label={label}>
      <input dir="ltr" value={v[key]} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} placeholder={ph} className={inputCls} />
    </Field>
  );
  return (
    <Section icon="🔑" title="تنظیمات سراسری Resend" summary="API key و وب‌هوک ورودی" className="!mb-0">
      <div className="flex flex-col gap-3 text-start">
        {field("API Key (برای ارسال)", "resendApiKey", "re_...")}
        {field("From (آدرس تأییدشده)", "resendFromEmail", "Bot <mail@yourdomain.com>")}
        {field("Inbound Secret (توکن وب‌هوک ورودی)", "resendInboundSecret", "یه رشته تصادفی")}
        {field("Channel ID ایمیل ورودی (خالی = نقش email_inbox)", "emailChannelId", "-100...")}
        <div className="text-xs leading-6 text-[var(--color-text-dim)]">
          این URL رو توی Resend به‌عنوان Inbound Webhook بذار:
          <code dir="ltr" className="block mt-1 break-all bg-[var(--color-surface-2)] p-2 rounded-xl">{inboundUrl}</code>
        </div>
        <div className="flex">
          <button onClick={save} className={btnPrimary}>{saved ? "✓ ذخیره شد" : "ذخیره"}</button>
        </div>
      </div>
    </Section>
  );
}

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | "">("");
  useEffect(() => {
    fetch("/api/email-accounts")
      .then((r) => r.json())
      .then((d: { accounts: Account[] }) => {
        setAccounts(d.accounts ?? []);
        const first = d.accounts?.[0];
        if (first) setAccountId(first.id);
      })
      .catch(() => {});
  }, []);
  const send = async () => {
    setSending(true);
    setErr(null);
    try {
      const r = await fetch("/api/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc: cc || undefined, subject, text, accountId: accountId || undefined }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && j.ok) { onSent(); onClose(); }
      else setErr(j.error ?? "ارسال ناموفق بود");
    } finally {
      setSending(false);
    }
  };
  // Bottom sheet on phones, centred dialog on desktop (same shape as the in-app confirm dialog).
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-[60]" onClick={onClose}>
      <div dir="rtl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl md:rounded-3xl p-4 pb-6 w-full md:max-w-lg max-h-[92dvh] overflow-y-auto">
        <div className="text-base font-semibold mb-3 text-center">✉️ ایمیل جدید</div>
        <div className="flex flex-col gap-3">
          {accounts.length > 0 && (
            <Field label="از طرف اکانت">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.fromEmail ?? "?"})</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="به"><input dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder="به: someone@example.com" className={inputCls} /></Field>
          <Field label="cc (اختیاری)"><input dir="ltr" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc (اختیاری)" className={inputCls} /></Field>
          <Field label="موضوع"><input dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="موضوع" className={inputCls} /></Field>
          <Field label="متن ایمیل"><textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="متن ایمیل…" className={inputCls} /></Field>
        </div>
        {err && <p role="alert" className="text-sm text-red-300 mt-3 text-center">{err}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={send} disabled={sending || !to || !subject} className={btnPrimary}>
            {sending ? "در حال ارسال…" : "ارسال"}
          </button>
          <button onClick={onClose} className={btnGhost}>انصراف</button>
        </div>
      </div>
    </div>
  );
}


// "🔧 بررسی Resend": asks the server to inspect this account's Resend
// domain + webhook with the stored key, and offers to create the
// email.received webhook when it is missing. Replaces the old manual
// checklist ("go to the Resend dashboard, add a webhook…").
type ResendReport = {
  fromEmail: string | null;
  inboundUrl: string;
  apiKey: "account" | "global" | "missing";
  domain: { wanted: string | null; found: boolean; status?: string; region?: string; unverified: number; records: Array<{ record: string; type: string; name: string; value: string; status?: string }> };
  webhook: { listed: boolean; found: boolean; endpoint?: string; events?: string[]; created?: boolean; error?: string };
  problems: string[];
};

function ResendCheck({ accountId }: { accountId: number }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ResendReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(createWebhook: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/email-accounts/${accountId}/resend-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createWebhook }),
      });
      const j = (await r.json()) as { report?: ResendReport; error?: string };
      if (!r.ok || !j.report) throw new Error(j.error ?? `HTTP ${r.status}`);
      setReport(j.report);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  const ok = report && report.problems.length === 0;
  return (
    <div className="mt-3 text-xs">
      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={() => run(false)} disabled={busy} className={btnGhost}>
          {busy ? "در حال بررسی…" : "🔧 بررسی Resend"}
        </button>
        {report && !report.webhook.found && (
          <button onClick={() => run(true)} disabled={busy} className={`${btnPrimary} min-h-10`}>
            ساخت وب‌هوک email.received
          </button>
        )}
      </div>
      {report && (
        <div className="mt-2 flex justify-center">
          <Badge tone={ok ? "success" : "warn"}>{ok ? "همه‌چیز درسته" : `${fa(report.problems.length)} مشکل`}</Badge>
        </div>
      )}
      {err && <div className="text-rose-300 mt-2 break-all">{err}</div>}
      {report && (
        <div className="mt-2 space-y-1 leading-6 text-[var(--color-text-dim)]">
          <div>
            دومین {report.domain.wanted ?? "—"}: {report.domain.found ? `${report.domain.status ?? "?"}${report.domain.region ? ` · ${report.domain.region}` : ""}` : "ثبت نشده"}
            {report.domain.unverified > 0 && ` · ${fa(report.domain.unverified)} رکورد تأییدنشده`}
          </div>
          <div>
            وب‌هوک: {report.webhook.found ? `✅ ${report.webhook.created ? "ساخته شد" : "موجود"} (${(report.webhook.events ?? []).join(", ")})` : report.webhook.listed ? "❌ نیست" : `؟ ${report.webhook.error ?? ""}`}
          </div>
          <div>from: {report.fromEmail ?? "—"} · کلید: {report.apiKey === "account" ? "اکانت" : report.apiKey === "global" ? "سراسری" : "ندارد"}</div>
          {report.problems.map((p) => (
            <div key={p} className="text-amber-300">⚠ {p}</div>
          ))}
          {report.domain.records.filter((r) => r.status && !/verified/i.test(r.status)).map((r) => (
            <div key={`${r.type}-${r.name}`} dir="ltr" className="font-mono text-xs break-all">
              {r.type} {r.name} → {r.value.slice(0, 60)}{r.value.length > 60 ? "…" : ""} ({r.status})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
