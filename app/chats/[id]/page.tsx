"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

type ChatMode = "off" | "secretary" | "auto_reply" | "friendly_reply" | "ai_chat";

const MODE_LABELS: Record<ChatMode, string> = {
  off: "Off",
  secretary: "Secretary",
  auto_reply: "Auto-reply",
  friendly_reply: "Friendly auto-reply (AI)",
  ai_chat: "AI chat (full)",
};

type Message = {
  id: number;
  createdAt: string;
  senderName: string;
  senderUsername: string | null;
  senderId: number | null;
  messageText: string;
  importance: number;
  urgent: boolean;
  alerted: boolean;
  autoReplied: boolean;
  mediaKind: string | null;
  transcript: string | null;
};

type Rule = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode: ChatMode;
  modeChangedAt: string;
  updatedAt: string;
};

type Stats = {
  priorCount: number;
  urgentCount: number;
  lastSeen: string | null;
  firstSeen: string | null;
};

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const chatId = Number(params.id);
  const [rule, setRule] = useState<Rule | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(chatId)) return;
    setLoading(true);
    const r = await fetch(`/api/chats/${chatId}`);
    if (!r.ok) {
      setLoading(false);
      return;
    }
    const j = (await r.json()) as {
      rule: Rule | null;
      messages: Message[];
      stats: Stats;
    };
    setRule(j.rule);
    setMessages(j.messages);
    setStats(j.stats);
    setLoading(false);
  }, [chatId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patchRule(patch: Partial<Rule>) {
    setSaving(true);
    const sample = messages[0];
    await fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: rule?.chatType ?? sample?.senderId ? "private" : "private",
        chatTitle: rule?.chatTitle ?? null,
        vip: rule?.vip ?? false,
        muted: rule?.muted ?? false,
        customReply: rule?.customReply ?? null,
        notes: rule?.notes ?? null,
        mode: rule?.mode ?? "secretary",
        ...patch,
      }),
    });
    setSaving(false);
    load();
  }

  const headPerson = messages.find((m) => m.senderId !== null && m.senderName);
  const personName =
    rule?.chatTitle ??
    headPerson?.senderName ??
    (chatId ? `chat ${chatId}` : "—");
  const personHandle = headPerson?.senderUsername;
  const personId = headPerson?.senderId ?? chatId;

  return (
    <Shell>
      <div className="mb-3">
        <Link
          href="/chats"
          className="text-xs text-[var(--color-text-dim)] hover:text-white"
        >
          ← Chats
        </Link>
      </div>

      {loading ? (
        <Card>Loading…</Card>
      ) : (
        <>
          {/* Hero: person header */}
          <Card className="mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xl font-semibold truncate">{personName}</div>
                <div className="text-xs text-[var(--color-text-dim)] mt-1 flex flex-wrap items-center gap-2">
                  {personHandle && <span>@{personHandle}</span>}
                  <span>id {personId}</span>
                  <span>· {chatTypeLabel(rule?.chatType ?? "private")}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1 items-center">
                  {rule?.vip && <Badge tone="warn">⭐ VIP</Badge>}
                  {rule?.muted && <Badge tone="neutral">🔕 muted</Badge>}
                  {rule?.customReply && (
                    <Badge tone="info">custom reply</Badge>
                  )}
                  {stats && stats.priorCount > 0 && (
                    <Badge tone="neutral">
                      {stats.priorCount} messages
                    </Badge>
                  )}
                  {stats && stats.urgentCount > 0 && (
                    <Badge tone="danger">{stats.urgentCount}× urgent</Badge>
                  )}
                  {stats?.firstSeen && (
                    <Badge tone="neutral">
                      since {relTime(stats.firstSeen)}
                    </Badge>
                  )}
                </div>
                {rule?.notes && (
                  <div className="mt-3 text-sm text-[var(--color-text-dim)]">
                    📝 {rule.notes}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <label className="text-xs text-[var(--color-text-dim)]">
                Mode:
              </label>
              <select
                disabled={saving}
                value={rule?.mode ?? "secretary"}
                onChange={(e) =>
                  patchRule({ mode: e.target.value as ChatMode })
                }
                className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
              >
                {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              {rule?.modeChangedAt && (
                <span className="text-[10px] text-[var(--color-text-dim)]">
                  switched {relTime(rule.modeChangedAt)}
                </span>
              )}
              <button
                disabled={saving}
                onClick={() => patchRule({ vip: !(rule?.vip ?? false) })}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  rule?.vip
                    ? "border-amber-700 bg-amber-900/40 text-amber-200"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {rule?.vip ? "★ VIP on" : "Mark VIP"}
              </button>
              <button
                disabled={saving}
                onClick={() => patchRule({ muted: !(rule?.muted ?? false) })}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  rule?.muted
                    ? "border-[var(--color-border)] bg-[var(--color-surface-2)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {rule?.muted ? "🔕 muted" : "Mute"}
              </button>
            </div>
          </Card>

          <PageTitle title="Last 10 messages" />

          {messages.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                No messages logged for this chat yet.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((m) => (
                <Card key={m.id} className="!p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="text-xs text-[var(--color-text-dim)] flex items-center gap-2 flex-wrap min-w-0">
                      <span>{m.senderName}</span>
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
                        {truncate(m.transcript, 400)}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
