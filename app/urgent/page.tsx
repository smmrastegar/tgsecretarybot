"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { chatTypeLabel, relTime } from "@/lib/format";

type Message = {
  id: number;
  createdAt: string;
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  senderName: string;
  messageText: string;
  importance: number;
  reason: string;
  alerted: boolean;
  autoReplied: boolean;
  handledAt: string | null;
};

export default function UrgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHandled, setShowHandled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const url = `/api/messages?urgent=1${showHandled ? "" : "&unhandled=1"}`;
    const r = await fetch(url);
    const j = (await r.json()) as { messages: Message[] };
    setMessages(j.messages);
    setLoading(false);
  }, [showHandled]);

  useEffect(() => {
    load();
  }, [load]);

  async function setHandled(id: number, handled: boolean) {
    await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handled }),
    });
    load();
  }

  return (
    <Shell>
      <PageTitle
        title="Urgent inbox"
        subtitle="Messages the AI flagged as urgent and concerning you."
        actions={
          <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
            <input
              type="checkbox"
              checked={showHandled}
              onChange={(e) => setShowHandled(e.target.checked)}
            />
            Show handled
          </label>
        }
      />

      {loading ? (
        <Card>Loading…</Card>
      ) : messages.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            Inbox zero. No urgent messages pending.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-[var(--color-text-dim)] mb-2 flex items-center gap-2 flex-wrap">
                    <span>{m.senderName}</span>
                    <span>·</span>
                    <span>{chatTypeLabel(m.chatType)}</span>
                    {m.chatTitle && (
                      <>
                        <span>·</span>
                        <span>{m.chatTitle}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{relTime(m.createdAt)}</span>
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {m.messageText}
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] mt-2 italic">
                    {m.reason}
                  </div>
                  <div className="mt-3 flex gap-2 flex-wrap">
                    <Badge tone="danger">imp {m.importance}/10</Badge>
                    {m.alerted && <Badge tone="warn">alerted</Badge>}
                    {m.autoReplied && <Badge tone="info">auto-replied</Badge>}
                    {m.handledAt && <Badge tone="success">handled</Badge>}
                  </div>
                </div>
                <div className="shrink-0">
                  {m.handledAt ? (
                    <button
                      onClick={() => setHandled(m.id, false)}
                      className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    >
                      Unhandle
                    </button>
                  ) : (
                    <button
                      onClick={() => setHandled(m.id, true)}
                      className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white"
                    >
                      Mark handled
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </Shell>
  );
}
