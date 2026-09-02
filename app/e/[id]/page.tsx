import { authorizeEmailLink } from "@/lib/email-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function humanSize(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Public (no-login) email view. Auth is the ?t= HMAC token in the URL,
// exactly like the Telegram card links carry. No session required.
export default async function PublicEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const emailId = Number(id);

  const email = await authorizeEmailLink(emailId, t ?? "");
  if (!email) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 18 }}>لینک نامعتبر است</h1>
      </main>
    );
  }

  const from = email.fromName
    ? `${email.fromName} <${email.fromEmail ?? ""}>`
    : email.fromEmail ?? "?";
  const attachments = email.attachments ?? [];
  const token = t ?? "";

  return (
    <main
      dir="rtl"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: 20,
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#0f172a",
        background: "#fff",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>
        {email.subject || "(بدون موضوع)"}
      </h1>
      <div
        dir="ltr"
        style={{
          fontSize: 12,
          color: "#64748b",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: 10,
          marginBottom: 14,
        }}
      >
        <span>From: {from}</span>
        {email.toEmails && <span>To: {email.toEmails}</span>}
        {email.ccEmails && <span>Cc: {email.ccEmails}</span>}
        <span>{new Date(email.createdAt).toLocaleString()}</span>
      </div>

      {attachments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            📎 پیوست‌ها ({attachments.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {attachments.map((a) => (
              <a
                key={a.id}
                href={`/api/public/emails/${emailId}/attachment/${a.id}?t=${token}`}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  padding: "8px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "#0f172a",
                }}
              >
                <span>📄</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.filename || "file"}
                </span>
                {a.contentType && <span style={{ color: "#94a3b8" }}>{a.contentType}</span>}
                {a.size ? <span style={{ color: "#94a3b8" }}>{humanSize(a.size)}</span> : null}
                <span style={{ color: "#2563eb" }}>دانلود ↓</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {email.htmlBody ? (
        <iframe
          title="email-html"
          srcDoc={email.htmlBody}
          sandbox=""
          style={{ width: "100%", height: "70vh", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" }}
        />
      ) : (
        <pre
          dir="auto"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, fontFamily: "inherit" }}
        >
          {email.textBody || "(بدون متن)"}
        </pre>
      )}
    </main>
  );
}
