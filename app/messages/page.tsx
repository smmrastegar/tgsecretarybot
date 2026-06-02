"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import MessageActions from "@/components/MessageActions";
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
    .map(([chatId, msgs]) => ({
      chatId,
      chatTitle: msgs[0]!.chatTitle,
      senderName:
        msgs.find((m) => !m.fromOwner)?.senderName ?? msgs[0]!.senderName,
      messages: msgs,
    }))
    .sort((a, b) =>
      b.messages[0]!.createdAt.localeCompare(a.messages[0]!.createdAt),
    );
}

const SOURCE_LABEL: Record<string, { label: string; tone: "info" | "success" | "warn" | "neutral" }> = {
  ai_chat: { label: "AI (auto)", tone: "success" },
  ai_dashboard: { label: "AI (manual)", tone: "success" },
  friendly_reply: { label: "Friendly", tone: "info" },
  auto_reply: { label: "Auto-reply", tone: "info" },
  owner_dashboard: { label: "Dashboard", tone: "neutral" },
};

type Message = {
  id: number;
  createdAt: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderName: string;
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
  deletedAt: string | null;
  editedAt: string | null;
  editCount: number;
  fromOwner: boolean;
  source: string | null;
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

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (urgentOnly) params.set("urgent", "1");
    if (search) params.set("q", search);
    const r = await fetch(`/api/messages?${params}`);
    const j = (await r.json()) as { messages: Message[] };
    setMessages(j.messages);
    setLoading(false);
  }, [search, urgentOnly]);


  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <Shell>
      <PageTitle
        title="All messages"
        subtitle="Every classified message the bot has seen."
      />

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search text or sender…"
          className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm placeholder:text-[var(--color-text-dim)]"
        />
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 px-3 py-2 border border-[var(--color-border)] rounded-md cursor-pointer hover:bg-[var(--color-surface-2)]">
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={(e) => setUrgentOnly(e.target.checked)}
          />
          Urgent only
        </label>
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 px-3 py-2 border border-[var(--color-border)] rounded-md cursor-pointer hover:bg-[var(--color-surface-2)]">
          <input
            type="checkbox"
            checked={threaded}
            onChange={(e) => setThreaded(e.target.checked)}
          />
          Group by chat
        </label>
      </div>

      {loading ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">Loading…</p>
        </Card>
      ) : messages.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            No messages match.
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
                  <Badge tone="neutral">{group.messages.length} msg</Badge>
                  <Badge tone="neutral">
                    last {relTime(group.messages[0]!.createdAt)}
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
                        : "🎙 Transcribe همه"}
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
                {group.messages.slice(0, 5).map((m) => {
                  const visibleText = m.transcript
                    ? m.transcript
                    : m.mediaDescription
                      ? m.mediaDescription
                      : m.messageText;
                  return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-0.5 max-w-[88%] min-w-0 ${
                      m.fromOwner ? "self-end items-end" : "self-start items-start"
                    }`}
                  >
                    <div className="text-[10px] text-[var(--color-text-dim)] flex items-center gap-1.5 flex-wrap">
                      <span>
                        {m.fromOwner ? "you" : m.senderName} ·{" "}
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
                          🗑 Deleted {relTime(m.deletedAt)}
                        </Badge>
                      )}
                      {m.editCount > 0 && (
                        <Badge tone="warn">
                          ✎ edited ({m.editCount})
                        </Badge>
                      )}
                    </div>
                    <div
                      dir="auto"
                      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      className={`px-2.5 py-1.5 rounded-2xl text-xs whitespace-pre-wrap max-w-full ${
                        m.deletedAt
                          ? "bg-red-900/20 border border-red-900/40 text-[var(--color-text-dim)] line-through rounded-md"
                          : m.fromOwner
                            ? "bg-[var(--color-accent)] text-white rounded-br-md"
                            : "bg-[var(--color-surface-2)] rounded-bl-md"
                      }`}
                    >
                      {truncate(visibleText, 200)}
                    </div>
                  </div>
                  );
                })}
              </div>
              {group.messages.length > 5 && (
                <Link
                  href={`/chats/${group.chatId}`}
                  className="block mt-2 text-[11px] text-[var(--color-text-dim)] hover:text-white"
                >
                  View all {group.messages.length} messages →
                </Link>
              )}
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                  Reply to last message from{" "}
                  {target.fromOwner ? "you" : target.senderName}
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
                    {m.senderName}
                  </Link>
                  {m.fromOwner && <Badge tone="info">you</Badge>}
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
                      imp {m.importance}
                    </span>
                  )}
                  {srcInfo && <Badge tone={srcInfo.tone}>{srcInfo.label}</Badge>}
                  {m.urgent && <Badge tone="danger">urgent</Badge>}
                  {m.alerted && <Badge tone="warn">alert</Badge>}
                  {m.autoReplied && <Badge tone="info">replied</Badge>}
                  {m.mediaKind && (
                    <Badge tone="neutral">{m.mediaKind}</Badge>
                  )}
                </div>
              </div>
              <div
                dir="auto"
                className="mt-2 text-sm break-words whitespace-pre-wrap"
              >
                {m.messageText}
              </div>
              {m.transcript && (
                <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)] text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                    transcript
                  </div>
                  <div
                    dir="auto"
                    className="whitespace-pre-wrap break-words"
                  >
                    {m.transcript}
                  </div>
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
    </Shell>
  );
}
