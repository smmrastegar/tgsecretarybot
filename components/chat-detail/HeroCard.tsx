"use client";

import { useState } from "react";
import { Card } from "@/components/Card";
import { chatTypeLabel, relTime } from "@/lib/format";
import { Chip, fa } from "./shared";
import { RELATIONSHIP_LABELS, RELATIONSHIP_TONES, type Rule, type Stats } from "./types";

// Click-to-copy chat id chip (flashes "✓" on success), sized for a thumb.
function CopyId({ chatId }: { chatId: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(chatId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button type="button" onClick={copy} title="کلیک کن تا id کپی بشه"
      className="min-h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs tabular-nums active:bg-[var(--color-surface)]">
      <span dir="ltr">id: {chatId}</span>
      <span aria-hidden className="text-xs text-[var(--color-text-dim)]">{copied ? "✓" : "📋"}</span>
    </button>
  );
}

// Who this chat is: name, handle, id, type and the state flags at a glance.
export default function HeroCard({ chatId, rule, stats, personName, personHandle }: {
  chatId: number; rule: Rule | null; stats: Stats | null; personName: string; personHandle?: string | null;
}) {
  const type = chatTypeLabel(rule?.chatType && rule.chatType !== "private" ? rule.chatType : chatId < 0 ? "supergroup" : "private");
  return (
    <Card className="mb-3">
      <h1 className="text-xl font-semibold leading-8 line-clamp-2 [overflow-wrap:anywhere]" dir="auto">{personName}</h1>
      {rule?.nickname && <div className="text-sm text-[var(--color-text-dim)]" dir="auto">({rule.nickname})</div>}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-text-dim)]">
        {personHandle && <span dir="ltr">@{personHandle}</span>}
        <CopyId chatId={chatId} />
        <span>{type}</span>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {rule?.ignored && <Chip tone="danger">🚫 ignored</Chip>}
        {rule?.vip && <Chip tone="warn">⭐ VIP</Chip>}
        {rule?.muted && <Chip>🔕 muted</Chip>}
        {rule?.customReply && <Chip tone="info">پاسخ سفارشی</Chip>}
        {rule?.relationship && <Chip tone={RELATIONSHIP_TONES[rule.relationship]}>{RELATIONSHIP_LABELS[rule.relationship]}</Chip>}
        {stats && stats.priorCount > 0 && <Chip>{fa(stats.priorCount)} پیام</Chip>}
        {stats && stats.urgentCount > 0 && <Chip tone="danger">{fa(stats.urgentCount)}× فوری</Chip>}
        {stats?.firstSeen && <Chip>از {relTime(stats.firstSeen)}</Chip>}
      </div>
      {rule?.notes && <p className="mt-3 text-sm leading-6 text-[var(--color-text-dim)] line-clamp-3 [overflow-wrap:anywhere]" dir="auto">📝 {rule.notes}</p>}
    </Card>
  );
}
