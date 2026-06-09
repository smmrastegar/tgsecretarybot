"use client";

import { useState } from "react";

// Click-to-copy chat ID — small chip that flashes "✓ کپی شد" on
// successful copy. Used in /chats/[id] header so the operator can
// grab the id when wiring it into a rule's recipient list.
export default function CopyableChatId({ chatId }: { chatId: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(chatId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] text-[10px] tabular-nums"
      title="کلیک کن تا id کپی بشه"
    >
      <span>id: {chatId}</span>
      <span className="text-[var(--color-text-dim)]">
        {copied ? "✓" : "📋"}
      </span>
    </button>
  );
}
