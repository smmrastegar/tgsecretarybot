"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Chip, { type ChipTone } from "@/components/dash/Chip";
import MessageActions from "@/components/MessageActions";
import MediaView from "@/components/MediaView";
import OtpChip from "@/components/OtpChip";
import EmptyState from "@/components/ui/EmptyState";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

const fa = (v: number | string) =>
  String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// Secondary button: 44px, outlined.
const BTN =
  "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";

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

const SOURCE_LABEL: Record<string, { label: string; tone: ChipTone }> = {
  ai_chat: { label: "AI (خودکار)", tone: "ok" },
  ai_dashboard: { label: "AI (دستی)", tone: "ok" },
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
          [chatId]: `${fa(j.done ?? 0)} ترانسکریپت شد${j.failed ? ` (${fa(j.failed)} ناموفق)` : ""}`,
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
  const [moreErr, setMoreErr] = useState(false);

  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    setMoreErr(false);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE));
    params.set("offset", "0");
    if (urgentOnly) params.set("urgent", "1");
    if (search) params.set("q", search);
    if (kind !== "all") params.set("kind", kind);
    try {
      const r = await fetch(`/api/messages?${params}`);
      if (!r.ok) throw new Error(`بارگذاری انجام نشد (${fa(r.status)})`);
      const j = (await r.json()) as { messages: Message[] };
      setMessages(j.messages);
      setHasMore(j.messages.length === PAGE);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "ارتباط با سرور برقرار نشد");
    } finally {
      setLoading(false);
    }
  }, [search, urgentOnly, kind]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || moreErr) return;
    setLoadingMore(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE));
    params.set("offset", String(messages.length));
    if (urgentOnly) params.set("urgent", "1");
    if (search) params.set("q", search);
    if (kind !== "all") params.set("kind", kind);
    try {
      const r = await fetch(`/api/messages?${params}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { messages: Message[] };
      setMessages((prev) => [...prev, ...j.messages]);
      setHasMore(j.messages.length === PAGE);
    } catch {
      setMoreErr(true); // no auto-retry (the scroll sentinel would loop); the button below retries
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, moreErr, messages.length, urgentOnly, search, kind]);

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

  const onTranscript = (id: number, txt: string) =>
    setMessages((ms) =>
      ms.map((mm) =>
        mm.id === id
          ? { ...mm, transcript: txt, transcriptAt: new Date().toISOString() }
          : mm,
      ),
    );

  return (
    <Shell>
      <PageTitle
        title="همه پیام‌ها"
        subtitle="هر پیام دسته‌بندی‌شده‌ای که ربات دیده."
      />

      <Card className="mb-3 !p-3">
        <div className="flex flex-col gap-2.5">
          <input
            dir="auto"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="جستجو"
            placeholder="جستجو در متن یا فرستنده…"
            className="w-full min-h-11 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 text-sm text-center placeholder:text-[var(--color-text-dim)]"
          />
          <div
            role="tablist"
            className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--color-surface-2)]"
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
                className={`min-h-10 px-1 min-[360px]:px-2 rounded-lg text-xs min-[360px]:text-sm whitespace-nowrap ${
                  kind === value
                    ? "bg-[var(--color-accent)] text-white font-medium"
                    : "text-[var(--color-text-dim)] active:bg-[var(--color-surface)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-h-11 flex items-center justify-center gap-2 px-2 text-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] cursor-pointer">
              <input
                type="checkbox"
                checked={urgentOnly}
                onChange={(e) => setUrgentOnly(e.target.checked)}
              />
              فقط فوری‌ها
            </label>
            <label className="min-h-11 flex items-center justify-center gap-2 px-2 text-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] cursor-pointer">
              <input
                type="checkbox"
                checked={threaded}
                onChange={(e) => setThreaded(e.target.checked)}
              />
              به تفکیک چت
            </label>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : loadErr ? (
        <Card>
          <p role="alert" className="text-sm text-rose-300">{loadErr}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN}>تلاش دوباره</button>
          </div>
        </Card>
      ) : messages.length === 0 ? (
        <EmptyState
          icon="💬"
          title="هیچ پیامی مطابقت نداره."
          hint="فیلتر یا عبارت جستجو را عوض کن."
          action={
            (search || urgentOnly || kind !== "all") ? (
              <button
                onClick={() => { setSearch(""); setUrgentOnly(false); setKind("all"); }}
                className={BTN}
              >
                پاک کردن فیلترها
              </button>
            ) : undefined
          }
        />
      ) : threaded ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {groupByChat(messages).map((group) => {
            // The most recent non-owner message in this group is what the
            // owner would act on next (suggest reply, forward, AI, transcribe).
            const target = group.messages.find((m) => !m.fromOwner) ?? group.messages[0]!;
            return (
            <Card key={group.chatId} className="!p-3 md:!p-4 overflow-hidden min-w-0">
              <div className="min-w-0">
                <Link
                  href={`/chats/${group.chatId}`}
                  dir="auto"
                  className="flex items-center justify-center min-h-10 text-sm font-semibold hover:underline"
                >
                  <span className="truncate">{group.chatTitle ?? group.senderName}</span>
                </Link>
                <div className="mt-1.5 flex gap-1.5 flex-wrap items-center justify-center">
                  <Chip>{fa(group.messages.length)} پیام</Chip>
                  <Chip>آخرین {relTime(group.messages[0]!.createdAt)}</Chip>
                </div>
              </div>
              {group.messages.some(
                (m) =>
                  !m.transcript &&
                  m.mediaKind &&
                  ["voice", "audio", "video_note"].includes(m.mediaKind),
              ) && (
                <div className="mt-2 flex">
                  <button
                    onClick={() => transcribeAllInChat(group.chatId)}
                    disabled={transcribing.has(group.chatId)}
                    className={BTN}
                  >
                    {transcribing.has(group.chatId)
                      ? "در حال..."
                      : "🎙 رونویسی همه"}
                  </button>
                </div>
              )}
              {transcribeMsg[group.chatId] && (
                <div role="status" className="mt-2 text-xs text-[var(--color-text-dim)]">
                  {transcribeMsg[group.chatId]}
                </div>
              )}
              {/* A conversation: bubbles are start/end aligned like in Telegram itself (the one place a
                  card's content is not centred, because the side tells who wrote it). */}
              <div className="mt-3 flex flex-col gap-2 min-w-0">
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
                    className={`flex flex-col gap-1 max-w-[90%] min-w-0 ${
                      m.fromOwner ? "self-end items-end" : "self-start items-start"
                    }`}
                  >
                    <div className="text-xs text-[var(--color-text-dim)] flex items-center gap-1.5 flex-wrap">
                      <span>
                        {m.fromOwner ? "شما" : displaySender(m)} ·{" "}
                        {relTime(m.createdAt)}
                      </span>
                      {m.mediaKind && (
                        <span>
                          [{m.mediaKind}
                          {m.transcript ? " · 📝" : ""}
                          {m.mediaDescription ? " · 🖼" : ""}
                          ]
                        </span>
                      )}
                      {m.deletedAt && (
                        <Chip tone="danger">
                          🗑 پاک‌شده {relTime(m.deletedAt)}
                        </Chip>
                      )}
                      {m.editCount > 0 && (
                        <Chip tone="warn">
                          ✎ ویرایش‌شده ({fa(m.editCount)})
                        </Chip>
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
                      className={`px-3 py-2 rounded-2xl text-sm leading-6 whitespace-pre-wrap max-w-full ${
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
                      <Link
                        href={`/messages/${m.id}/email`}
                        className="min-h-10 inline-flex items-center px-3 rounded-xl text-xs bg-[var(--color-accent)] text-white"
                      >
                        📧 HTML
                      </Link>
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
                        className="text-xs leading-6 text-[var(--color-text-dim)] max-w-full whitespace-pre-wrap break-words border-s-2 border-[var(--color-border)] ps-2"
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
                  className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-dim)] hover:text-white"
                >
                  دیدن همه {fa(group.messages.length)} پیام ‹
                </Link>
              )}
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <div className="text-xs text-[var(--color-text-dim)]">
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
                  onTranscript={onTranscript}
                />
              </div>
            </Card>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {messages.map((m) => {
            const srcInfo = m.source ? SOURCE_LABEL[m.source] : null;
            return (
            <Card key={m.id} className="!p-3 md:!p-4 min-w-0">
              <Link
                href={`/chats/${m.chatId}`}
                className="block min-w-0 min-h-11 py-0.5 hover:underline"
              >
                <span dir="auto" className="block text-sm font-semibold truncate">
                  {displaySender(m)}
                </span>
                <span className="block text-xs text-[var(--color-text-dim)] truncate">
                  {relTime(m.createdAt)} · {chatTypeLabel(m.chatType)}
                  {m.chatTitle && ` · ${m.chatTitle}`}
                </span>
              </Link>
              <div className="mt-2 flex gap-1.5 flex-wrap items-center justify-center">
                {m.fromOwner && <Chip tone="info">شما</Chip>}
                {!m.fromOwner && <Chip>اهمیت {fa(m.importance)}</Chip>}
                {srcInfo && <Chip tone={srcInfo.tone}>{srcInfo.label}</Chip>}
                {m.urgent && <Chip tone="danger">فوری</Chip>}
                {m.alerted && <Chip tone="warn">هشدار</Chip>}
                {m.autoReplied && <Chip tone="info">پاسخ داده شد</Chip>}
                {m.mediaKind && <Chip>{m.mediaKind}</Chip>}
                {m.deletedAt && <Chip tone="danger">🗑 پاک‌شده</Chip>}
                {m.editCount > 0 && <Chip tone="warn">✎ ویرایش‌شده ({fa(m.editCount)})</Chip>}
              </div>
              {m.otpCode && (
                <div className="mt-2">
                  <OtpChip code={m.otpCode} />
                </div>
              )}
              {m.inlineButtons && m.inlineButtons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 [justify-content:left]">
                  <Link
                    href={`/messages/${m.id}/email`}
                    className="min-h-11 inline-flex items-center px-3 rounded-xl text-sm bg-[var(--color-accent)] text-white"
                  >
                    📧 نمایش HTML
                  </Link>
                  {m.inlineButtons.map((b) => (
                    <a
                      key={b.label + b.url}
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-11 inline-flex items-center px-3 rounded-xl text-sm border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] max-w-full"
                    >
                      <span className="truncate">{b.label} ↗</span>
                    </a>
                  ))}
                </div>
              )}
              <PrivateBody msg={m} />
              {m.transcript && (
                <div className="mt-2 p-2.5 rounded-xl bg-[var(--color-surface-2)] text-sm">
                  <div className="text-xs text-[var(--color-text-dim)] mb-1">
                    رونویسی
                  </div>
                  <div
                    dir="auto"
                    style={{ unicodeBidi: "plaintext" }}
                    className="whitespace-pre-wrap break-words leading-7"
                  >
                    {m.transcript}
                  </div>
                </div>
              )}
              {m.mediaDescription && (
                <div className="mt-2 p-2.5 rounded-xl bg-[var(--color-surface-2)] text-sm">
                  <div className="text-xs text-[var(--color-text-dim)] mb-1">
                    🖼 تفسیر AI
                  </div>
                  <div
                    dir="auto"
                    style={{ unicodeBidi: "plaintext" }}
                    className="whitespace-pre-wrap break-words leading-7"
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
                onTranscript={onTranscript}
              />
            </Card>
            );
          })}
        </div>
      )}
      {messages.length > 0 && hasMore && (
        <div
          ref={sentinelRef}
          className="text-center text-xs text-[var(--color-text-dim)] py-5"
        >
          {moreErr ? (
            <>
              <p role="alert" className="text-rose-300">بارگذاری ادامه انجام نشد.</p>
              <button onClick={() => setMoreErr(false)} className={`${BTN} mt-2`}>تلاش دوباره</button>
            </>
          ) : loadingMore ? "در حال بارگذاری بیشتر…" : "اسکرول کن تا بقیه بیاد"}
        </div>
      )}
      {messages.length > 0 && !hasMore && (
        <div className="text-center text-xs text-[var(--color-text-dim)] py-5">
          · پایان لیست ({fa(messages.length)} پیام) ·
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
      <div className="mt-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/30">
        <div className="text-xs leading-6 text-amber-200 mb-2">
          🔒 پیام خصوصی — متن نمایش داده نمی‌شه تا روش کلیک نکنی
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={reveal}
            disabled={loading}
            className="min-h-11 px-2 text-sm rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 active:bg-amber-500/25 disabled:opacity-50"
          >
            {loading ? "..." : "👁 نمایش متن"}
          </button>
          <button
            onClick={togglePrivate}
            disabled={loading}
            className={BTN}
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
        style={{ unicodeBidi: "plaintext" }}
        className="mt-3 text-sm leading-7 break-words whitespace-pre-wrap"
      >
        {body || msg.messageText}
      </div>
      <div className="mt-1 flex">
        {isPrivate && hasRevealed ? (
          <button
            onClick={rehide}
            disabled={loading}
            className="min-h-10 px-3 text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 active:bg-amber-500/20 disabled:opacity-50"
            title="دوباره مخفی کن — تا کلیک بعدی روی «نمایش متن» متن دیده نمی‌شه"
          >
            🙈 دوباره مخفی کن
          </button>
        ) : (
          <button
            onClick={togglePrivate}
            disabled={loading}
            className="min-h-10 px-3 text-xs rounded-xl text-[var(--color-text-dim)] active:bg-amber-500/10"
            title="این پیام رو خصوصی علامت بزن — متن مخفی می‌شه تا کلیک کنی"
          >
            🔒 خصوصی کن
          </button>
        )}
      </div>
    </>
  );
}
