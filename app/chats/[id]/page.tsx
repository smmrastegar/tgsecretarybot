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
  fromOwner: boolean;
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
  secretaryUserId: number | null;
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
  const [secretaries, setSecretaries] = useState<
    { userId: number; name: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const PAGE = 10;

  const load = useCallback(async () => {
    if (!Number.isFinite(chatId)) return;
    setLoading(true);
    const r = await fetch(`/api/chats/${chatId}?limit=${PAGE}&offset=0`);
    if (!r.ok) {
      setLoading(false);
      return;
    }
    const j = (await r.json()) as {
      rule: Rule | null;
      messages: Message[];
      stats: Stats;
      hasMore: boolean;
    };
    setRule(j.rule);
    setMessages(j.messages);
    setStats(j.stats);
    setHasMore(j.hasMore);
    setLoading(false);
  }, [chatId]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `/api/chats/${chatId}?limit=${PAGE}&offset=${messages.length}`,
      );
      if (!r.ok) return;
      const j = (await r.json()) as {
        messages: Message[];
        hasMore: boolean;
      };
      setMessages((prev) => [...prev, ...j.messages]);
      setHasMore(j.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/secretaries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.secretaries && setSecretaries(d.secretaries))
      .catch(() => {});
  }, [load]);

  async function patchRule(patch: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: rule?.chatType ?? "private",
        chatTitle: rule?.chatTitle ?? null,
        vip: rule?.vip ?? false,
        muted: rule?.muted ?? false,
        customReply: rule?.customReply ?? null,
        notes: rule?.notes ?? null,
        mode: rule?.mode ?? "secretary",
        secretaryUserId: rule?.secretaryUserId ?? null,
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

            {(rule?.mode === "secretary" || !rule?.mode) &&
              secretaries.length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-[var(--color-text-dim)]">
                    Forward to:
                  </span>
                  <select
                    disabled={saving}
                    value={String(rule?.secretaryUserId ?? "")}
                    onChange={(e) =>
                      patchRule({
                        secretaryUserId: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                  >
                    <option value="">
                      Default ({secretaries[0]?.name ?? "—"})
                    </option>
                    {secretaries.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {rule?.secretaryUserId && (
                    <span className="text-[10px] text-[var(--color-text-dim)]">
                      override active
                    </span>
                  )}
                </div>
              )}
          </Card>

          <PageTitle title="Conversation" />

          {messages.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                No messages logged for this chat yet.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {[...messages].reverse().map((m) => {
                const mine = m.fromOwner;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-1 max-w-[90%] min-w-0 ${
                      mine ? "self-end items-end" : "self-start items-start"
                    }`}
                  >
                    <div className="text-[10px] text-[var(--color-text-dim)] px-1">
                      {mine ? "You" : m.senderName} · {relTime(m.createdAt)}
                    </div>
                    <div
                      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      className={`p-3 rounded-2xl text-sm whitespace-pre-wrap max-w-full ${
                        mine
                          ? "bg-[var(--color-accent)] text-white rounded-br-md"
                          : "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-bl-md"
                      }`}
                    >
                      {m.messageText}
                      {m.transcript && (
                        <div className="mt-2 pt-2 border-t border-white/10 text-[12px]">
                          <span className="opacity-70 text-[10px] uppercase">
                            transcript
                          </span>
                          <div
                            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                            className="mt-1 whitespace-pre-wrap"
                          >
                            {truncate(m.transcript, 400)}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap text-[10px] px-1">
                      {m.urgent && <Badge tone="danger">urgent</Badge>}
                      {m.alerted && <Badge tone="warn">alert</Badge>}
                      {m.autoReplied && <Badge tone="info">replied</Badge>}
                      {m.mediaKind && (
                        <Badge tone="neutral">{m.mediaKind}</Badge>
                      )}
                      {!mine && (
                        <span className="text-[var(--color-text-dim)]">
                          imp {m.importance}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="self-center text-xs px-4 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 mt-3"
                >
                  {loadingMore ? "Loading…" : "Load 10 more older messages"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
