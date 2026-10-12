"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";

type Btn = { label: string; url: string };

type ListResponse = { buttons: Btn[] };

type ContentResponse = {
  url: string;
  contentType: string;
  body: string;
  error?: string;
  detail?: string;
};

// Pick the most useful default tab from the list. The email-bridge
// channels typically expose "HTML" / "Preview" / "Text" / "Summary"
// / "Debug" — HTML is what the user actually wants to read.
const DEFAULT_LABEL_PRIORITY = [
  "html",
  "preview",
  "text",
  "summary",
  "debug",
];

function pickDefault(buttons: Btn[]): Btn | null {
  if (buttons.length === 0) return null;
  for (const candidate of DEFAULT_LABEL_PRIORITY) {
    const hit = buttons.find((b) => b.label.toLowerCase() === candidate);
    if (hit) return hit;
  }
  return buttons[0]!;
}

const fa = (v: number) =>
  String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

export default function EmailViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const msgId = Number(id);
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingBody, setLoadingBody] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Initial list fetch (also the "تلاش دوباره" of a failed list).
  const loadList = useCallback(async () => {
    setLoadingList(true);
    setErr(null);
    try {
      const r = await fetch(`/api/messages/${msgId}/email-html`);
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `failed ${r.status}`);
      }
      const j = (await r.json()) as ListResponse;
      setButtons(j.buttons);
      const def = pickDefault(j.buttons);
      if (def) setActiveLabel(def.label);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, [msgId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Fetch body whenever the active label changes.
  const loadBody = useCallback(
    async (label: string) => {
      setLoadingBody(true);
      setErr(null);
      setContent(null);
      try {
        const r = await fetch(
          `/api/messages/${msgId}/email-html?label=${encodeURIComponent(label)}`,
        );
        const j = (await r.json()) as ContentResponse;
        if (!r.ok) {
          throw new Error(
            j.error
              ? `${j.error}${j.detail ? `: ${j.detail}` : ""}`
              : `failed ${r.status}`,
          );
        }
        setContent(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingBody(false);
      }
    },
    [msgId],
  );

  useEffect(() => {
    if (activeLabel) loadBody(activeLabel);
  }, [activeLabel, loadBody]);

  const looksHtml = useMemo(() => {
    if (!content) return false;
    if (content.contentType.toLowerCase().includes("html")) return true;
    return /<\s*(html|body|div|table|p|head)\b/i.test(content.body.slice(0, 500));
  }, [content]);

  // Iframe srcDoc gets a CSP that blocks scripts/forms/network, so a
  // hostile email body can't execute or beacon. Persian RTL hint via
  // body dir auto.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeDoc = useMemo(() => {
    if (!content || !looksHtml) return "";
    const csp =
      "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src https: http: data:;";
    const wrap = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;margin:0;padding:1rem;color:#111;background:#fff}a{color:#1d4ed8;word-break:break-word}img{max-width:100%;height:auto}</style></head><body dir="auto">${content.body}</body></html>`;
    return wrap;
  }, [content, looksHtml]);

  const tabBtn =
    "min-h-11 px-4 rounded-xl border text-sm active:bg-[var(--color-surface-2)]";

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
      dir="rtl"
    >
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Link
            href="/messages"
            className="shrink-0 min-h-11 inline-flex items-center px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)]"
          >
            ← پیام‌ها
          </Link>
          <div className="min-w-0 flex-1 text-center text-sm text-[var(--color-text-dim)] truncate">
            پیام #{fa(msgId)}
          </div>
          {content ? (
            <a
              href={content.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 min-h-11 inline-flex items-center px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)]"
            >
              ↗ باز کن
            </a>
          ) : (
            <span aria-hidden className="shrink-0 w-4" />
          )}
        </div>
        {buttons.length > 0 && (
          <div role="tablist" className="flex gap-2 flex-wrap justify-center">
            {buttons.map((b) => {
              const active = b.label === activeLabel;
              return (
                <button
                  key={b.label + b.url}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveLabel(b.label)}
                  className={`${tabBtn} ${
                    active
                      ? "bg-[var(--color-accent)] text-white border-transparent"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="p-3 md:p-4 text-center">
        {loadingList && (
          <p className="py-8 text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        )}
        {err && (
          <div role="alert" className="mb-3 p-4 rounded-2xl border border-red-800 bg-red-900/20 text-red-200 text-sm leading-7">
            {err}
            <div className="mt-3 flex">
              <button
                onClick={() => (activeLabel ? void loadBody(activeLabel) : void loadList())}
                className="min-h-11 px-4 rounded-xl border border-red-700 text-sm active:bg-red-900/40"
              >
                تلاش دوباره
              </button>
            </div>
          </div>
        )}
        {!loadingList && buttons.length === 0 && !err && (
          <EmptyState icon="📭" title="این پیام دکمه‌ای ندارد." />
        )}
        {loadingBody && (
          <p className="py-8 text-sm text-[var(--color-text-dim)]">
            در حال بارگذاری «{activeLabel}»…
          </p>
        )}
        {content && looksHtml && (
          <iframe
            ref={iframeRef}
            srcDoc={iframeDoc}
            sandbox=""
            title="محتوای ایمیل"
            className="w-full min-h-[75dvh] bg-white rounded-xl border border-[var(--color-border)]"
          />
        )}
        {content && !looksHtml && (
          // raw text of an email: left/start aligned and wrapped, it is a document not a card
          <pre
            dir="auto"
            className="text-sm leading-7 text-start whitespace-pre-wrap break-words bg-[var(--color-surface-2)] rounded-xl p-3"
          >
            {content.body}
          </pre>
        )}
      </main>
    </div>
  );
}
