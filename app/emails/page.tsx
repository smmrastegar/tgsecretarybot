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

        {showSettings && <ResendSettings origin={origin} />}

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
  const send = async () => {
    setSending(true);
    setErr(null);
    try {
      const r = await fetch("/api/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc: cc || undefined, subject, text }),
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
