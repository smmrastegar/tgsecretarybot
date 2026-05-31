"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge, TableWrap } from "@/components/Card";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

type ChatMode = "off" | "secretary" | "auto_reply" | "friendly_reply" | "ai_chat";

const MODE_LABELS: Record<ChatMode, string> = {
  off: "Off",
  secretary: "Secretary",
  auto_reply: "Auto-reply",
  friendly_reply: "Friendly auto-reply (AI)",
  ai_chat: "AI chat (full)",
};

const MODE_TONES: Record<
  ChatMode,
  "neutral" | "success" | "warn" | "danger" | "info"
> = {
  off: "neutral",
  secretary: "warn",
  auto_reply: "info",
  friendly_reply: "info",
  ai_chat: "success",
};

type Chat = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  messages: number;
  urgent: number;
  lastSeen: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  mode: ChatMode;
  modeChangedAt: string | null;
  aiCostUsd: number;
  aiTokens: number;
};

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Chat | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/chats");
    const j = (await r.json()) as { chats: Chat[] };
    setChats(j.chats);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(c: Chat) {
    await fetch(`/api/chats/${c.chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: c.chatType,
        chatTitle: c.chatTitle,
        vip: c.vip,
        muted: c.muted,
        customReply: c.customReply || null,
        mode: c.mode,
      }),
    });
    setEdit(null);
    load();
  }

  async function quickMode(c: Chat, mode: ChatMode) {
    await fetch(`/api/chats/${c.chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: c.chatType,
        chatTitle: c.chatTitle,
        mode,
      }),
    });
    load();
  }

  return (
    <Shell>
      <PageTitle
        title="Chats"
        subtitle="Tune per-chat behavior. VIP = always alert. Muted = ignore entirely."
      />

      {loading ? (
        <Card>Loading…</Card>
      ) : chats.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            No chats yet. Once messages arrive they'll appear here.
          </p>
        </Card>
      ) : (
        <>
        {/* Mobile: card list */}
        <div className="md:hidden flex flex-col gap-2 mb-4">
          {chats.map((c) => (
            <Card key={c.chatId} className="!p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    {c.chatTitle ?? `chat ${c.chatId}`}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                    {chatTypeLabel(c.chatType)} · id {c.chatId} · {relTime(c.lastSeen)}
                  </div>
                </div>
                <button
                  onClick={() => setEdit(c)}
                  className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] shrink-0"
                >
                  Edit
                </button>
              </div>
              <select
                value={c.mode}
                onChange={(e) => quickMode(c, e.target.value as ChatMode)}
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs mb-2"
              >
                {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              {c.modeChangedAt && (
                <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                  switched {relTime(c.modeChangedAt)}
                </div>
              )}
              <div className="flex flex-wrap gap-1 items-center text-[10px]">
                <span className="text-[var(--color-text-dim)]">
                  {c.messages} msg
                </span>
                {c.urgent > 0 && <Badge tone="danger">{c.urgent} urg</Badge>}
                {c.vip && <Badge tone="warn">VIP</Badge>}
                {c.muted && <Badge tone="neutral">muted</Badge>}
                {c.customReply && <Badge tone="info">custom</Badge>}
                {c.aiCostUsd > 0 && (
                  <span className="text-[var(--color-text-dim)] ml-auto">
                    ${c.aiCostUsd.toFixed(4)}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Desktop: table */}
        <Card className="hidden md:block">
          <TableWrap>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-[var(--color-text-dim)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-normal pb-2 pr-3">Chat</th>
                <th className="text-left font-normal pb-2 pr-3">Mode</th>
                <th className="text-left font-normal pb-2 pr-3">Last seen</th>
                <th className="text-right font-normal pb-2 pr-3">Messages</th>
                <th className="text-right font-normal pb-2 pr-3">Urgent</th>
                <th className="text-right font-normal pb-2 pr-3">AI $</th>
                <th className="text-left font-normal pb-2 pr-3">Flags</th>
                <th className="text-right font-normal pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {chats.map((c) => (
                <tr
                  key={c.chatId}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="py-3 pr-3">
                    <div className="font-medium">
                      {c.chatTitle ?? `chat ${c.chatId}`}
                    </div>
                    <div className="text-xs text-[var(--color-text-dim)]">
                      {chatTypeLabel(c.chatType)} · id {c.chatId}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <select
                      value={c.mode}
                      onChange={(e) =>
                        quickMode(c, e.target.value as ChatMode)
                      }
                      className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
                    >
                      {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                    {c.modeChangedAt && (
                      <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                        switched {relTime(c.modeChangedAt)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[var(--color-text-dim)]">
                    {relTime(c.lastSeen)}
                  </td>
                  <td className="py-3 pr-3 text-right">{c.messages}</td>
                  <td className="py-3 pr-3 text-right">
                    {c.urgent > 0 ? (
                      <Badge tone="danger">{c.urgent}</Badge>
                    ) : (
                      <span className="text-[var(--color-text-dim)]">0</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right text-xs">
                    {c.aiCostUsd > 0 ? (
                      <span title={`${c.aiTokens} tokens`}>
                        ${c.aiCostUsd.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-dim)]">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.vip && <Badge tone="warn">VIP</Badge>}
                      {c.muted && <Badge tone="neutral">muted</Badge>}
                      {c.customReply && <Badge tone="info">custom reply</Badge>}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => setEdit(c)}
                      className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        </Card>
        </>
      )}

      {edit && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setEdit(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 w-full max-w-md"
          >
            <h2 className="text-lg font-semibold mb-1">
              {edit.chatTitle ?? `chat ${edit.chatId}`}
            </h2>
            <p className="text-xs text-[var(--color-text-dim)] mb-4">
              {chatTypeLabel(edit.chatType)} · id {edit.chatId}
            </p>

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Mode for this chat
            </label>
            <select
              value={edit.mode}
              onChange={(e) =>
                setEdit({ ...edit, mode: e.target.value as ChatMode })
              }
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-4"
            >
              {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 mb-2 text-sm">
              <input
                type="checkbox"
                checked={edit.vip}
                onChange={(e) =>
                  setEdit({ ...edit, vip: e.target.checked, muted: e.target.checked ? false : edit.muted })
                }
              />
              VIP — always alert regardless of classification
            </label>
            <label className="flex items-center gap-2 mb-4 text-sm">
              <input
                type="checkbox"
                checked={edit.muted}
                onChange={(e) =>
                  setEdit({ ...edit, muted: e.target.checked, vip: e.target.checked ? false : edit.vip })
                }
              />
              Muted — ignore this chat entirely
            </label>

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Custom auto-reply (optional, overrides default)
            </label>
            <textarea
              value={edit.customReply ?? ""}
              onChange={(e) => setEdit({ ...edit, customReply: e.target.value })}
              rows={3}
              placeholder={truncate("Leave empty to use the default auto-reply.", 50)}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
            />

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setEdit(null)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                Cancel
              </button>
              <button
                onClick={() => save(edit)}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
