"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";

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
  const [compose, setCompose] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/emails?direction=${tab}`);
    const j = (await r.json()) as { emails: Email[] };
    setEmails(j.emails ?? []);
    setLoading(false);
  }, [tab]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell>
      <div dir="rtl">
        <PageTitle
          title="📧 Email (Resend)"
          subtitle="دریافت و ارسال ایمیل. ورودی‌ها توی کانال ایمیل هم پست می‌شن."
          actions={
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setCompose(true)} className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white">
                ✉️ ایمیل جدید
              </button>
              <button onClick={() => setShowSettings((v) => !v)} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                ⚙️ تنظیمات Resend
              </button>
            </div>
          }
        />

        {showSettings && (
          <>
            <AccountsManager origin={origin} />
            <ResendSettings origin={origin} />
          </>
        )}

        <div role="tablist" className="flex gap-1.5 mb-3">
          {(["in", "out"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-md border ${
                tab === t
                  ? "bg-[var(--color-accent)] text-white border-transparent"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {t === "in" ? "📥 دریافتی" : "📤 ارسالی"}
            </button>
          ))}
        </div>

        {loading ? (
          <Card><p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p></Card>
        ) : emails.length === 0 ? (
          <Card><p className="text-sm text-[var(--color-text-dim)]">ایمیلی نیست.</p></Card>
        ) : (
          <div className="flex flex-col gap-2">
            {emails.map((e) => (
              <Link key={e.id} href={`/emails/${e.id}`}>
                <Card className="!p-3 hover:bg-[var(--color-surface-2)]">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {e.subject || "(بدون موضوع)"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {e.status === "failed" && <Badge tone="danger">ناموفق</Badge>}
                      {e.status === "sent" && <Badge tone="success">ارسال شد</Badge>}
                      <span className="text-[10px] text-[var(--color-text-dim)]">
                        {new Date(e.createdAt).toLocaleString("fa-IR")}
                      </span>
                    </div>
                  </div>
                  <div dir="ltr" className="text-[11px] text-[var(--color-text-dim)] mt-1 text-left truncate">
                    {e.direction === "in"
                      ? `از: ${e.fromName ? e.fromName + " " : ""}${e.fromEmail ?? "?"}`
                      : `به: ${e.toEmails ?? "?"}`}
                  </div>
                  {e.textBody && (
                    <div dir="auto" className="text-[11px] text-[var(--color-text-dim)] mt-1 line-clamp-2">
                      {e.textBody}
                    </div>
                  )}
                </Card>
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
  enabled: boolean;
  hasApiKey: boolean;
};

function AccountsManager({ origin }: { origin: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ name: "", resendApiKey: "", fromEmail: "", inboundToken: "", tgChannelId: "" });
  const load = useCallback(async () => {
    const r = await fetch("/api/email-accounts");
    const j = (await r.json()) as { accounts: Account[] };
    setAccounts(j.accounts ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const genToken = () => setForm((f) => ({ ...f, inboundToken: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) }));
  const create = async () => {
    if (!form.name) return;
    await fetch("/api/email-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ name: "", resendApiKey: "", fromEmail: "", inboundToken: "", tgChannelId: "" });
    await load();
  };
  const del = async (id: number) => {
    if (!confirm("این اکانت حذف بشه؟")) return;
    await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <Card className="mb-4">
      <div className="text-sm font-medium mb-2">📮 اکانت‌های ایمیل</div>
      <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
        هر اکانت API key و آدرس و کانال تلگرام خودش رو داره. ایمیل ورودی هر اکانت توی کانال خودش پست می‌شه و از همونجا می‌تونی ریپلای بدی.
      </p>
      {accounts.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {a.name}
                  {a.enabled ? <Badge tone="success">فعال</Badge> : <Badge tone="neutral">خاموش</Badge>}
                  {!a.hasApiKey && <Badge tone="warn">بدون API key</Badge>}
                </div>
                <div dir="ltr" className="text-[10px] text-[var(--color-text-dim)] text-left break-all">
                  {a.fromEmail ?? "—"} · channel {a.tgChannelId ?? "—"}
                </div>
                {a.inboundToken && (
                  <code dir="ltr" className="text-[9px] text-[var(--color-text-dim)] block break-all text-left mt-0.5">
                    {origin}/api/email-webhook?token={a.inboundToken}
                  </code>
                )}
              </div>
              <button onClick={() => del(a.id)} className="text-[11px] px-2 py-1 rounded-md border border-rose-500/40 text-rose-200 shrink-0">🗑</button>
            </div>
          ))}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-2">
        <input dir="ltr" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="نام اکانت (مثلاً Sales)" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
        <input dir="ltr" value={form.fromEmail} onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))} placeholder="From: Sales <sales@domain.com>" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
        <input dir="ltr" value={form.resendApiKey} onChange={(e) => setForm((f) => ({ ...f, resendApiKey: e.target.value }))} placeholder="Resend API key (re_...)" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
        <input dir="ltr" value={form.tgChannelId} onChange={(e) => setForm((f) => ({ ...f, tgChannelId: e.target.value }))} placeholder="Channel ID تلگرام (-100...)" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
        <div className="flex gap-1.5 md:col-span-2">
          <input dir="ltr" value={form.inboundToken} onChange={(e) => setForm((f) => ({ ...f, inboundToken: e.target.value }))} placeholder="Inbound token (برای وب‌هوک ورودی)" className="flex-1 text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <button onClick={genToken} className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)]">🎲 ساخت</button>
        </div>
      </div>
      <button onClick={create} disabled={!form.name} className="mt-2 text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-40">+ افزودن اکانت</button>
    </Card>
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
    <label className="block">
      <span className="text-[10px] text-[var(--color-text-dim)]">{label}</span>
      <input dir="ltr" value={v[key]} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} placeholder={ph}
        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] mt-0.5" />
    </label>
  );
  return (
    <Card className="mb-4">
      <div className="text-sm font-medium mb-2">⚙️ تنظیمات Resend</div>
      <div className="grid md:grid-cols-2 gap-2">
        {field("API Key (برای ارسال)", "resendApiKey", "re_...")}
        {field("From (آدرس تأییدشده)", "resendFromEmail", "Bot <mail@yourdomain.com>")}
        {field("Inbound Secret (توکن وب‌هوک ورودی)", "resendInboundSecret", "یه رشته تصادفی")}
        {field("Channel ID ایمیل ورودی (خالی = نقش email_inbox)", "emailChannelId", "-100...")}
      </div>
      <div className="mt-2 text-[10px] text-[var(--color-text-dim)]">
        این URL رو توی Resend به‌عنوان Inbound Webhook بذار:
        <code dir="ltr" className="block mt-1 break-all bg-[var(--color-surface-2)] p-1.5 rounded">{inboundUrl}</code>
      </div>
      <button onClick={save} className="mt-2 text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white">
        {saved ? "✓ ذخیره شد" : "ذخیره"}
      </button>
    </Card>
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
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div dir="rtl" onClick={(e) => e.stopPropagation()} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 w-full max-w-lg">
        <div className="text-sm font-medium mb-3">✉️ ایمیل جدید</div>
        <div className="flex flex-col gap-2">
          {accounts.length > 0 && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")} className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.fromEmail ?? "?"})</option>
              ))}
            </select>
          )}
          <input dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder="به: someone@example.com" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <input dir="ltr" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc (اختیاری)" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <input dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="موضوع" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="متن ایمیل…" className="text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
        </div>
        {err && <p className="text-xs text-red-300 mt-2">{err}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={send} disabled={sending || !to || !subject} className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-40">
            {sending ? "در حال ارسال…" : "ارسال"}
          </button>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">انصراف</button>
        </div>
      </div>
    </div>
  );
}
