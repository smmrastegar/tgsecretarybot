"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";

// Renders the full webhook URL the operator pastes into the
// SMS-Forwarder Android app's "Webhook URL" field. The token is
// pulled live from settings so re-saving regenerates the URL
// without a page reload. We use window.location.origin client-side
// so the URL matches whichever domain the dashboard is opened on
// (prod / preview / localhost).
export default function SmsWebhookUrl({ secret }: { secret: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const trimmed = secret.trim();
  const url = trimmed && origin
    ? `${origin}/api/sms-webhook?token=${encodeURIComponent(trimmed)}`
    : "";
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <Card>
      <h2 className="text-sm font-semibold mb-1">
        📱 SMS Forwarder — Webhook URL
      </h2>
      <p className="text-[11px] text-[var(--color-text-dim)] mb-3">
        تو اپ <b>SMS Forwarder</b> اندروید فقط فیلد <b>Webhook URL</b> رو با
        این آدرس عوض کن. بقیه‌ی پارامترها (chat_id، Json Payload Template،
        Headers، ...) همون که هست بمونه. اپ payload رو همینجوری POST می‌کنه
        — bot متن رو می‌گیره، تو <code>/messages</code> ثبت می‌کنه، LLM gate
        رو می‌زنه، صاحب شماره رو پیدا می‌کنه، و به <code>sms_inbox</code>
        فوروارد می‌کنه. کد OTP هم خودش extract می‌شه و tap-to-copy رندر
        می‌شه.
      </p>
      {!trimmed ? (
        <div className="p-2 rounded-md bg-amber-900/30 border border-amber-800 text-[11px] text-amber-200">
          ⚠ هنوز <code>smsWebhookSecret</code> ست نشده. پایین فیلد رو با
          یه رشته‌ی random پر کن، Save بزن، بعد URL اینجا ظاهر می‌شه.
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <code
            dir="ltr"
            className="flex-1 min-w-0 text-[11px] tabular-nums break-all bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          >
            {url || "…"}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={!url}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {copied ? "✓ کپی شد" : "📋 کپی"}
          </button>
        </div>
      )}
    </Card>
  );
}
