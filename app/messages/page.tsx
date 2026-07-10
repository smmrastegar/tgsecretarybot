"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import MessageActions from "@/components/MessageActions";
import MediaView from "@/components/MediaView";
import OtpChip from "@/components/OtpChip";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

function groupByChat(messages: Message[]): Array<{
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  messages: Message[];
}> {
  const map = new Map<number, Message[]>();
  for (const m of messages) {
    if (!map.has(m.chatId)) map.set(m.chatId, []);
    map.get(m.chatId)!.push(m);
  }
  return [...map.entries()]
    .map(([chatId, msgs]) => {
      const sample = msgs.find((m) => !m.fromOwner) ?? msgs[0]!;
      return {
        chatId,
        chatTitle: msgs[0]!.chatTitle,
        senderName: displaySender(sample),
        messages: msgs,
      };
    })
    .sort((a, b) =>
      b.messages[0]!.createdAt.localeCompare(a.messages[0]!.createdAt),
    );
}

const SOURCE_LABEL: Record<string, { label: string; tone: "info" | "success" | "warn" | "neutral" }> = {
  ai_chat: { label: "AI (خودکار)", tone: "success" },
  ai_dashboard: { label: "AI (دستی)", tone: "success" },
  friendly_reply: { label: "صمیمی", tone: "info" },
  auto_reply: { label: "پاسخ خودکار", tone: "info" },
  owner_dashboard: { label: "داشبورد", tone: "neutral" },
};

// Prefer the per-chat custom label (firstName + lastName / nickname /
// chatTitle) over the raw Telegram-supplied sender_name. Only meaningful
// for DMs — in groups the sender is the individual user, not the chat.
function displaySender(m: {
  chatType: string;
  chatTitle: string | null;
  senderName: string;
  chatFirstName: string | null;
  chatLastName: string | null;
  chatNickname: string | null;
}): string {
  if (m.chatType === "private") {
    const full = [m.chatFirstName, m.chatLastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (full) return full;
    if (m.chatNickname) return m.chatNickname;
  }
  return m.chatTitle ?? m.senderName;
}

type Message = {
  id: number;
  createdAt: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderName: string;
  chatFirstName: string | null;
  chatLastName: string | null;
  chatNickname: string | null;
  messageText: string;
  importance: number;
  urgent: boolean;
  concernsOwner: boolean;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  handledAt: string | null;
  mediaKind: string | null;
  mediaFileId: string | null;
  transcript: string | null;
  transcriptAt: string | null;
  mediaDescription: string | null;
  otpCode: string | null;
  deletedAt: string | null;
  editedAt: string | null;
  editCount: number;
  fromOwner: boolean;
  source: string | null;
  inlineButtons: Array<{ label: string; url: string }> | null;
  isPrivateConversation: boolean;
  privateRevealedAt: string | null;
  chatMode:
    | "off"
    | "secretary"
    | "auto_reply"
    | "friendly_reply"
    | "ai_chat"
    | "ai_listen";
};

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [threaded, setThreaded] = useState(false);
  // First-paint default is "deleted" (the most common audit target),
  // but on mount we restore whatever the operator last picked from
  // localStorage so the choice survives refresh / nav-away-and-back.
  const [kind, setKindState] = useState<"deleted" | "all" | "edited">(
    "deleted",
  );
  const setKind = useCallback((next: "deleted" | "all" | "edited") => {
    setKindState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("messages.kindFilter", next);
      } catch {}
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("messages.kindFilter");
      if (stored === "deleted" || stored === "all" || stored === "edited") {
        setKindState(stored);
      }
    } catch {}
  }, []);
  const [transcribing, setTranscribing] = useState<Set<number>>(new Set());
  const [transcribeMsg, setTranscribeMsg] = useState<Record<number, string>>({});

  async function transcribeAllInChat(chatId: number) {
    setTranscribing((s) => new Set(s).add(chatId));
    setTranscribeMsg((m) => ({ ...m, [chatId]: "" }));
    try {
      const r = await fetch(`/api/chats/${chatId}/transcribe-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as {
        candidates?: number;
        done?: number;
        failed?: number;
        error?: string;
      };
      if (!r.ok) {
        setTranscribeMsg((m) => ({
          ...m,
          [chatId]: j.error ?? `error ${r.status}`,
        }));
      } else {
        setTranscribeMsg((m) => ({
          ...m,
          [chatId]: `${j.done ?? 0} ترانسکریپت شد${j.failed ? ` (${j.failed} ناموفق)` : ""}`,
        }));
        await load();
      }
    } catch (err) {
      setTranscribeMsg((m) => ({
        ...m,
        [chatId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setTranscribing((s) => {
        const next = new Set(s);
        next.delete(chatId);
        return next;
      });
      setTimeout(
        () => setTranscribeMsg((m) => ({ ...m, [chatId]: "" })),
        5000,
      );
    }
  }

  const [secretaries, setSecretaries] = useState<
    { userId: number; name: string }[]
  >([]);
  useEffect(() => {
    fetch("/api/secretaries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.secretaries && setSecretaries(d.secretaries))
      .catch(() => {});
  }, []);

  const PAGE = 15;
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE));
    params.set("offset", "0");
    if (urgentOnly) params.set("urgent", "1");
    if (search) params.set("q", search);
    if (kind !== "all") params.set("kind", kind);
    const r = await fetch(`/api/messages?${params}`);
    const j = (await r.json()) as { messages: Message[] };
    setMessages(j.messages);
    setHasMore(j.messages.length === PAGE);
    setLoading(false);
  }, [search, urgentOnly, kind]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE));
    params.set("offset", String(messages.length));
    if (urgentOnly) params.set("urgent", "1");
    if (search) params.set("q", search);
    if (kind !== "all") params.set("kind", kind);
    const r = await fetch(`/api/messages?${params}`);
    const j = (await r.json()) as { messages: Message[] };
    setMessages((prev) => [...prev, ...j.messages]);
    setHasMore(j.messages.length === PAGE);
    setLoadingMore(false);
  }, [loadingMore, hasMore, messages.length, urgentOnly, search, kind]);

  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  // Infinite scroll — observe a sentinel near the bottom and fire
  // loadMore() when it scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <Shell>
      <PageTitle
        title="همه پیام‌ها"
        subtitle="هر پیام دسته‌بندی‌شده‌ای که ربات دیده."
      />

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجو در متن یا فرستنده…"
          className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm placeholder:text-[var(--color-text-dim)]"
        />
        <div
          role="tablist"
          className="flex border border-[var(--color-border)] rounded-md overflow-hidden text-xs"
        >
          {(
            [
              ["deleted", "🗑 پاک‌شده"],
              ["all", "همه"],
              ["edited", "✎ ویرایش‌شده"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={kind === value}
              onClick={() => setKind(value)}
              className={`px-3 py-2 ${
                kind === value
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 px-3 py-2 border border-[var(--color-border)] rounded-md cursor-pointer hover:bg-[var(--color-surface-2)]">
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={(e) => setUrgentOnly(e.target.checked)}
          />
          فقط فوری‌ها
        </label>
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 px-3 py-2 border border-[var(--color-border)] rounded-md cursor-pointer hover:bg-[var(--color-surface-2)]">
          <input
            type="checkbox"
            checked={threaded}
            onChange={(e) => setThreaded(e.target.checked)}
          />
          گروه‌بندی بر اساس چت
        </label>
      </div>

      {loading ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : messages.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هیچ پیامی مطابقت نداره.
          </p>
        </Card>
      ) : threaded ? (
        <div className="flex flex-col gap-3">
          {groupByChat(messages).map((group) => {
            // The most recent non-owner message in this group is what the
            // owner would act on next (suggest reply, forward, AI, transcribe).
            const target = group.messages.find((m) => !m.fromOwner) ?? group.messages[0]!;
            return (
            <Card key={group.chatId} className="!p-3 md:!p-4 overflow-hidden min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap min-w-0">
                <Link
                  href={`/chats/${group.chatId}`}
                  className="font-medium text-sm hover:underline truncate min-w-0 max-w-full"
                >
                  {group.chatTitle ?? group.senderName}
                </Link>
                <div className="flex gap-1 flex-wrap items-center text-[10px]">
                  <Badge tone="neutral">{group.messages.length} پیام</Badge>
                  <Badge tone="neutral">
                    آخرین {relTime(group.messages[0]!.createdAt)}
                  </Badge>
                  {group.messages.some(
                    (m) =>
                      !m.transcript &&
                      m.mediaKind &&
                      ["voice", "audio", "video_note"].includes(m.mediaKind),
                  ) && (
                    <button
                      onClick={() => transcribeAllInChat(group.chatId)}
                      disabled={transcribing.has(group.chatId)}
                      className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                    >
                      {transcribing.has(group.chatId)
                        ? "در حال..."
                        : "🎙 رونویسی همه"}
                    </button>
                  )}
                </div>
              </div>
              {transcribeMsg[group.chatId] && (
                <div className="text-[11px] text-[var(--color-text-dim)] mb-2">
                  {transcribeMsg[group.chatId]}
                </div>
              )}
              <div className="flex flex-col gap-1 min-w-0">
                {/* Show the newest 5 BUT in chronological order — oldest
                    near the top, newest near the bottom (right above
                    "REPLY TO LAST MESSAGE"), like a real Telegram
                    conversation. The underlying array is newest-first
                    so we slice then reverse. */}
                {group.messages
                  .slice(0, 5)
                  .slice()
                  .reverse()
                  .map((m) => {
                  // For audio kinds (voice / video_note) the transcript
                  // IS the meaningful content so we use it as the bubble
                  // body. For visual kinds the bubble keeps the original
                  // [photo]/[sticker]/[GIF] placeholder (or caption) and
                  // the AI description renders as a separate block below
                  // — that's what the operator asked for.
                  const redactedBody =
                    m.isPrivateConversation && !m.privateRevealedAt;
                  const visibleText = redactedBody
                    ? "🔒 پیام خصوصی"
                    : (m.transcript ?? m.messageText);
                  return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-0.5 max-w-[88%] min-w-0 ${
                      m.fromOwner ? "self-end items-end" : "self-start items-start"
                    }`}
                  >
                    <div className="text-[10px] text-[var(--color-text-dim)] flex items-center gap-1.5 flex-wrap">
                      <span>
                        {m.fromOwner ? "شما" : displaySender(m)} ·{" "}
                        {relTime(m.createdAt)}
                      </span>
                      {m.mediaKind && (
                        <span className="text-[var(--color-text-dim)]">
                          [{m.mediaKind}
                          {m.transcript ? " · 📝" : ""}
                          {m.mediaDescription ? " · 🖼" : ""}
                          ]
                        </span>
                      )}
                      {m.deletedAt && (
                        <Badge tone="danger">
                          🗑 پاک‌شده {relTime(m.deletedAt)}
                        </Badge>
                      )}
                      {m.editCount > 0 && (
                        <Badge tone="warn">
                          ✎ ویرایش‌شده ({m.editCount})
                        </Badge>
                      )}
                    </div>
                    <div
                      dir="auto"
                      style={{
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        // plaintext makes each line auto-detect its
                        // own direction so mixed Persian/English text
                        // renders each line on the correct side.
                        unicodeBidi: "plaintext",
                        textAlign: "start",
                      }}
                      className={`px-2.5 py-1.5 rounded-2xl text-xs whitespace-pre-wrap max-w-full ${
                        m.deletedAt
                          ? "bg-red-900/20 border border-red-900/40 text-[var(--color-text-dim)] rounded-md"
                          : m.fromOwner
                            ? "bg-[var(--color-accent)] text-white rounded-br-md"
                            : "bg-[var(--color-surface-2)] rounded-bl-md"
                      }`}
                    >
                      {m.otpCode && (
                        <div className="mb-1.5">
                          <OtpChip code={m.otpCode} />
                        </div>
                      )}
                      {truncate(visibleText, 200)}
                    </div>
                    {m.inlineButtons && m.inlineButtons.length > 0 && (
                      <div className="flex justify-end">
                        <Link
                          href={`/messages/${m.id}/email`}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--color-accent)] text-white"
                        >
                          📧 HTML
                        </Link>
                      </div>
                    )}
                    {m.mediaKind && !m.deletedAt && (
                      <div className="flex justify-center">
                        <MediaView messageId={m.id} kind={m.mediaKind} />
                      </div>
                    )}
                    {m.mediaDescription && !m.deletedAt && (
                      <div
                        dir="auto"
                        style={{
                          unicodeBidi: "plaintext",
                          textAlign: "start",
                        }}
                        className="text-[10px] text-[var(--color-text-dim)] max-w-full whitespace-pre-wrap break-words border-l-2 border-[var(--color-border)] pl-2"
                      >
                        🖼 {truncate(m.mediaDescription, 200)}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
              {group.messages.length > 5 && (
                <Link
                  href={`/chats/${group.chatId}`}
                  className="block mt-2 text-[11px] text-[var(--color-text-dim)] hover:text-white"
                >
                  دیدن همه {group.messages.length} پیام →
                </Link>
              )}
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                  پاسخ به آخرین پیام از{" "}
                  {target.fromOwner ? "شما" : displaySender(target)}
                </div>
                <MessageActions
                  message={{
                    id: target.id,
                    chatId: target.chatId,
                    chatType: target.chatType,
                    mediaKind: target.mediaKind,
                    transcript: target.transcript,
                    handledAt: target.handledAt,
                    chatMode: target.chatMode,
                  }}
                  secretaries={secretaries}
                  onChange={load}
                  onTranscript={(id, txt) =>
                    setMessages((ms) =>
                      ms.map((mm) =>
                        mm.id === id
                          ? {
                              ...mm,
                              transcript: txt,
                              transcriptAt: new Date().toISOString(),
                            }
                          : mm,
                      ),
                    )
                  }
                />
              </div>
            </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((m) => {
            const srcInfo = m.source ? SOURCE_LABEL[m.source] : null;
            return (
            <Card key={m.id} className="!p-3 md:!p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 flex-wrap min-w-0">
                  <Link
                    href={`/chats/${m.chatId}`}
                    className="hover:underline font-medium text-[var(--color-text)]"
                  >
                    {displaySender(m)}
                  </Link>
                  {m.fromOwner && <Badge tone="info">شما</Badge>}
                  <span>·</span>
                  <Link
                    href={`/chats/${m.chatId}`}
                    className="hover:underline"
                  >
                    {chatTypeLabel(m.chatType)}
                    {m.chatTitle && ` · ${truncate(m.chatTitle, 28)}`}
                  </Link>
                  <span>·</span>
                  <span>{relTime(m.createdAt)}</span>
                </div>
                <div className="flex gap-1 flex-wrap text-[10px]">
                  {!m.fromOwner && (
                    <span className="text-[var(--color-text-dim)]">
                      اهمیت {m.importance}
                    </span>
                  )}
                  {srcInfo && <Badge tone={srcInfo.tone}>{srcInfo.label}</Badge>}
                  {m.urgent && <Badge tone="danger">فوری</Badge>}
                  {m.alerted && <Badge tone="warn">هشدار</Badge>}
                  {m.autoReplied && <Badge tone="info">پاسخ داده شد</Badge>}
                  {m.mediaKind && (
                    <Badge tone="neutral">{m.mediaKind}</Badge>
                  )}
                </div>
              </div>
              {m.otpCode && (
                <div className="mt-2">
                  <OtpChip code={m.otpCode} />
                </div>
              )}
              {m.inlineButtons && m.inlineButtons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Link
                    href={`/messages/${m.id}/email`}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white"
                  >
                    📧 نمایش HTML
                  </Link>
                  {m.inlineButtons.map((b) => (
                    <a
                      key={b.label + b.url}
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    >
                      {b.label} ↗
                    </a>
                  ))}
                </div>
              )}
              <PrivateBody msg={m} />
              {m.transcript && (
                <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)] text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                    رونویسی
                  </div>
                  <div
                    dir="auto"
                    style={{ unicodeBidi: "plaintext", textAlign: "start" }}
                    className="whitespace-pre-wrap break-words"
                  >
                    {m.transcript}
                  </div>
                </div>
              )}
              {m.mediaDescription && (
                <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)] text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                    🖼 تفسیر AI
                  </div>
                  <div
                    dir="auto"
                    style={{ unicodeBidi: "plaintext", textAlign: "start" }}
                    className="whitespace-pre-wrap break-words"
                  >
                    {m.mediaDescription}
                  </div>
                </div>
              )}
              {m.mediaKind && !m.deletedAt && (
                <div className="mt-2 flex justify-center">
                  <MediaView messageId={m.id} kind={m.mediaKind} />
                </div>
              )}
              <MessageActions
                message={{
                  id: m.id,
                  chatId: m.chatId,
                  chatType: m.chatType,
                  mediaKind: m.mediaKind,
                  transcript: m.transcript,
                  handledAt: m.handledAt,
                  chatMode: m.chatMode,
                }}
                secretaries={secretaries}
                onChange={load}
                onTranscript={(id, txt) =>
                  setMessages((ms) =>
                    ms.map((mm) =>
                      mm.id === id
                        ? {
                            ...mm,
                            transcript: txt,
                            transcriptAt: new Date().toISOString(),
                          }
                        : mm,
                    ),
                  )
                }
              />
            </Card>
            );
          })}
        </div>
      )}
      {messages.length > 0 && hasMore && (
        <div
          ref={sentinelRef}
          className="text-center text-[11px] text-[var(--color-text-dim)] py-4"
        >
          {loadingMore ? "در حال بارگذاری بیشتر…" : "اسکرول کن تا بقیه بیاد"}
        </div>
      )}
      {messages.length > 0 && !hasMore && (
        <div className="text-center text-[10px] text-[var(--color-text-dim)] py-4">
          · پایان لیست ({messages.length} پیام) ·
        </div>
      )}
    </Shell>
  );
}

function PrivateBody({ msg }: { msg: Message }) {
  const [isPrivate, setIsPrivate] = useState<boolean>(
    msg.isPrivateConversation,
  );
  const [hasRevealed, setHasRevealed] = useState<boolean>(
    !!msg.privateRevealedAt,
  );
  const [body, setBody] = useState<string>(
    msg.isPrivateConversation && !msg.privateRevealedAt ? "" : msg.messageText,
  );
  const [loading, setLoading] = useState(false);

  // Hidden = AI/operator marked it private AND it hasn't been revealed.
  const hidden = isPrivate && !hasRevealed;

  const reveal = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/messages/${msg.id}/reveal`, {
        method: "POST",
      });
      if (r.ok) {
        const j = (await r.json()) as { body?: string };
        if (j.body != null) setBody(j.body);
        setHasRevealed(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Toggle the private flag (operator override when AI got it wrong).
  // When marking private, also re-hide an already-revealed body.
  const togglePrivate = async () => {
    setLoading(true);
    try {
      const next = !isPrivate;
      const r = await fetch(`/api/messages/${msg.id}/privacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private: next }),
      });
      if (r.ok) {
        setIsPrivate(next);
        setHasRevealed(false);
        if (next) setBody(""); // hide
        else setBody(msg.messageText); // show
      }
    } finally {
      setLoading(false);
    }
  };

  // Re-hide a private message that was already revealed (clears the
  // revealedAt timestamp; flag stays private).
  const rehide = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/messages/${msg.id}/privacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealed: false }),
      });
      if (r.ok) {
        setHasRevealed(false);
        setBody("");
      }
    } finally {
      setLoading(false);
    }
  };

  if (hidden) {
    return (
      <div className="mt-2 p-2 rounded-md bg-amber-500/5 border border-amber-500/30">
        <div className="text-[10px] text-amber-200 mb-2">
          🔒 پیام خصوصی — متن نمایش داده نمی‌شه تا روش کلیک نکنی
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={reveal}
            disabled={loading}
            className="text-xs px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {loading ? "..." : "👁 نمایش متن"}
          </button>
          <button
            onClick={togglePrivate}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] disabled:opacity-50"
            title="خصوصی نیست — همیشه باز نشون بده"
          >
            🔓 خصوصی نیست
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div
        dir="auto"
        style={{ unicodeBidi: "plaintext", textAlign: "start" }}
        className="mt-2 text-sm break-words whitespace-pre-wrap"
      >
        {body || msg.messageText}
      </div>
      <div className="mt-1 flex gap-1.5">
        {isPrivate && hasRevealed ? (
          <button
            onClick={rehide}
            disabled={loading}
            className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            title="دوباره مخفی کن — تا کلیک بعدی روی «نمایش متن» متن دیده نمی‌شه"
          >
            🙈 دوباره مخفی کن
          </button>
        ) : (
          <button
            onClick={togglePrivate}
            disabled={loading}
            className="text-[10px] px-2 py-0.5 rounded-md text-[var(--color-text-dim)] hover:text-amber-200 hover:bg-amber-500/10"
            title="این پیام رو خصوصی علامت بزن — متن مخفی می‌شه تا کلیک کنی"
          >
            🔒 خصوصی کن
          </button>
        )}
      </div>
    </>
  );
}
