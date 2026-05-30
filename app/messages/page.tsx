"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge, TableWrap } from "@/components/Card";
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
};

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);

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
      </div>

      <Card>
        {loading ? (
          <p className="text-sm text-[var(--color-text-dim)]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-[var(--color-text-dim)]">
            No messages match.
          </p>
        ) : (
          <TableWrap>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-[var(--color-text-dim)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-normal pb-2 pr-3">When</th>
                <th className="text-left font-normal pb-2 pr-3">Chat</th>
                <th className="text-left font-normal pb-2 pr-3">From</th>
                <th className="text-left font-normal pb-2 pr-3">Message</th>
                <th className="text-right font-normal pb-2">Imp</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                >
                  <td className="py-2 pr-3 text-xs text-[var(--color-text-dim)] whitespace-nowrap">
                    {relTime(m.createdAt)}
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    <span className="text-[var(--color-text-dim)]">
                      {chatTypeLabel(m.chatType)}
                    </span>
                    {m.chatTitle && (
                      <span className="block">{truncate(m.chatTitle, 28)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    {m.senderName}
                  </td>
                  <td className="py-2 pr-3">
                    {truncate(m.messageText, 120)}
                    {m.urgent && (
                      <span className="ml-2 align-middle inline-block">
                        <Badge tone="danger">urgent</Badge>
                      </span>
                    )}
                    {m.alerted && (
                      <span className="ml-1 align-middle inline-block">
                        <Badge tone="warn">alert</Badge>
                      </span>
                    )}
                    {m.autoReplied && (
                      <span className="ml-1 align-middle inline-block">
                        <Badge tone="info">replied</Badge>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right text-xs">{m.importance}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        )}
      </Card>
    </Shell>
  );
}
