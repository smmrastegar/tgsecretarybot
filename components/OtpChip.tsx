"use client";

import { useState } from "react";

// Tap-to-copy chip rendered above a message when messages_log.otp_code
// is set. Click copies the bare digits to the clipboard and flashes
// "✓ کپی شد" for a second.
export default function OtpChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-700 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-100 text-xs font-mono tabular-nums select-all"
      title="کلیک کن تا کد کپی بشه"
    >
      🔑 <span className="tracking-wider">{code}</span>
      <span className="text-emerald-300/70 text-[10px]">
        {copied ? "✓ کپی شد" : "📋"}
      </span>
    </button>
  );
}
