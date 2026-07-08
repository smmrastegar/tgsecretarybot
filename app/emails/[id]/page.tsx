"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";

type Email = {
  id: number;
  direction: "in" | "out";
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  summary: string | null;
  attachments: EmailAttachment[] | null;
  status: string | null;
  error: string | null;
  createdAt: string;
};

type EmailAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
};

function humanSize(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const [email, setEmail] = useState<Email | null>(null);
  const [tab, setTab] = useState<"preview" | "summary">(sp.get("tab") === "summary" ? "summary" : "preview");
  const [view, setView] = useState<"text" | "html">("text");
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/emails/${id}`);
    if (r.ok) {
      const j = (await r.json()) as { email: Email };
      setEmail(j.email);
      setSummary(j.email.summary ?? null);
      if (!j.email.htmlBody) setView("text");
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const genSummary = useCallback(async () => {
    setSummarizing(true);
    try {
      const r = await fetch(`/api/emails/${id}/summary`, { method: "POST" });
      const j = (await r.json()) as { stored?: string; error?: string };
      setSummary(j.stored ?? j.error ?? "خطا");
    } finally {
      setSummarizing(false);
    }
  }, [id]);

  useEffect(() => {
    if (tab === "summary" && !summary && email && !summarizing) genSummary();
  }, [tab, summary, email, summarizing, genSummary]);

  if (!email) {
    return (
      <Shell>
        <Card><p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p></Card>
      </Shell>
    );
  }

  const from = email.fromName ? `${email.fromName} <${email.fromEmail ?? ""}>` : email.fromEmail ?? "?";

  return (
    <Shell>
      <div dir="rtl">
        <PageTitle
          title={email.subject || "(بدون موضوع)"}
          subtitle={email.direction === "in" ? `از: ${from}` : `به: ${email.toEmails ?? "?"}`}
          actions={<Link href="/emails" className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">← لیست</Link>}
        />

        <Card className="mb-3">
          <div className="text-[11px] text-[var(--color-text-dim)] flex flex-wrap gap-x-4 gap-y-1" dir="ltr">
            <span>From: {from}</span>
            {email.toEmails && <span>To: {email.toEmails}</span>}
            {email.ccEmails && <span>Cc: {email.ccEmails}</span>}
            <span>{new Date(email.createdAt).toLocaleString()}</span>
            {email.status === "failed" && <Badge tone="danger">failed: {email.error}</Badge>}
          </div>
        </Card>

        <div role="tablist" className="flex gap-1.5 mb-3">
          {(["preview", "summary"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-md border ${tab === t ? "bg-[var(--color-accent)] text-white border-transparent" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"}`}>
              {t === "preview" ? "Preview" : "Summary"}
            </button>
          ))}
          <div className="flex-1" />
          <a href={`/api/emails/${id}/raw?format=text`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">Text ↗</a>
          <a href={`/api/emails/${id}/raw?format=html`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">HTML ↗</a>
        </div>

        {tab === "preview" ? (
          <Card className="mb-3">
            {email.htmlBody && (
              <div className="flex gap-1.5 mb-2">
                {(["text", "html"] as const).map((mv) => (
                  <button key={mv} onClick={() => setView(mv)}
                    className={`text-[11px] px-2 py-1 rounded-md border ${view === mv ? "bg-[var(--color-accent)] text-white border-transparent" : "border-[var(--color-border)]"}`}>
                    {mv === "text" ? "متن" : "HTML"}
                  </button>
                ))}
              </div>
            )}
            {view === "html" && email.htmlBody ? (
              <iframe title="email-html" srcDoc={email.htmlBody} className="w-full h-[60vh] rounded-md bg-white border border-[var(--color-border)]" sandbox="" />
            ) : (
              <div dir="auto" style={{ unicodeBidi: "plaintext", textAlign: "start" }} className="text-sm whitespace-pre-wrap break-words">
                {email.textBody || "(بدون متن)"}
              </div>
            )}
          </Card>
        ) : (
          <Card className="mb-3">
            {summarizing ? (
              <p className="text-sm text-[var(--color-text-dim)]">در حال خلاصه‌سازی…</p>
            ) : summary ? (
              <div dir="auto" className="text-sm whitespace-pre-wrap break-words">{summary}</div>
            ) : (
              <button onClick={genSummary} className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white">🧠 خلاصه‌سازی با AI</button>
            )}
          </Card>
        )}

        {email.attachments && email.attachments.length > 0 && (
          <Card className="mb-3">
            <div className="text-sm font-medium mb-2">📎 پیوست‌ها ({email.attachments.length})</div>
            <div className="flex flex-col gap-1.5">
              {email.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/emails/${email.id}/attachment/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-xs px-2.5 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  dir="ltr"
                >
                  <span>📄</span>
                  <span className="flex-1 truncate">{a.filename || "file"}</span>
                  {a.contentType && <span className="text-[var(--color-text-dim)]">{a.contentType}</span>}
                  {a.size ? <span className="text-[var(--color-text-dim)]">{humanSize(a.size)}</span> : null}
                  <span className="text-[var(--color-accent)]">دانلود ↓</span>
                </a>
              ))}
            </div>
          </Card>
        )}

        {email.direction === "in" && (
          <div>
            {!replying ? (
              <button onClick={() => setReplying(true)} className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white">↩️ پاسخ</button>
            ) : (
              <ReplyBox emailId={email.id} onDone={() => { setReplying(false); load(); }} onCancel={() => setReplying(false)} />
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

function ReplyBox({ emailId, onDone, onCancel }: { emailId: number; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setSending(true);
    setErr(null);
    try {
      const r = await fetch(`/api/emails/${emailId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && j.ok) onDone();
      else setErr(j.error ?? "ارسال ناموفق بود");
    } finally {
      setSending(false);
    }
  };
  return (
    <Card>
      <div className="text-sm font-medium mb-2">↩️ پاسخ</div>
      <textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="متن پاسخ…"
        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
      {err && <p className="text-xs text-red-300 mt-1">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={send} disabled={sending || !text.trim()} className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-40">
          {sending ? "در حال ارسال…" : "ارسال پاسخ"}
        </button>
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]">انصراف</button>
      </div>
    </Card>
  );
}
