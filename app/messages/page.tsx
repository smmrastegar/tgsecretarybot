"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

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
};

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);

  const [transcribing, setTranscribing] = useState<Set<number>>(new Set());

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

  async function transcribe(id: number) {
    setTranscribing((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/messages/${id}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { transcript?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setMessages((ms) =>
        ms.map((m) =>
          m.id === id
            ? { ...m, transcript: j.transcript ?? "", transcriptAt: new Date().toISOString() }
            : m,
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  const canTranscribe = (kind: string | null) =>
    kind === "voice" || kind === "audio" || kind === "video_note" || kind === "video";

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
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <Card key={m.id} className="!p-3 md:!p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 flex-wrap min-w-0">
                  <span>{m.senderName}</span>
                  <span>·</span>
                  <span>{chatTypeLabel(m.chatType)}</span>
                  {m.chatTitle && (
                    <>
                      <span>·</span>
                      <span className="truncate">{truncate(m.chatTitle, 28)}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{relTime(m.createdAt)}</span>
                </div>
                <div className="flex gap-1 flex-wrap text-[10px]">
                  <span className="text-[var(--color-text-dim)]">
                    imp {m.importance}
                  </span>
                  {m.urgent && <Badge tone="danger">urgent</Badge>}
                  {m.alerted && <Badge tone="warn">alert</Badge>}
                  {m.autoReplied && <Badge tone="info">replied</Badge>}
                  {m.mediaKind && (
                    <Badge tone="neutral">{m.mediaKind}</Badge>
                  )}
                </div>
              </div>
              <div className="mt-2 text-sm break-words whitespace-pre-wrap">
                {m.messageText}
              </div>
              {m.transcript && (
                <div className="mt-2 p-2 rounded-md bg-[var(--color-surface-2)] text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1">
                    transcript
                  </div>
                  <div className="whitespace-pre-wrap break-words">
                    {m.transcript}
                  </div>
                </div>
              )}
              {canTranscribe(m.mediaKind) && !m.transcript && (
                <button
                  onClick={() => transcribe(m.id)}
                  disabled={transcribing.has(m.id)}
                  className="mt-2 text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  {transcribing.has(m.id) ? "Transcribing…" : "🎙 Transcribe"}
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
