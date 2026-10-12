"use client";

import { useState } from "react";
import MediaView from "@/components/MediaView";
import OtpChip from "@/components/OtpChip";
import EmptyState from "@/components/ui/EmptyState";
import Section from "@/components/ui/Section";
import { relTime, truncate } from "@/lib/format";
import { Chip, btnCls, fa } from "./shared";
import type { Message, MessageEdit } from "./types";

function EditHistoryToggle({ messageId, count, editedAt }: { messageId: number; count: number; editedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<MessageEdit[] | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (edits) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/messages/${messageId}/edits`);
      if (r.ok) {
        const j = (await r.json()) as { edits: MessageEdit[] };
        setEdits(j.edits);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={toggle} title={editedAt ? `آخرین ویرایش ${relTime(editedAt)}` : undefined}
        className="min-h-10 inline-flex items-center gap-1 px-3 rounded-xl text-xs bg-amber-900/40 text-amber-300 border border-amber-800 active:bg-amber-900/60">
        ✎ ویرایش‌شده ({fa(count)})
      </button>
      {open && (
        <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-3 text-xs max-w-full text-start">
          {loading && <span className="text-[var(--color-text-dim)]">در حال بارگذاری…</span>}
          {edits && edits.length === 0 && <span className="text-[var(--color-text-dim)]">تاریخچه‌ای نیست</span>}
          {edits && edits.length > 0 && (
            <div className="flex flex-col gap-2">
              {edits.map((e) => (
                <div key={e.id} className="border-s-2 border-amber-700 ps-2">
                  <div className="text-xs text-[var(--color-text-dim)]">قبل از {relTime(e.editedAt)}:</div>
                  <div dir="auto" className="whitespace-pre-wrap line-through opacity-80">{e.previousText || "(خالی)"}</div>
                  {e.previousTranscript && <div dir="auto" className="mt-1 text-xs text-[var(--color-text-dim)] line-through">رونویسی: {e.previousTranscript}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function ChatBubble({ m, mine, onPrivacyChange }: { m: Message; mine: boolean; onPrivacyChange: (next: Message) => void }) {
  const [isPrivate, setIsPrivate] = useState<boolean>(m.isPrivateConversation);
  const [hasRevealed, setHasRevealed] = useState<boolean>(!!m.privateRevealedAt);
  const [body, setBody] = useState<string>(m.isPrivateConversation && !m.privateRevealedAt ? "" : m.messageText);
  const [busy, setBusy] = useState(false);

  const hidden = isPrivate && !hasRevealed;

  async function reveal() {
    setBusy(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/reveal`, { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as { body?: string };
        if (j.body != null) setBody(j.body);
        setHasRevealed(true);
        onPrivacyChange({ ...m, privateRevealedAt: new Date().toISOString() });
      }
    } finally {
      setBusy(false);
    }
  }

  async function togglePrivate() {
    setBusy(true);
    try {
      const next = !isPrivate;
      const r = await fetch(`/api/messages/${m.id}/privacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private: next }),
      });
      if (r.ok) {
        setIsPrivate(next);
        setHasRevealed(false);
        if (next) setBody("");
        else setBody(m.messageText);
        onPrivacyChange({ ...m, isPrivateConversation: next, privateRevealedAt: null });
      }
    } finally {
      setBusy(false);
    }
  }

  async function rehide() {
    setBusy(true);
    try {
      const r = await fetch(`/api/messages/${m.id}/privacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealed: false }),
      });
      if (r.ok) {
        setHasRevealed(false);
        setBody("");
        onPrivacyChange({ ...m, privateRevealedAt: null });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1 max-w-[92%] min-w-0 ${mine ? "self-end items-end" : "self-start items-start"}`}>
      <div className="text-xs text-[var(--color-text-dim)] px-1">{mine ? "شما" : m.senderName} · {relTime(m.createdAt)}</div>
      {hidden ? (
        <div className="p-3 rounded-2xl text-sm bg-amber-500/5 border border-amber-500/30 max-w-full text-start">
          <div className="text-amber-200 text-sm leading-6 mb-2">🔒 پیام خصوصی — متن نمایش داده نمی‌شه تا روش کلیک نکنی</div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={reveal} disabled={busy}
              className="min-h-10 px-3 rounded-xl text-sm bg-amber-500/15 border border-amber-500/40 text-amber-200 active:bg-amber-500/25 disabled:opacity-50">{busy ? "..." : "👁 نمایش متن"}</button>
            <button type="button" onClick={togglePrivate} disabled={busy} className={`${btnCls} text-xs`} title="خصوصی نیست — همیشه باز نشون بده">🔓 خصوصی نیست</button>
          </div>
        </div>
      ) : (
        <div dir="auto" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          className={`p-3 rounded-2xl text-sm leading-7 whitespace-pre-wrap max-w-full text-start ${
            m.deletedAt
              ? "bg-red-900/20 border border-red-900/40 text-[var(--color-text-dim)] rounded-md"
              : mine
                ? "bg-[var(--color-accent)] text-white rounded-br-md"
                : "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-bl-md"
          }`}>
          {m.otpCode && <div className="mb-2"><OtpChip code={m.otpCode} /></div>}
          {body || m.messageText}
          {m.transcript && (
            <div dir="auto" className="mt-2 pt-2 border-t border-white/10 text-sm">
              <span className="opacity-70 text-xs">رونویسی</span>
              <div dir="auto" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }} className="mt-1 whitespace-pre-wrap">{truncate(m.transcript, 400)}</div>
            </div>
          )}
        </div>
      )}
      {m.mediaKind && !m.deletedAt && <MediaView messageId={m.id} kind={m.mediaKind} />}
      {m.mediaDescription && !m.deletedAt && (
        <div dir="auto" style={{ unicodeBidi: "plaintext", textAlign: "start", overflowWrap: "anywhere", wordBreak: "break-word" }}
          className="text-xs leading-6 text-[var(--color-text-dim)] max-w-full whitespace-pre-wrap border-s-2 border-[var(--color-border)] ps-2 mt-1">
          🖼 {m.mediaDescription}
        </div>
      )}
      <div className="flex gap-1.5 flex-wrap text-xs px-1 items-center">
        {m.deletedAt && <Chip tone="danger">🗑 پاک‌شده {relTime(m.deletedAt)}</Chip>}
        {m.editCount > 0 && <EditHistoryToggle messageId={m.id} count={m.editCount} editedAt={m.editedAt} />}
        {m.urgent && <Chip tone="danger">فوری</Chip>}
        {m.alerted && <Chip tone="warn">هشدار</Chip>}
        {m.autoReplied && <Chip tone="info">پاسخ داده شد</Chip>}
        {m.mediaKind && <Chip>{m.mediaKind}</Chip>}
        {!mine && <span className="text-[var(--color-text-dim)]">اهمیت {fa(m.importance)}</span>}
        {!hidden &&
          (isPrivate && hasRevealed ? (
            <button type="button" onClick={rehide} disabled={busy} title="دوباره مخفی کن"
              className="min-h-10 px-3 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 active:bg-amber-500/20 disabled:opacity-50">🙈 دوباره مخفی کن</button>
          ) : (
            <button type="button" onClick={togglePrivate} disabled={busy} title="این پیام رو خصوصی علامت بزن" aria-label="خصوصی کن"
              className="min-h-10 min-w-10 grid place-items-center rounded-xl text-sm text-[var(--color-text-dim)] active:text-amber-200 active:bg-amber-500/10 disabled:opacity-50">🔒</button>
          ))}
      </div>
    </div>
  );
}

// Newest messages of the chat, oldest at the top; older ones are fetched ten at a time.
export default function MessagesSection({ messages, total, hasMore, loadingMore, onLoadMore, onPrivacyChange }: {
  messages: Message[]; total: number | null; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; onPrivacyChange: (next: Message) => void;
}) {
  return (
    <Section icon="💬" title="گفتگو" defaultOpen
      summary={total != null && total > 0 ? `${fa(total)} پیام ثبت‌شده · آخرین‌ها را ببین` : "آخرین پیام‌های این چت"}>
      {messages.length === 0 ? (
        <EmptyState icon="💬" title="هنوز هیچ پیامی برای این چت ثبت نشده." />
      ) : (
        <div className="flex flex-col gap-3 text-start">
          {hasMore && (
            <button type="button" onClick={onLoadMore} disabled={loadingMore} className={`${btnCls} self-center`}>
              {loadingMore ? "در حال بارگذاری…" : "↑ بارگذاری ۱۰ پیام قدیمی‌تر"}
            </button>
          )}
          {[...messages].reverse().map((m) => (
            <ChatBubble key={m.id} m={m} mine={m.fromOwner} onPrivacyChange={onPrivacyChange} />
          ))}
        </div>
      )}
    </Section>
  );
}
