"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { PageTitle, Badge } from "@/components/Card";
import { ErrorBox, Field, LoadingBox, Segmented, btnGhost, btnPrimary, cardCls, fa, inputCls } from "@/components/tool-pages/Controls";

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
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"preview" | "summary">(sp.get("tab") === "summary" ? "summary" : "preview");
  const [view, setView] = useState<"text" | "html">("text");
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await fetch(`/api/emails/${id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { email: Email };
      setEmail(j.email);
      setSummary(j.email.summary ?? null);
      if (!j.email.htmlBody) setView("text");
    } catch {
      setFailed(true);
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
        <div className="max-w-2xl mx-auto">
          {failed ? (
            <>
              <ErrorBox text="دریافت ایمیل ناموفق بود." onRetry={load} />
              <div className="mt-3 flex"><Link href="/emails" className={`${btnGhost} inline-flex items-center`}>← لیست</Link></div>
            </>
          ) : (
            <LoadingBox />
          )}
        </div>
      </Shell>
    );
  }

  const from = email.fromName ? `${email.fromName} <${email.fromEmail ?? ""}>` : email.fromEmail ?? "?";

  return (
    <Shell>
      <div dir="rtl" className="max-w-2xl mx-auto">
        <PageTitle
          title={email.subject || "(بدون موضوع)"}
          subtitle={email.direction === "in" ? `از: ${from}` : `به: ${email.toEmails ?? "?"}`}
          actions={<Link href="/emails" className={`${btnGhost} inline-flex items-center`}>← لیست</Link>}
        />

        {/* header lines are LTR email metadata: label above value, centred like every card */}
        <div className={`${cardCls} mb-3 flex flex-col gap-2.5`} dir="ltr">
          <Meta k="From" v={from} />
          {email.toEmails && <Meta k="To" v={email.toEmails} />}
          {email.ccEmails && <Meta k="Cc" v={email.ccEmails} />}
          <Meta k="Date" v={new Date(email.createdAt).toLocaleString()} />
          {email.status === "failed" && <div className="flex justify-center"><Badge tone="danger">failed: {email.error}</Badge></div>}
        </div>

        <div className="mb-3">
          <Segmented value={tab} onChange={setTab} options={[{ id: "preview", label: "Preview" }, { id: "summary", label: "Summary" }]} />
        </div>

        {tab === "preview" ? (
          <div className={`${cardCls} mb-3`}>
            {email.htmlBody && (
              <div className="mb-3">
                <Segmented value={view} onChange={setView} options={[{ id: "text", label: "متن" }, { id: "html", label: "HTML" }]} />
              </div>
            )}
            {view === "html" && email.htmlBody ? (
              <iframe title="email-html" srcDoc={email.htmlBody} className="w-full h-[60vh] rounded-xl bg-white border border-[var(--color-border)]" sandbox="" />
            ) : (
              // the message body is reading text: start-aligned, not centred
              <div dir="auto" style={{ unicodeBidi: "plaintext", textAlign: "start" }} className="text-sm leading-7 whitespace-pre-wrap break-words">
                {email.textBody || "(بدون متن)"}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`/api/emails/${id}/raw?format=text`} target="_blank" rel="noreferrer" className={`${btnGhost} inline-flex items-center`}>Text ↗</a>
              <a href={`/api/emails/${id}/raw?format=html`} target="_blank" rel="noreferrer" className={`${btnGhost} inline-flex items-center`}>HTML ↗</a>
            </div>
          </div>
        ) : (
          <div className={`${cardCls} mb-3`}>
            {summarizing ? (
              <p className="text-sm text-[var(--color-text-dim)] py-4">در حال خلاصه‌سازی…</p>
            ) : summary ? (
              <div dir="auto" className="text-sm leading-7 whitespace-pre-wrap break-words">{summary}</div>
            ) : (
              <button onClick={genSummary} className={btnPrimary}>🧠 خلاصه‌سازی با AI</button>
            )}
          </div>
        )}

        {email.attachments && email.attachments.length > 0 && (
          <div className={`${cardCls} mb-3`}>
            <div className="text-sm font-semibold mb-2">📎 پیوست‌ها ({fa(email.attachments.length)})</div>
            <div className="flex flex-col gap-2">
              {email.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/emails/${email.id}/attachment/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 min-h-14 px-3 py-2 rounded-xl border border-[var(--color-border)] active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]"
                  dir="ltr"
                >
                  <span aria-hidden className="text-xl">📄</span>
                  <span className="min-w-0 flex-1 text-center">
                    <span className="block text-sm truncate">{a.filename || "file"}</span>
                    <span className="block text-xs text-[var(--color-text-dim)] truncate">{[a.contentType, humanSize(a.size)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-xs text-[var(--color-accent)] shrink-0">دانلود ↓</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {email.direction === "in" && (
          <div>
            {!replying ? (
              <div className="flex"><button onClick={() => setReplying(true)} className={btnPrimary}>↩️ پاسخ</button></div>
            ) : (
              <ReplyBox emailId={email.id} onDone={() => { setReplying(false); load(); }} onCancel={() => setReplying(false)} />
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--color-text-dim)]">{k}</div>
      <div className="text-sm break-words">{v}</div>
    </div>
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
    <div className={cardCls}>
      <div className="text-sm font-semibold mb-3">↩️ پاسخ</div>
      <Field label="متن پاسخ">
        <textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="متن پاسخ…" className={inputCls} />
      </Field>
      {err && <p role="alert" className="text-sm text-red-300 mt-2">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={send} disabled={sending || !text.trim()} className={btnPrimary}>
          {sending ? "در حال ارسال…" : "ارسال پاسخ"}
        </button>
        <button onClick={onCancel} className={btnGhost}>انصراف</button>
      </div>
    </div>
  );
}
